import { useEffect, useRef, useState } from 'react';
import {
  CODEX_BRIDGE_AUTO_WATCH_GET,
  CODEX_BRIDGE_AUTO_WATCH_REGISTRATION_REASONS,
  CODEX_BRIDGE_AUTO_WATCH_SET,
  CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY,
  isCodexBridgeWatchIdentifier,
  type CodexBridgeAutoWatchStatus,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import {
  formatRegistrationOutcomes,
  parseRegistrationOutcomes,
  registrationOutcomesHaveFailure,
} from './codexbridge-auto-watch-registration-diagnostics.ts';
import { conversationIdFromPath, isConversationId } from '../shared/conversation-route.ts';
import { codexBridgeAutoWatchFailureLabel } from './codexbridge-auto-watch-presentation.ts';
import {
  type CodexBridgeAutoWatchCompletionCheck,
  type CodexBridgeAutoWatchCompletionProgress,
  createCodexBridgeAutoWatchCandidatesMessage,
  createCodexBridgeAutoWatchCompletionMessage,
  matchCurrentCompletedAssistantMessage,
  matchCompletedAnswerAfterBridgeCandidates,
  subscribeCodexBridgeAutoWatchCompletionCheck,
  subscribeCodexBridgeAutoWatchCompletion,
} from './codexbridge-auto-watch-completion.ts';

const AUTO_FAILURES = new Set([
  'ok', '401', '403', 'timeout', 'disconnected', 'unknown', 'permission-required', 'settings-unavailable',
  'endpoint-not-found', 'session-expired', 'http-error', 'protocol-error', 'protocol-version-unsupported',
  'readonly-tool-unavailable', 'readonly-probe-failed', 'running-only-unsupported', 'connection-changed',
  'connection-unavailable', 'target-unavailable', 'owner-conflict', 'auto-owner-conflict', 'ownerless-watch',
  'watch-limit', 'owner-tab-unavailable', 'owner-recovering', 'storage-error',
]);

type AutoWatchDiagnosticStage = Readonly<{
  status: 'not-run' | 'pending' | 'ok' | 'failed' | 'skipped';
  count: number | null;
  reason: string | null;
  details: string | null;
}>;
type AutoWatchCompletionDiagnostic = Readonly<{
  scope: number;
  run: number;
  checkedAt: number;
  eventDetected: boolean;
  eventReason: string | null;
  candidates: AutoWatchDiagnosticStage;
  match: AutoWatchDiagnosticStage;
  registration: AutoWatchDiagnosticStage;
}>;

const DIAGNOSTIC_REASONS = new Set([
  ...AUTO_FAILURES,
  ...CODEX_BRIDGE_AUTO_WATCH_REGISTRATION_REASONS,
  'invalid-route', 'candidate-response-invalid', 'no-running-candidates', 'dom-unavailable', 'turn-not-unique',
  'answer-not-confirmed', 'answer-too-large', 'no-matching-ids', 'ambiguous-match', 'too-many-matches',
  'no-active-cycle', 'assistant-message-unavailable', 'answer-completion-event-not-fired', 'invalid-request',
  'no-thread-registered',
]);

function diagnosticStage(status: AutoWatchDiagnosticStage['status'], count: number | null = null,
  reason: string | null = null, details: string | null = null): AutoWatchDiagnosticStage {
  return { status, count, reason, details };
}

function safeDiagnosticReason(reason: string | null): string | null {
  if (reason === 'ok') return null;
  return reason && DIAGNOSTIC_REASONS.has(reason) ? reason : reason ? 'runtime-unavailable' : null;
}

function stageLabel(stage: AutoWatchDiagnosticStage): string {
  const label = stage.status === 'not-run' ? '未実行' : stage.status === 'pending' ? '待機中'
    : stage.status === 'ok' ? 'OK' : stage.status === 'failed' ? '失敗' : 'スキップ';
  return `${label}${stage.count === null ? '' : `・${stage.count}件`}${stage.reason ? `（${stage.reason}）` : ''}`
    + (stage.details ? ` [${stage.details}]` : '');
}

function diagnosticTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(timestamp);
}

function initialDiagnostic(check: CodexBridgeAutoWatchCompletionCheck, scope: number, run: number): AutoWatchCompletionDiagnostic {
  const notRun = diagnosticStage('not-run');
  return {
    scope, run, checkedAt: check.occurredAt, eventDetected: check.eventDetected,
    eventReason: safeDiagnosticReason(check.reason),
    candidates: check.eventDetected ? diagnosticStage('pending') : diagnosticStage('skipped', null, 'answer-completion-event-not-fired'),
    match: check.eventDetected ? diagnosticStage('pending') : notRun,
    registration: notRun,
  };
}

