import { useEffect, useRef, useState } from 'react';
import { type ResolvedButton } from '../shared/default-ui';
import { createChromeSettingsRepository, type SettingsRepository } from '../shared/settings-repository';
import { DEFAULT_SETTINGS, type ExtensionSettings } from '../shared/settings';
import { DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT } from '../shared/answer-completion-sound-volume.ts';
import { captureSelectionForPaste, clearComposer, insertAtBeginning, insertAtCaret, replaceCurrentSelection, type SelectionSnapshot } from './editor/adapter';
import { ClipboardPasteController, requiresManualPasteDialog, type ClipboardPasteResult } from './clipboard';
import { debugPasteStrategy } from './clipboard-debug';
import { pasteFromClipboard, replaceCurrentSelectionWithHTML } from './editor/experimental-insertion';
import type { ClipboardMetric, ClipboardMetricReporter } from './clipboard-metrics.ts';
import { dispatchPanelButton } from './panel-button-actions';
import {
  createPanelPresentation,
  createPanelViewModel,
  formatJstTimestamp,
  pasteResultErrorReason,
  type PanelViewModel,
  type PanelViewState,
} from './panel-view';
import type { ResolvedTab } from '../shared/default-ui';
import { useConversationPanelState } from './useConversationPanelState.ts';
import { useConversationAudioMute } from './useConversationAudioMute.ts';

const ERROR_MESSAGES: Record<string, string> = {
  'editor-not-found': '入力欄が見つかりません。',
  'editor-hidden': '入力欄を確認できません。',
  'editor-disabled': '入力欄が編集できません。',
  'selection-invalid': '選択位置を確認できません。',
  'edit-rejected': '入力欄への反映に失敗しました。',
  'edit-unconfirmed': '貼り付け結果を確認できません。二重挿入を避けるため、入力欄を確認してください。',
  'attachment-unconfirmed': '添付状態を確認できません。Composerの添付欄を確認してください。二重貼り付けは行わないでください。',
  'composer-changed': '入力欄が切り替わりました。もう一度操作してください。',
  'complex-content': '添付を含む入力欄はクリアできません。',
  'ime-composing': '日本語入力の変換中です。変換を確定してから再操作してください。',
  'unexpected-error': '入力欄の操作に失敗しました。',
};

function createClipboardMetricReporter(): ClipboardMetricReporter | undefined {
  // 開発用計測はURLに ?cppDebugClipboard=1 を付けた場合だけ有効にする。
  if (typeof window === 'undefined' || new URLSearchParams(window.location.search).get('cppDebugClipboard') !== '1') return undefined;
  let metrics: ClipboardMetric[] = [];
  return (metric) => {
    metrics.push(metric);
    if (metric.stage === 'complete') {
      console.info('[ChatPanelPlus clipboard]', metrics);
      metrics = [];
    }
  };
}

export interface PanelControllerState {
  readonly model: PanelViewModel;
  readonly currentViewState: PanelViewState;
  readonly activeTab: ResolvedTab | undefined;
  readonly activeButtons: readonly ResolvedButton[];
  readonly minimized: boolean;
  readonly conversationId: string | null;
  readonly bridgeExpanded: boolean;
  readonly conversationMuted: boolean;
  readonly muteLoaded: boolean;
  readonly mutePending: boolean;
  readonly muteRevision: number;
  readonly getConversationMuteSnapshot: () => { readonly muted: boolean; readonly revision: number };
  readonly error: string;
  readonly answerCompletionSoundEnabled: boolean;
  readonly answerCompletionSoundId: string;
  readonly answerCompletionSoundVolumePercent: number;
  readonly soundTogglePending: boolean;
  readonly soundToggleError: string;
  readonly manualPasteOpen: boolean;
  readonly manualPasteText: string;
  readonly onButtonPointerDown: (buttonId: ResolvedButton['id']) => void;
  readonly onButtonClick: (button: ResolvedButton, isPointerClick: boolean) => void;
  readonly onSelectTab: (tabId: ResolvedTab['id']) => void;
  readonly onToggleMinimized: () => void;
  readonly onToggleBridgeExpanded: () => void;
  readonly onToggleConversationMute: (muted: boolean) => Promise<void>;
  readonly onOpenSettings: () => void;
  readonly onToggleAnswerCompletionSound: (enabled: boolean) => Promise<void>;
  readonly onManualPasteTextChange: (value: string) => void;
  readonly onSubmitManualPaste: () => void;
  readonly onCancelManualPaste: () => void;
}

