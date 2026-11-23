import { useEffect, useRef, useState } from 'react';
import {
  CODEX_BRIDGE_AUTO_WATCH_GET,
  CODEX_BRIDGE_AUTO_WATCH_SET,
  CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY,
  isCodexBridgeWatchIdentifier,
  type CodexBridgeAutoWatchStatus,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import { conversationIdFromPath, isConversationId } from '../shared/conversation-route.ts';
import { codexBridgeReadErrorLabel } from './codexbridge-read-error-label.ts';
import {
  createCodexBridgeAutoWatchCompletionMessage,
  subscribeCodexBridgeAutoWatchCompletion,
} from './codexbridge-auto-watch-completion.ts';

const AUTO_FAILURES = new Set([
  'ok', '401', '403', 'timeout', 'disconnected', 'unknown', 'permission-required', 'settings-unavailable',
  'endpoint-not-found', 'session-expired', 'http-error', 'protocol-error', 'protocol-version-unsupported',
  'readonly-tool-unavailable', 'readonly-probe-failed', 'running-only-unsupported', 'connection-changed',
  'connection-unavailable', 'target-unavailable', 'owner-conflict', 'auto-owner-conflict', 'ownerless-watch',
  'watch-limit', 'owner-tab-unavailable', 'storage-error',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStatus(value: unknown): CodexBridgeAutoWatchStatus | null {
  if (!isRecord(value) || !isCodexBridgeWatchIdentifier(value.targetId)
    || !(value.connectionId === null || (isCodexBridgeWatchIdentifier(value.connectionId) && value.connectionId.length <= 96))
    || typeof value.enabled !== 'boolean' || !(value.ownerConversationId === null || isConversationId(value.ownerConversationId))
    || !['off', 'ready', 'error', 'conflict'].includes(String(value.state))
    || !(value.failure === null || (typeof value.failure === 'string' && AUTO_FAILURES.has(value.failure)))
    || !Number.isSafeInteger(value.watchingThreadCount) || (value.watchingThreadCount as number) < 0) return null;
  return value as unknown as CodexBridgeAutoWatchStatus;
}

function failureLabel(failure: string | null): string {
  if (!failure) return '';
  if (failure === 'running-only-unsupported') return 'Bridgeがrunning_onlyに未対応のため、回答完了時の照合を行えません。';
  if (failure === 'owner-conflict') return '既存watchは別会話の所有です。移管せず、このthreadの自動登録を見送ります。';
  if (failure === 'auto-owner-conflict') return 'この対象は別のChatGPT会話で自動監視中です。所有者は移管せず、操作を拒否しました。';
  if (failure === 'ownerless-watch') return 'owner情報のない既存watchがあるため、このthreadの自動登録を見送ります。';
  if (failure === 'watch-limit') return '監視上限32件のため、一部threadを登録できませんでした。';
  if (failure === 'target-unavailable') return '対象マシンを現在確認できません。回答完了時の照合を行えません。';
  if (failure === 'owner-tab-unavailable') return 'ownerタブの会話を確認できません。通知音は停止し、履歴だけを保持します。';
  if (failure === 'connection-changed') return '接続先が変わりました。現在の接続先では登録しませんでした。';
  if (failure === 'connection-unavailable') return 'Bridge接続先を確認できません。';
  if (failure === 'permission-required') return 'Bridgeへの接続権限を確認できません。';
  if (failure === 'authentication-required' || failure === '401') return 'Bridge認証を確認できません。';
  return `回答完了時の登録に失敗しました。${codexBridgeReadErrorLabel(failure)}`;
}

export function CodexBridgeAutoWatchControl({ targetId, targetName, conversationId, watchingThreadCount }: Readonly<{
  targetId: string | null;
  targetName: string | null;
  conversationId: string | null;
  watchingThreadCount: number | null;
}>) {
  const [status, setStatus] = useState<CodexBridgeAutoWatchStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const identity = useRef({ targetId, conversationId });
  identity.current = { targetId, conversationId };
  const routeValid = Boolean(conversationId && conversationIdFromPath(window.location.pathname) === conversationId);
  const statusIsCurrent = Boolean(status && status.targetId === targetId
    && (status.ownerConversationId === conversationId || status.state === 'conflict'));
  const currentStatus = statusIsCurrent ? status : null;

  async function refresh(expectedTarget = targetId, expectedConversation = conversationId, token = generation.current) {
    if (!expectedTarget || !expectedConversation || conversationIdFromPath(window.location.pathname) !== expectedConversation) return;
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CODEX_BRIDGE_AUTO_WATCH_GET, targetId: expectedTarget, conversationId: expectedConversation,
      });
      if (token !== generation.current || identity.current.targetId !== expectedTarget || identity.current.conversationId !== expectedConversation
        || conversationIdFromPath(window.location.pathname) !== expectedConversation) return;
      if (!isRecord(response) || response.ok !== true) {
        setStatus(null);
        setFailure(isRecord(response) && typeof response.reason === 'string' ? response.reason : 'runtime-unavailable');
        return;
      }
      const parsed = parseStatus(response.data);
      if (!parsed || parsed.targetId !== expectedTarget) {
        setStatus(null); setFailure('protocol-error'); return;
      }
      setStatus(parsed); setFailure(null);
    } catch {
      if (token === generation.current && identity.current.targetId === expectedTarget
        && identity.current.conversationId === expectedConversation) { setStatus(null); setFailure('runtime-unavailable'); }
    }
  }

  useEffect(() => {
    const token = ++generation.current;
    setStatus(null); setFailure(null); setBusy(false);
    void refresh(targetId, conversationId, token);
    const unsubscribeCompletion = subscribeCodexBridgeAutoWatchCompletion((notice) => {
      const current = identity.current;
      const message = createCodexBridgeAutoWatchCompletionMessage(
        current.targetId, current.conversationId, window.location.pathname, notice,
      );
      if (!message) return;
      const requestToken = generation.current;
      const expectedTarget = current.targetId;
      const expectedConversation = current.conversationId;
      void chrome.runtime.sendMessage(message).then((response: unknown) => {
        if (requestToken !== generation.current || identity.current.targetId !== expectedTarget
          || identity.current.conversationId !== expectedConversation
          || conversationIdFromPath(window.location.pathname) !== expectedConversation) return;
        if (!isRecord(response) || response.ok !== true) {
          setFailure(isRecord(response) && typeof response.reason === 'string' ? response.reason : 'runtime-unavailable');
          return;
        }
        void refresh(expectedTarget, expectedConversation, requestToken);
      }).catch(() => {
        if (requestToken === generation.current && identity.current.targetId === expectedTarget
          && identity.current.conversationId === expectedConversation) setFailure('runtime-unavailable');
      });
    });
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]) void refresh(targetId, conversationId, token);
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => {
      ++generation.current;
      unsubscribeCompletion();
      chrome.storage.onChanged.removeListener(onStorageChanged);
    };
  }, [targetId, conversationId]);

  async function toggle() {
    if (!targetId || !conversationId || !routeValid || busy || !statusIsCurrent) return;
    const expectedTarget = targetId;
    const expectedConversation = conversationId;
    const token = generation.current;
    setBusy(true); setFailure(null);
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CODEX_BRIDGE_AUTO_WATCH_SET, targetId: expectedTarget, conversationId: expectedConversation,
        enabled: !currentStatus?.enabled,
      });
      if (token !== generation.current || identity.current.targetId !== expectedTarget || identity.current.conversationId !== expectedConversation
        || conversationIdFromPath(window.location.pathname) !== expectedConversation) return;
      if (!isRecord(response) || response.ok !== true) {
        setFailure(isRecord(response) && typeof response.reason === 'string' ? response.reason : 'runtime-unavailable');
        return;
      }
      const parsed = parseStatus(response.data);
      if (!parsed || parsed.targetId !== expectedTarget) { setFailure('protocol-error'); return; }
      setStatus(parsed);
    } catch {
      if (token === generation.current && identity.current.targetId === expectedTarget
        && identity.current.conversationId === expectedConversation) setFailure('runtime-unavailable');
    }
    finally {
      if (token === generation.current && identity.current.targetId === expectedTarget
        && identity.current.conversationId === expectedConversation) setBusy(false);
    }
  }

  const visibleFailure = failure ?? currentStatus?.failure ?? null;
  const stateLabel = !currentStatus ? '状態を確認できません' : currentStatus.state === 'conflict'
    ? '別会話が自動監視登録中' : currentStatus.enabled ? currentStatus.state === 'error' ? '有効・登録エラー' : '有効' : 'OFF';
  const displayedOwner = currentStatus?.ownerConversationId ?? conversationId;
  return (
    <div className="codex-bridge-auto-watch" aria-label="回答完了時の自動監視登録">
      <strong>回答完了時の自動監視登録</strong>
      <p className="codex-bridge-note">状態: {stateLabel} · 対象マシン: {targetName || targetId || '未選択'}</p>
      <p className="codex-bridge-note">owner ChatGPT会話: {currentStatus?.state === 'conflict' ? '別会話 (ID非表示)' : displayedOwner ?? '確認できません'}</p>
      {currentStatus?.enabled && <p className="codex-bridge-note">
        この会話の監視: {watchingThreadCount === null ? '未確認' : `${watchingThreadCount}件`}
      </p>}
      <button type="button" className="codex-bridge-button" onClick={() => { void toggle(); }}
        disabled={!routeValid || !targetId || busy || !statusIsCurrent}>
        {busy ? '更新中…' : currentStatus?.enabled ? '自動監視登録をOFF' : '自動監視登録をON'}
      </button>
      {visibleFailure && <p className="codex-bridge-error" role="status">{failureLabel(visibleFailure)}</p>}
      <small className="codex-bridge-note">ON中は回答完了時、その回答本文にあるthread IDのうちBridgeがliveと返したものだけを登録します。完了前に終了した短命タスクは登録しません。OFFでも既存watchと通知履歴は残ります。</small>
      {!routeValid && <small className="codex-bridge-note">会話routeを確認できないため、設定を表示・変更していません。</small>}
    </div>
  );
}
