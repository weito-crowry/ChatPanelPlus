import { useEffect, useRef, useState } from 'react';
import { type ResolvedButton } from '../shared/default-ui';
import { createChromeSettingsRepository, type SettingsRepository, type StoredViewState } from '../shared/settings-repository';
import { DEFAULT_SETTINGS, type ExtensionSettings } from '../shared/settings';
import { captureSelectionForPaste, clearComposer, insertAtBeginning, replaceCurrentSelection, type SelectionSnapshot } from './editor/adapter';
import { ClipboardPasteController, requiresManualPasteDialog, type ClipboardPasteResult } from './clipboard';
import { debugPasteStrategy } from './clipboard-debug';
import { ConversationStatistics } from './ConversationStatistics';
import { CodexWorkModeToggle } from './CodexWorkModeToggle';
import { pasteFromClipboard, replaceCurrentSelectionWithHTML } from './editor/experimental-insertion';
import type { ClipboardMetric, ClipboardMetricReporter } from './clipboard-metrics.ts';
import { dispatchPanelButton } from './panel-button-actions';
import {
  createInitialPanelViewState,
  createPanelViewModel,
  formatJstTimestamp,
  pasteResultErrorReason,
  reconcilePanelViewState,
  selectPanelTab,
  togglePanelMinimized,
} from './panel-view';

const MIN_ICON_SVG = (
  <svg className="panel-minimize-icon" viewBox="0 0 320 120" width="140" height="52" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M40 60 L100 60" />
      <path d="M100 60 C110 60, 110 85, 130 85 L190 85" />
      <path d="M190 85 C210 85, 210 60, 220 60 L280 60" />
      <path d="M140 64 L160 78 L180 64" />
    </g>
  </svg>
);

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

