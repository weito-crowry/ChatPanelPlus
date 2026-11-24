import { useEffect, useRef, useState } from 'react';
import { conversationIdFromPath } from '../shared/conversation-route.ts';
import { createChromeConversationPanelStateRepository, type ConversationPanelStateRepository } from '../shared/conversation-panel-state-repository.ts';
import {
  CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER,
  isCodexBridgeTerminalEventSavedMessage,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import { appendTextAtEnd } from './editor/append-text.ts';
import { getBrowserEditorEnvironment } from './editor/adapter.ts';
import {
  createCodexBridgeTerminalAnswerAutoReflector,
  isTerminalEventNewerThanAutoReflectEnable,
  type CodexBridgeAutoReflectResult,
} from './codexbridge-terminal-answer-auto-reflect.ts';

function resultLabel(result: CodexBridgeAutoReflectResult): string {
  if (result.status === 'reflected') return '最終回答を入力欄の下書きへ反映しました。送信はしていません。';
  const labels: Record<Extract<CodexBridgeAutoReflectResult, { status: 'not-reflected' }>['reason'], string> = {
    disabled: '自動反映OFFのため、この終了通知は未反映です。',
    'route-or-setting-changed': '会話または設定が変わったため未反映です。',
    pending: '最終回答はまだ確定していません。C欄から手動取得できます。',
    'no-final-answer': '最終回答が見つかりません。C欄から手動取得できます。',
    unconfirmed: '最終回答の確定を確認できません。C欄から手動取得できます。',
    incomplete: '最終回答を完全に取得できません。C欄から手動取得できます。',
    'retrieval-failed': '最終回答を取得できません。C欄から手動取得できます。',
    'empty-answer': '最終回答が空でした。C欄から手動取得できます。',
    'editor-not-found': '入力欄がないか編集できません。C欄から手動取得できます。',
    'ime-composing': '入力欄がIME変換中のため未反映です。C欄から手動取得できます。',
    'complex-content': '入力欄に添付等があるため未反映です。C欄から手動取得できます。',
    'insertion-failed': '入力欄へ反映できません。C欄から手動取得できます。',
  };
  return labels[result.reason];
}

export function CodexBridgeTerminalAnswerAutoReflectControl({ conversationId }: Readonly<{ conversationId: string | null }>) {
  const repository = useRef<ConversationPanelStateRepository | null>(null);
  if (!repository.current) repository.current = createChromeConversationPanelStateRepository();
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const enabledAt = useRef<number | null>(null);
  const conversationRef = useRef(conversationId);
  const enabledRef = useRef(enabled);
  const readyRef = useRef(ready);
  const revision = useRef(0);
  const generation = useRef(0);
  const active = useRef(false);
  conversationRef.current = conversationId;
  enabledRef.current = enabled;
  readyRef.current = ready;
  const routeValid = Boolean(conversationId && conversationIdFromPath(window.location.pathname) === conversationId);

  useEffect(() => {
    const token = ++generation.current;
    active.current = true;
    revision.current = 0;
    enabledRef.current = false;
    enabledAt.current = null;
    readyRef.current = false;
    setEnabled(false); setReady(false); setBusy(false); setStatus('');
    const applyState = (result: Awaited<ReturnType<ConversationPanelStateRepository['load']>>) => {
      if (token !== generation.current || conversationRef.current !== conversationId) return;
      if (!result.ok) {
        enabledAt.current = null;
        enabledRef.current = false; readyRef.current = false;
        setEnabled(false); setReady(false);
        return;
      }
      enabledRef.current = result.state.autoReflectTerminalAnswer;
      enabledAt.current = result.state.autoReflectTerminalAnswer
        ? result.state.autoReflectTerminalAnswerEnabledAt ?? Date.now() : null;
      readyRef.current = true;
      setEnabled(result.state.autoReflectTerminalAnswer); setReady(true);
    };
    const unsubscribe = repository.current!.subscribe(conversationId, (result) => {
      revision.current += 1;
      applyState(result);
    });
    const loadRevision = revision.current;
    const loadPromise = repository.current!.load(conversationId).then((result) => {
      if (revision.current === loadRevision) applyState(result);
      return result;
    });
    const reflector = createCodexBridgeTerminalAnswerAutoReflector({
      isEligible(event) {
        return active.current && generation.current === token && readyRef.current && enabledRef.current
          && conversationRef.current === event.ownerConversationId
          && conversationIdFromPath(window.location.pathname) === event.ownerConversationId;
      },
      readFinalAnswer: (eventId) => chrome.runtime.sendMessage({
        type: CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER, eventId,
      }),
      appendAnswer(text) { return appendTextAtEnd(text, getBrowserEditorEnvironment()); },
      wait: (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
      onResult(_eventId, result) { setStatus(resultLabel(result)); },
    });
    const onMessage = (value: unknown) => {
      if (!isCodexBridgeTerminalEventSavedMessage(value)) return;
      const currentConversation = conversationRef.current;
      if (!currentConversation || value.ownerConversationId !== currentConversation
        || conversationIdFromPath(window.location.pathname) !== currentConversation) return;
      const receivedRevision = revision.current;
      const hadLoadedSetting = readyRef.current;
      const enabledAtReceipt = hadLoadedSetting ? enabledRef.current : null;
      void (async () => {
        let wasEnabled: boolean;
        if (enabledAtReceipt === null) {
          await loadPromise;
          wasEnabled = revision.current === receivedRevision && readyRef.current
            && isTerminalEventNewerThanAutoReflectEnable(value, enabledRef.current, enabledAt.current);
        } else {
          wasEnabled = isTerminalEventNewerThanAutoReflectEnable(value, enabledAtReceipt, enabledAt.current);
        }
        if (conversationRef.current !== currentConversation
          || conversationIdFromPath(window.location.pathname) !== currentConversation) wasEnabled = false;
        await reflector.receive(value, wasEnabled);
      })();
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      active.current = false;
      ++generation.current;
      unsubscribe();
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, [conversationId]);

  async function toggle() {
    if (!conversationId || !routeValid || !ready || busy) return;
    const expectedConversation = conversationId;
    const previous = enabledRef.current;
    const previousEnabledAt = enabledAt.current;
    const next = !previous;
    const token = generation.current;
    revision.current += 1;
    const toggleRevision = revision.current;
    enabledRef.current = next;
    enabledAt.current = next ? Date.now() : null;
    setEnabled(next); setBusy(true); setStatus('');
    const result = await repository.current!.update(expectedConversation, {
      autoReflectTerminalAnswer: next, autoReflectTerminalAnswerEnabledAt: enabledAt.current,
    });
    if (token !== generation.current || conversationRef.current !== expectedConversation) return;
    if (!result.ok && revision.current === toggleRevision) {
      enabledRef.current = previous;
      enabledAt.current = previousEnabledAt;
      setEnabled(previous);
      setStatus('設定を保存できませんでした。');
    }
    setBusy(false);
  }

  return (
    <div className="codex-bridge-auto-reflect-control">
      <label>
        <input type="checkbox" checked={enabled} disabled={!ready || !routeValid || busy}
          onChange={() => { void toggle(); }} />
        監視終了時に最終回答を入力欄へ自動反映
      </label>
      <small className="codex-bridge-note">ONの会話に新しく保存された終了通知だけを下書きへ追記します。送信はしません。</small>
      {status && <p className="codex-bridge-note" role="status">{status}</p>}
    </div>
  );
}