function progressStage(progress: CodexBridgeAutoWatchCompletionProgress): AutoWatchDiagnosticStage {
  return progress.status === 'ok'
    ? diagnosticStage('ok', progress.count)
    : diagnosticStage(progress.status, null, safeDiagnosticReason(progress.reason));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStatus(value: unknown): CodexBridgeAutoWatchStatus | null {
  if (!isRecord(value) || !isCodexBridgeWatchIdentifier(value.targetId)
    || !(value.connectionId === null || (isCodexBridgeWatchIdentifier(value.connectionId) && value.connectionId.length <= 96))
    || typeof value.enabled !== 'boolean' || !(value.ownerConversationId === null || isConversationId(value.ownerConversationId))
    || !['off', 'ready', 'error', 'conflict', 'recovering'].includes(String(value.state))
    || !(value.failure === null || (typeof value.failure === 'string' && AUTO_FAILURES.has(value.failure)))
    || !Number.isSafeInteger(value.watchingThreadCount) || (value.watchingThreadCount as number) < 0) return null;
  return value as unknown as CodexBridgeAutoWatchStatus;
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
  const [diagnostic, setDiagnostic] = useState<AutoWatchCompletionDiagnostic | null>(null);
  const generation = useRef(0);
  const identity = useRef({ targetId, conversationId });
  identity.current = { targetId, conversationId };
  const diagnosticRun = useRef(0);
  const diagnosticScope = useRef({ targetId, conversationId, version: 0 });
  if (diagnosticScope.current.targetId !== targetId || diagnosticScope.current.conversationId !== conversationId) {
    diagnosticScope.current = { targetId, conversationId, version: diagnosticScope.current.version + 1 };
  }
  const currentDiagnostic = diagnostic?.scope === diagnosticScope.current.version ? diagnostic : null;
  const routeValid = Boolean(conversationId && conversationIdFromPath(window.location.pathname) === conversationId);
  const statusIsCurrent = Boolean(status && status.targetId === targetId
    && (status.ownerConversationId === conversationId || status.state === 'conflict'));
  const currentStatus = statusIsCurrent ? status : null;

  async function refresh(expectedTarget = targetId, expectedConversation = conversationId,
    token = generation.current, onRetryable?: () => void): Promise<CodexBridgeAutoWatchStatus | null> {
    if (!expectedTarget || !expectedConversation || conversationIdFromPath(window.location.pathname) !== expectedConversation) return null;
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CODEX_BRIDGE_AUTO_WATCH_GET, targetId: expectedTarget, conversationId: expectedConversation,
      });
      if (token !== generation.current || identity.current.targetId !== expectedTarget || identity.current.conversationId !== expectedConversation
        || conversationIdFromPath(window.location.pathname) !== expectedConversation) return null;
      if (!isRecord(response) || response.ok !== true) {
        setStatus(null);
        const reason = isRecord(response) && typeof response.reason === 'string' ? response.reason : 'runtime-unavailable';
        setFailure(reason);
        if (reason === 'runtime-unavailable' || reason === 'storage-error') onRetryable?.();
        return null;
      }
      const parsed = parseStatus(response.data);
      if (!parsed || parsed.targetId !== expectedTarget) {
        setStatus(null); setFailure('protocol-error'); return null;
      }
      setStatus(parsed); setFailure(null);
      if (parsed.failure === 'storage-error') onRetryable?.();
      return parsed;
    } catch {
      if (token === generation.current && identity.current.targetId === expectedTarget
        && identity.current.conversationId === expectedConversation) { setStatus(null); setFailure('runtime-unavailable'); }
      onRetryable?.();
      return null;
    }
  }

  useEffect(() => {
    const token = ++generation.current;
    diagnosticRun.current += 1;
    setDiagnostic(null);
    setStatus(null); setFailure(null); setBusy(false);
    let retryTimer: number | null = null;
    let disposed = false;
    const refreshWithRetry = async () => {
      let retryableFailure = false;
      const next = await refresh(targetId, conversationId, token, () => { retryableFailure = true; });
      if (!disposed && (next?.state === 'recovering' || retryableFailure)) {
        retryTimer = window.setTimeout(() => { void refreshWithRetry(); }, 1_000);
      }
    };
    void refreshWithRetry();
    const unsubscribeCheck = subscribeCodexBridgeAutoWatchCompletionCheck((check) => {
      if (!conversationId || conversationIdFromPath(window.location.pathname) !== conversationId) return;
      const scope = diagnosticScope.current.version;
      const run = ++diagnosticRun.current;
      setDiagnostic(initialDiagnostic(check, scope, run));
    });
    const unsubscribeCompletion = subscribeCodexBridgeAutoWatchCompletion((notice) => {
      const current = identity.current;
      if (!current.conversationId || notice.conversationId !== current.conversationId
        || conversationIdFromPath(window.location.pathname) !== current.conversationId) return;
      const scope = diagnosticScope.current.version;
      const run = ++diagnosticRun.current;
      const requestToken = generation.current;
      const expectedTarget = current.targetId;
      const expectedConversation = current.conversationId;
      const isCurrentRun = () => run === diagnosticRun.current && scope === diagnosticScope.current.version
        && requestToken === generation.current && identity.current.targetId === expectedTarget
        && identity.current.conversationId === expectedConversation
        && Boolean(expectedConversation && conversationIdFromPath(window.location.pathname) === expectedConversation);
      const updateDiagnostic = (updates: Partial<AutoWatchCompletionDiagnostic>) => {
        if (!isCurrentRun()) return;
        setDiagnostic((previous) => previous?.scope === scope && previous.run === run
          ? { ...previous, ...updates } : previous);
      };
      setDiagnostic({
        scope, run, checkedAt: Date.now(), eventDetected: true, eventReason: null,
        candidates: diagnosticStage('pending'), match: diagnosticStage('pending'), registration: diagnosticStage('not-run'),
      });
      const expectedPathname = window.location.pathname;
      const request = createCodexBridgeAutoWatchCandidatesMessage(
        current.targetId, current.conversationId, expectedPathname, notice,
      );
      if (!request || !expectedTarget || !expectedConversation) {
        updateDiagnostic({ candidates: diagnosticStage('skipped', null,
          current.targetId ? 'invalid-route' : 'target-unavailable') });
        return;
      }
      void (async () => {
        let stage: 'match' | 'registration' = 'match';
        try {
          const match = await matchCompletedAnswerAfterBridgeCandidates(
            () => chrome.runtime.sendMessage(request),
            () => isCurrentRun()
              ? { document, pathname: window.location.pathname, targetId: expectedTarget, conversationId: expectedConversation }
              : null,
            expectedTarget, expectedConversation, notice,
            (progress) => {
              if (progress.stage === 'candidates') updateDiagnostic({ candidates: progressStage(progress) });
              else updateDiagnostic({ match: progressStage(progress) });
            },
            expectedPathname,
          );
          if (!isCurrentRun()) return;
          if (match.status === 'failed') { setFailure(match.reason); return; }
          if (match.status !== 'ready') {
            if (match.reason !== 'invalid-route' && match.reason !== 'no-running-candidates' && match.reason !== 'no-matching-ids') {
              console.debug('[ChatPanelPlus] 回答完了時の自動監視登録をスキップしました:', match.reason);
            }
            return;
          }
          const currentMatch = matchCurrentCompletedAssistantMessage(
            isCurrentRun()
              ? { document, pathname: window.location.pathname, targetId: expectedTarget, conversationId: expectedConversation }
              : null,
            expectedTarget, expectedConversation, expectedPathname, notice,
            match.candidateThreads ?? match.candidateThreadIds,
          );
          if (currentMatch.status !== 'ready') {
            updateDiagnostic({ match: diagnosticStage('skipped', null, safeDiagnosticReason(currentMatch.reason)) });
            return;
          }
          updateDiagnostic({ match: diagnosticStage('ok', currentMatch.threadIds.length) });
          const message = createCodexBridgeAutoWatchCompletionMessage(
            expectedTarget, match.connectionId, expectedConversation, expectedPathname, notice, currentMatch.threadIds,
            currentMatch.expectedTurns,
          );
          if (!message) {
            updateDiagnostic({ registration: diagnosticStage('skipped', null, 'invalid-request') });
            return;
          }
          stage = 'registration';
          updateDiagnostic({ registration: diagnosticStage('pending') });
          const response: unknown = await chrome.runtime.sendMessage(message);
          if (!isCurrentRun()) return;
          if (response === undefined || !isRecord(response) || response.ok !== true) {
            const reason = safeDiagnosticReason(isRecord(response) && typeof response.reason === 'string'
              ? response.reason : 'runtime-unavailable') ?? 'runtime-unavailable';
            setFailure(reason);
            updateDiagnostic({ registration: diagnosticStage('failed', null, reason) });
            return;
          }
          const data = isRecord(response.data) ? response.data : null;
          const registeredCount = data?.registeredCount;
          if (!Number.isSafeInteger(registeredCount) || (registeredCount as number) < 0) {
            setFailure('protocol-error');
            updateDiagnostic({ registration: diagnosticStage('failed', null, 'protocol-error') });
            return;
          }
          const refreshed = await refresh(expectedTarget, expectedConversation, requestToken);
          if (!isCurrentRun()) return;
          const count = registeredCount as number;
          const outcomes = parseRegistrationOutcomes(data?.outcomes);
          const outcomeDetails = outcomes?.length ? formatRegistrationOutcomes(outcomes) : null;
          const failureReason = safeDiagnosticReason(refreshed?.failure ?? null);
          if (count > 0) updateDiagnostic({ registration: diagnosticStage('ok', count, null, outcomeDetails) });
          else if (outcomes?.length) {
            const reason = safeDiagnosticReason(outcomes[0]!.reason) ?? 'no-thread-registered';
            const status = registrationOutcomesHaveFailure(outcomes) ? 'failed' : 'skipped';
            updateDiagnostic({ registration: diagnosticStage(status, 0, reason, outcomeDetails) });
          } else if (failureReason) updateDiagnostic({ registration: diagnosticStage('failed', 0, failureReason) });
          else updateDiagnostic({ registration: diagnosticStage('skipped', 0, 'no-thread-registered') });
        } catch {
          if (!isCurrentRun()) return;
          setFailure('runtime-unavailable');
          updateDiagnostic(stage === 'registration'
            ? { registration: diagnosticStage('failed', null, 'runtime-unavailable') }
            : { match: diagnosticStage('failed', null, 'runtime-unavailable') });
        }
      })();
    });
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]) {
        if (retryTimer !== null) window.clearTimeout(retryTimer);
        retryTimer = null;
        void refreshWithRetry();
      }
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => {
      disposed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      ++generation.current;
      ++diagnosticRun.current;
      unsubscribeCheck();
      unsubscribeCompletion();
      chrome.storage.onChanged.removeListener(onStorageChanged);
    };
  }, [targetId, conversationId]);

  async function toggle() {
    if (!targetId || !conversationId || !routeValid || busy || !statusIsCurrent) return;
    const expectedTarget = targetId;
    const expectedConversation = conversationId;
    const token = generation.current;
    ++diagnosticRun.current;
    setDiagnostic(null);
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
    ? currentStatus.enabled ? '有効・別タブが実行中' : '別タブがwatchを実行中'
    : currentStatus.state === 'recovering' ? 'owner再確認中・自動復帰待ち'
      : currentStatus.enabled ? currentStatus.state === 'error' ? '有効・登録エラー' : '有効' : 'OFF';
  const displayedOwner = currentStatus?.ownerConversationId ?? conversationId;
  const ownerLabel = currentStatus?.state === 'conflict' ? '別タブで実行中（このtabは処理しません）'
    : currentStatus?.state === 'recovering' ? '確認応答待ち（状態を自動再確認します）'
      : displayedOwner ?? '確認できません';
  const diagnosticSummary = currentDiagnostic
    ? `${diagnosticTime(currentDiagnostic.checkedAt)} · ${currentDiagnostic.eventDetected ? 'イベント検出' : 'イベント未検出'}`
    : '未実行';
  return (
    <div className="codex-bridge-auto-watch" aria-label="回答完了時の自動監視登録">
      <strong>回答完了時の自動監視登録</strong>
      <p className="codex-bridge-note">状態: {stateLabel} · 対象マシン: {targetName || targetId || '未選択'}</p>
      <p className="codex-bridge-note">owner ChatGPT会話: {ownerLabel}</p>
      {currentStatus?.enabled && <p className="codex-bridge-note">
        この会話の監視: {watchingThreadCount === null ? '未確認' : `${watchingThreadCount}件`}
      </p>}
      <button type="button" className="codex-bridge-button" onClick={() => { void toggle(); }}
        disabled={!routeValid || !targetId || busy || !statusIsCurrent}>
        {busy ? '更新中…' : currentStatus?.enabled ? 'この会話全体の自動登録をOFF' : 'この会話全体の自動登録をON'}
      </button>
      {visibleFailure && <p className="codex-bridge-error" role="status">{codexBridgeAutoWatchFailureLabel(visibleFailure)}</p>}
      {currentStatus?.enabled && <details className="phase6-technical-details">
        <summary>直近の回答完了時照合: {diagnosticSummary}</summary>
        {currentDiagnostic ? <>
          <span>イベント: {currentDiagnostic.eventDetected ? '検出' : '未検出'}
            {currentDiagnostic.eventReason ? `（${currentDiagnostic.eventReason}）` : ''}</span>
          <span>Bridge候補取得: {stageLabel(currentDiagnostic.candidates)}</span>
          <span>本文照合: {stageLabel(currentDiagnostic.match)}</span>
          <span>監視登録: {stageLabel(currentDiagnostic.registration)}</span>
        </> : <span>この会話で回答完了イベントはまだありません。</span>}
      </details>}
      <small className="codex-bridge-note">ON中は回答完了時、その回答本文にあるThread IDまたは実行中Turn IDから、Bridgeがliveと返したthreadを登録します。Turn IDだけの一致は登録直前にも同じ実行中turnであることを確認します。完了前に終了した短命タスクは登録しません。OFFでも既存watchと通知履歴は残ります。</small>
      {!routeValid && <small className="codex-bridge-note">会話routeを確認できないため、設定を表示・変更していません。</small>}
    </div>
  );
}