export function ChatPanel() {
  const repository = useRef<SettingsRepository | null>(null);
  if (!repository.current) repository.current = createChromeSettingsRepository();
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const model = createPanelViewModel(settings);
  const [viewState, setViewState] = useState(() => createInitialPanelViewState(model.tabs));
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;
  const [viewStateLoaded, setViewStateLoaded] = useState(false);
  const [persistViewState, setPersistViewState] = useState(false);
  const [error, setError] = useState('');
  const [soundToggleError, setSoundToggleError] = useState('');
  const [soundTogglePending, setSoundTogglePending] = useState(false);
  const [soundToggleOptimistic, setSoundToggleOptimistic] = useState<boolean | null>(null);
  const soundTogglePendingRef = useRef(false);
  const [manualPasteOpen, setManualPasteOpen] = useState(false);
  const [manualPasteText, setManualPasteText] = useState('');
  const pointerSnapshot = useRef<SelectionSnapshot | null>(null);
  const activePasteSnapshot = useRef<SelectionSnapshot | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const ignoreNextViewChange = useRef(false);
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
  const currentViewState = reconcilePanelViewState(viewState, model.tabs);
  const visibleTabKey = model.tabs.map(({ id }) => id).join('|');
  const activeTab = model.tabs.find((tab) => tab.id === currentViewState.selectedTabId);
  const activeButtons = activeTab ? model.buttonsByTab.get(activeTab.id) ?? [] : [];

  useEffect(() => {
    const repo = repository.current!;
    let active = true;
    let configRevision = 0;
    let viewRevision = 0;
    const unsubscribeSettings = repo.subscribeSettings((next) => {
      configRevision += 1;
      settingsRef.current = next;
      setSettings(next);
      const normalized = reconcilePanelViewState(viewStateRef.current, createPanelViewModel(next).tabs);
      if (normalized.selectedTabId !== viewStateRef.current.selectedTabId) {
        viewStateRef.current = normalized;
        setViewState(normalized);
        setPersistViewState(true);
      }
    });
    const unsubscribeView = repo.subscribeViewState((next) => {
      viewRevision += 1;
      const nextState = createInitialPanelViewState(createPanelViewModel(settingsRef.current).tabs, next);
      const current = viewStateRef.current;
      if (current.selectedTabId !== nextState.selectedTabId || current.minimized !== nextState.minimized) {
        ignoreNextViewChange.current = true;
        viewStateRef.current = nextState;
        setViewState(nextState);
      }
    });

    void Promise.all([repo.loadSettings(), repo.loadViewState()]).then(([settingsResult, viewResult]) => {
      if (!active) return;
      if (configRevision === 0 && settingsResult.ok) {
        settingsRef.current = settingsResult.settings;
        setSettings(settingsResult.settings);
      }
      if (viewRevision === 0) {
        const currentModel = createPanelViewModel(settingsRef.current);
        const stored: StoredViewState = viewResult.ok
          ? viewResult.viewState
          : { selectedTabId: null, minimized: false };
        const initial = createInitialPanelViewState(currentModel.tabs, stored);
        setViewState(initial);
        if (viewResult.ok && (initial.selectedTabId !== stored.selectedTabId || initial.minimized !== stored.minimized)) {
          setPersistViewState(true);
        }
      }
      setViewStateLoaded(true);
    });

    return () => {
      active = false;
      unsubscribeSettings();
      unsubscribeView();
    };
  }, []);

  useEffect(() => {
    const normalized = reconcilePanelViewState(viewState, model.tabs);
    if (normalized.selectedTabId !== viewState.selectedTabId) {
      setViewState(normalized);
      setPersistViewState(true);
    }
  }, [visibleTabKey, viewState]);

  useEffect(() => {
    if (!viewStateLoaded || !persistViewState || ignoreNextViewChange.current) {
      ignoreNextViewChange.current = false;
      return;
    }
    void repository.current?.saveViewState({
      selectedTabId: currentViewState.selectedTabId,
      minimized: currentViewState.minimized,
    }).then((result) => {
      if (!result.ok) setError('パネル状態を保存できませんでした。');
    });
  }, [currentViewState.selectedTabId, currentViewState.minimized, persistViewState, viewStateLoaded]);

  function dispatchButton(button: ResolvedButton) {
    dispatchPanelButton(button, {
      insert: (text) => showResult(insertAtBeginning(text)),
      insertJst: () => showResult(insertAtBeginning(formatJstTimestamp())),
      paste: () => { void beginPaste(); },
      clear: () => showResult(clearComposer()),
    });
  }

  function capturePastePointer() {
    pointerSnapshot.current = captureSelectionForPaste();
    returnFocus.current = pointerSnapshot.current.editor;
  }

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

  async function beginPaste() {
    if (!pasteController.current) return;
    const snapshot = pointerSnapshot.current ?? captureSelectionForPaste();
    pointerSnapshot.current = null;
    activePasteSnapshot.current = snapshot;
    returnFocus.current = activePasteSnapshot.current?.editor ?? document.activeElement as HTMLElement | null;
    showPasteResult(await pasteController.current.start(snapshot, debugPasteStrategy(window.location.search)));
    if (!pasteController.current.isBusy) activePasteSnapshot.current = null;
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

  return (
    <aside className={`panel${currentViewState.minimized ? ' is-minimized' : ''}`} aria-label="ChatPanelPlus パネル">
      <div className="panel-header">
        <h1 className="panel-title" hidden={currentViewState.minimized}>ChatPanelPlus</h1>
        <CodexWorkModeToggle minimized={currentViewState.minimized} />
      </div>
      <div className="panel-content" hidden={currentViewState.minimized}>
        <ConversationStatistics
          answerCompletionSoundEnabled={soundToggleOptimistic ?? settings.answerCompletionSoundEnabled === true}
          answerCompletionSoundId={settings.answerCompletionSoundId ?? 'tone-660'}
          soundTogglePending={soundTogglePending}
          soundToggleError={soundToggleError}
          onToggleAnswerCompletionSound={(enabled) => toggleAnswerCompletionSound(enabled)}
        />
        <div className="utility-row" aria-label="常時表示操作">
          {model.utilityButtons.map((button) => (
            <button
              type="button"
              className="action-button"
              key={button.id}
              data-button-id={button.id}
              style={{ backgroundColor: button.color }}
              onPointerDown={button.action === 'paste' ? capturePastePointer : undefined}
              onClick={() => dispatchButton(button)}
            >
              {button.label}
            </button>
          ))}
        </div>
        {model.tabs.length > 0 && (
          <div className="tab-list" role="tablist" aria-label="操作カテゴリ">
            {model.tabs.map((tab) => (
              <button
                type="button"
                className={`tab-button${activeTab?.id === tab.id ? ' is-active' : ''}`}
                key={tab.id}
                id={`chatpanel-tab-${tab.id}`}
                role="tab"
                aria-selected={activeTab?.id === tab.id}
                aria-controls="chatpanel-tab-content"
                onClick={() => {
                  setViewState((state) => selectPanelTab(state, model.tabs, tab.id));
                  setPersistViewState(true);
                  setError('');
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
        {activeTab && (
          <div
            className="tab-content"
            id="chatpanel-tab-content"
            role="tabpanel"
            aria-labelledby={`chatpanel-tab-${activeTab.id}`}
          >
            {activeButtons.map((button) => (
              <button
                type="button"
                className="action-button"
                key={button.id}
                data-button-id={button.id}
                style={{ backgroundColor: button.color }}
                onPointerDown={button.action === 'paste' ? capturePastePointer : undefined}
                onClick={() => dispatchButton(button)}
              >
                {button.label}
              </button>
            ))}
          </div>
        )}
        {error && <div className="panel-error" role="status">{error}</div>}
        <div className="settings-entry">
          <button
            type="button"
            onClick={() => {
              void chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
            }}
          >
            設定
          </button>
        </div>
      </div>
      {manualPasteOpen && (
        <div
          className="manual-paste-backdrop"
          onClick={cancelManualPaste}
        >
          <section
            className="manual-paste-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-paste-title"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                cancelManualPaste();
                return;
              }
              if (event.key !== 'Tab') return;
              const controls = event.currentTarget.querySelectorAll<HTMLElement>('textarea, button:not(:disabled)');
              const first = controls.item(0);
              const last = controls.item(controls.length - 1);
              const root = event.currentTarget.getRootNode();
              const activeElement = root instanceof ShadowRoot ? root.activeElement ?? document.activeElement : document.activeElement;
              if (event.shiftKey && activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <h2 id="manual-paste-title">直接貼り付けが利用できません</h2>
            <p>テキストをここへ貼り付けてから「挿入」を押してください（Ctrl+V）。</p>
            <textarea
              autoFocus
              rows={6}
              value={manualPasteText}
              onChange={(event) => setManualPasteText(event.currentTarget.value)}
              aria-label="貼り付けるテキスト"
            />
            <div className="manual-paste-actions">
              <button type="button" onClick={() => { void submitManualPaste(); }}>
                挿入
              </button>
              <button type="button" onClick={cancelManualPaste}>キャンセル</button>
            </div>
          </section>
        </div>
      )}
      <button
        type="button"
        className={`panel-minimize-toggle${currentViewState.minimized ? ' is-minimized' : ''}`}
        aria-label={currentViewState.minimized ? '復帰' : '最小化'}
        title={currentViewState.minimized ? '復帰' : '最小化'}
        aria-expanded={!currentViewState.minimized}
        onClick={() => {
          setViewState((state) => togglePanelMinimized(reconcilePanelViewState(state, model.tabs)));
          setPersistViewState(true);
        }}
      >
        {MIN_ICON_SVG}
      </button>
    </aside>
  );
}