export function usePanelController(): PanelControllerState {
  const repository = useRef<SettingsRepository | null>(null);
  if (!repository.current) repository.current = createChromeSettingsRepository();
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const model = createPanelViewModel(settings);
  const conversationPanel = useConversationPanelState(model.tabs);
  const conversationMute = useConversationAudioMute(conversationPanel.conversationId);
  const [error, setError] = useState('');
  const [soundToggleError, setSoundToggleError] = useState('');
  const [soundTogglePending, setSoundTogglePending] = useState(false);
  const [soundToggleOptimistic, setSoundToggleOptimistic] = useState<boolean | null>(null);
  const soundTogglePendingRef = useRef(false);
  const [manualPasteOpen, setManualPasteOpen] = useState(false);
  const [manualPasteText, setManualPasteText] = useState('');
  const pointerSnapshot = useRef<{ buttonId: ResolvedButton['id']; snapshot: SelectionSnapshot } | null>(null);
  const activePasteSnapshot = useRef<SelectionSnapshot | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pasteController = useRef<ClipboardPasteController | null>(null);
  if (!pasteController.current) {
    const onMetric = createClipboardMetricReporter();
    pasteController.current = new ClipboardPasteController({
      clipboard: typeof navigator === 'undefined' ? undefined : navigator.clipboard,
      captureSelection: captureSelectionForPaste,
      insert: (text, snapshot, reportMetric) => replaceCurrentSelection(
        text,
        undefined,
        snapshot ?? captureSelectionForPaste(),
        reportMetric,
      ),
      insertHTML: (text, snapshot, reportMetric) => replaceCurrentSelectionWithHTML(
        text,
        undefined,
        snapshot ?? captureSelectionForPaste(),
        reportMetric,
      ),
      paste: (snapshot, reportMetric) => pasteFromClipboard(
        undefined,
        snapshot ?? captureSelectionForPaste(),
        reportMetric,
      ),
      onMetric,
    });
  }
  const presentation = createPanelPresentation(model, conversationPanel.viewState);
  const { currentViewState, activeTab, activeButtons } = presentation;

  useEffect(() => {
    const repo = repository.current!;
    let active = true;
    let configRevision = 0;
    const unsubscribeSettings = repo.subscribeSettings((next) => {
      configRevision += 1;
      settingsRef.current = next;
      setSettings(next);
    });
    void repo.loadSettings().then((settingsResult) => {
      if (!active) return;
      if (configRevision === 0 && settingsResult.ok) {
        settingsRef.current = settingsResult.settings;
        setSettings(settingsResult.settings);
      }
    });

    return () => {
      active = false;
      unsubscribeSettings();
    };
  }, []);

  function showResult(result: ReturnType<typeof insertAtBeginning>) {
    setError(result.ok ? '' : ERROR_MESSAGES[result.reason] ?? '入力欄の操作に失敗しました。');
  }

  function showPasteResult(result: ClipboardPasteResult) {
    const errorReason = pasteResultErrorReason(result);
    setError(errorReason ? ERROR_MESSAGES[errorReason] ?? '入力欄の操作に失敗しました。' : '');
    if (requiresManualPasteDialog(result)) {
      setManualPasteOpen(true);
      setManualPasteText('');
    }
  }

  async function beginPaste(snapshot: SelectionSnapshot | null = null) {
    if (!pasteController.current) return;
    const activeSnapshot = snapshot ?? captureSelectionForPaste();
    activePasteSnapshot.current = activeSnapshot;
    returnFocus.current = activeSnapshot.editor ?? document.activeElement as HTMLElement | null;
    showPasteResult(await pasteController.current.start(activeSnapshot, debugPasteStrategy(window.location.search)));
    if (!pasteController.current.isBusy) activePasteSnapshot.current = null;
  }

  function dispatchButton(button: ResolvedButton, isPointerClick: boolean) {
    const pointerCapture = pointerSnapshot.current;
    pointerSnapshot.current = null;
    const snapshot = isPointerClick && pointerCapture?.buttonId === button.id ? pointerCapture.snapshot : null;
    dispatchPanelButton(button, {
      insert: (text, insertionMode) => showResult(insertionMode === 'caret'
        ? insertAtCaret(text, undefined, snapshot ?? captureSelectionForPaste())
        : insertAtBeginning(text)),
      insertJst: () => showResult(insertAtBeginning(formatJstTimestamp())),
      paste: () => { void beginPaste(snapshot); },
      clear: () => showResult(clearComposer()),
    });
  }

  function captureSelectionPointer(buttonId: ResolvedButton['id']) {
    pointerSnapshot.current = { buttonId, snapshot: captureSelectionForPaste() };
  }

  function finishManualPaste(result: ClipboardPasteResult) {
    showPasteResult(result);
    setManualPasteOpen(false);
    setManualPasteText('');
    activePasteSnapshot.current = null;
    const target = returnFocus.current;
    returnFocus.current = null;
    target?.focus();
  }

  function cancelManualPaste() {
    pasteController.current?.cancel();
    finishManualPaste({ kind: 'cancelled' });
  }

  async function submitManualPaste() {
    const result = await pasteController.current?.insertManual(manualPasteText) ?? { kind: 'busy' };
    finishManualPaste(result);
  }

  async function toggleAnswerCompletionSound(enabled: boolean): Promise<void> {
    if (soundTogglePendingRef.current) return;
    soundTogglePendingRef.current = true;
    setSoundTogglePending(true);
    setSoundToggleOptimistic(enabled);
    setSoundToggleError('');
    const repo = repository.current!;
    const base = settingsRef.current;
    const result = await repo.saveSettings(base, { ...base, answerCompletionSoundEnabled: enabled });
    if (result.ok) {
      settingsRef.current = result.settings;
      setSettings(result.settings);
      setSoundToggleOptimistic(null);
    } else {
      const latest = await repo.loadSettings();
      if (latest.ok) {
        settingsRef.current = latest.settings;
        setSettings(latest.settings);
      }
      setSoundToggleOptimistic(null);
      setSoundToggleError(result.reason === 'conflict'
        ? '別のOptions画面で回答完了音が変更されました。保存値を読み直してください。'
        : result.reason === 'storage-failed'
          ? '回答完了音の設定を保存できませんでした。表示を保存済みの状態へ戻しました。'
          : '保存済み設定を確認できませんでした。回答完了音の表示を最後に読み込んだ状態へ戻しました。');
    }
    soundTogglePendingRef.current = false;
    setSoundTogglePending(false);
  }

  return {
    model,
    currentViewState,
    activeTab,
    activeButtons,
    minimized: currentViewState.minimized,
    conversationId: conversationPanel.conversationId,
    bridgeExpanded: conversationPanel.bridgeExpanded,
    conversationMuted: conversationMute.muted,
    muteLoaded: conversationMute.loaded,
    mutePending: conversationMute.pending,
    muteRevision: conversationMute.revision,
    getConversationMuteSnapshot: conversationMute.getSnapshot,
    error: error || conversationPanel.error || conversationMute.error,
    answerCompletionSoundEnabled: soundToggleOptimistic ?? settings.answerCompletionSoundEnabled === true,
    answerCompletionSoundId: settings.answerCompletionSoundId ?? 'tone-660',
    answerCompletionSoundVolumePercent: settings.answerCompletionSoundVolumePercent ?? DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT,
    soundTogglePending,
    soundToggleError,
    manualPasteOpen,
    manualPasteText,
    onButtonPointerDown: captureSelectionPointer,
    onButtonClick: dispatchButton,
    onSelectTab: conversationPanel.onSelectTab,
    onToggleMinimized: conversationPanel.onToggleMinimized,
    onToggleBridgeExpanded: conversationPanel.onToggleBridgeExpanded,
    onToggleConversationMute: conversationMute.onToggle,
    onOpenSettings: () => { void chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }); },
    onToggleAnswerCompletionSound: toggleAnswerCompletionSound,
    onManualPasteTextChange: setManualPasteText,
    onSubmitManualPaste: () => { void submitManualPaste(); },
    onCancelManualPaste: cancelManualPaste,
  };
}
