import { useEffect, useRef, useState } from 'react';
import {
  CODEX_BRIDGE_MCP_GET_STATUS,
  CODEX_BRIDGE_MCP_GET_TARGETS,
  CODEX_BRIDGE_MCP_GET_THREADS,
  type CodexBridgeObservation,
  type CodexBridgeLastTurn,
  type CodexBridgeReadFailureReason,
  type CodexBridgeReadResponse,
  type CodexBridgeTarget,
  type CodexBridgeThread,
  type CodexBridgeThreadPage,
  type CodexBridgeThreadStatus,
} from '../shared/codexbridge-mcp-protocol.ts';
import { CodexBridgeRequestTracker, mergeCodexBridgeThreads } from './codexbridge-request-tracker.ts';

type ConnectionState = 'loading' | 'connected' | 'error';

const ERROR_LABELS: Record<CodexBridgeReadFailureReason, string> = {
  'invalid-endpoint': '接続先URLを確認してください。',
  'permission-required': '接続先へのアクセス権限がありません。Optionsで権限を許可してください。',
  'authentication-required': '認証に失敗しました（401）。保存済みtokenを確認してください。',
  forbidden: 'この操作は許可されていません（403）。',
  'endpoint-not-found': 'MCP endpointが見つかりません。',
  'session-expired': 'MCP sessionが失効しました。もう一度更新してください。',
  'http-error': 'BridgeからHTTPエラーが返りました。',
  disconnected: 'Bridgeへ接続できません。',
  timeout: 'Bridgeへの要求がタイムアウトしました。',
  'protocol-error': 'Bridgeの応答形式を確認できません。',
  'protocol-version-unsupported': 'MCP protocol versionに対応していません。',
  'readonly-tool-unavailable': '必要な読み取りtoolがありません。',
  'readonly-probe-failed': 'Bridgeの読み取りtoolが失敗しました。',
  'storage-error': '保存済み接続情報を読み取れません。',
  'settings-unavailable': '保存済み接続設定を読み取れません。',
  'unknown-error': 'Bridgeの読み取りに失敗しました。',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorLabel(reason: unknown): string {
  return typeof reason === 'string' && reason in ERROR_LABELS
    ? ERROR_LABELS[reason as CodexBridgeReadFailureReason]
    : 'Bridgeから不正な応答が返りました。';
}

function attentionLabel(value: boolean | null | undefined): string {
  return value === true ? '要対応' : value === false ? '不要' : '不明';
}

function stateLabel(value: string | null | undefined): string {
  if (!value) return '不明（未取得）';
  if (value === 'not_loaded') return '未読込';
  if (value === 'unknown') return '不明';
  if (value === 'estimated_running') return '実行中の推定';
  return value;
}

function observationLabel(value: CodexBridgeObservation | null | undefined): string {
  if (!value) return '不明（未取得）';
  const state = stateLabel(value.state);
  const evidence = value.evidence === 'inferred' ? '推定' : value.evidence === 'live' ? 'ライブ観測' : value.evidence;
  return [state, evidence, value.reason, value.observedAt].filter(Boolean).join(' · ');
}

function lastTurnLabel(value: CodexBridgeLastTurn | null | undefined): string {
  if (!value) return '不明（未取得）';
  const status = value.status === 'completed' ? '完了' : value.status === 'failed' ? '失敗'
    : value.status === 'interrupted' ? '中断' : value.status === 'in_progress' ? '進行中'
      : value.status === 'unknown' ? '不明' : '不明（status未取得）';
  return [status, value.category, value.evidence === 'inferred' ? '推定' : value.evidence === 'live' ? 'ライブ観測' : value.evidence,
    value.reason, value.observedAt].filter(Boolean).join(' · ');
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return '不明';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('ja-JP') : '不明';
}

function isReadResponse<T>(value: unknown): value is CodexBridgeReadResponse<T> {
  return isRecord(value) && typeof value.ok === 'boolean';
}

export function CodexBridgeList() {
  const [connection, setConnection] = useState<ConnectionState>('loading');
  const [connectionMessage, setConnectionMessage] = useState('対象マシンを確認しています。');
  const [targets, setTargets] = useState<readonly CodexBridgeTarget[]>([]);
  const [targetId, setTargetId] = useState('');
  const [threads, setThreads] = useState<readonly CodexBridgeThread[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [threadsBusy, setThreadsBusy] = useState(false);
  const [threadsError, setThreadsError] = useState('');
  const [selected, setSelected] = useState<CodexBridgeThread | null>(null);
  const [selectedMissing, setSelectedMissing] = useState(false);
  const [status, setStatus] = useState<CodexBridgeThreadStatus | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState('');
  const selectedRef = useRef<CodexBridgeThread | null>(null);
  const targetIdRef = useRef('');
  const targetListGeneration = useRef(0);
  const requestTracker = useRef<CodexBridgeRequestTracker | null>(null);
  if (!requestTracker.current) requestTracker.current = new CodexBridgeRequestTracker();

  function updateSelected(thread: CodexBridgeThread | null) {
    selectedRef.current = thread;
    setSelected(thread);
  }

  function invalidateThreadData() {
    requestTracker.current?.invalidateThreads();
    requestTracker.current?.invalidateStatus();
    setThreads([]);
    setNextCursor(null);
    setThreadsLoaded(false);
    setThreadsBusy(false);
    setStatus(null);
    setStatusBusy(false);
    setThreadsError('');
    setStatusError('');
    setSelectedMissing(Boolean(selectedRef.current));
  }

  async function refreshTargets() {
    const generation = ++targetListGeneration.current;
    setConnection('loading');
    setConnectionMessage('対象マシンを確認しています。');
    try {
      const response: unknown = await chrome.runtime.sendMessage({ type: CODEX_BRIDGE_MCP_GET_TARGETS });
      if (generation !== targetListGeneration.current) return;
      if (!isReadResponse<readonly CodexBridgeTarget[]>(response) || !response.ok || !Array.isArray(response.data)) {
        setConnection('error');
        setConnectionMessage(isReadResponse(response) && !response.ok
          ? errorLabel(response.reason)
          : 'Bridgeから不正な応答が返りました。');
        invalidateThreadData();
        return;
      }
      const availableTargets = response.data;
      const activeTargetId = targetIdRef.current;
      const nextTargetId = availableTargets.some((target) => target.id === activeTargetId)
        ? activeTargetId
        : availableTargets[0]?.id ?? '';
      setTargets(availableTargets);
      setConnection('connected');
      setConnectionMessage('Bridgeへ接続しています。');
      if (nextTargetId !== activeTargetId) {
        targetIdRef.current = nextTargetId;
        requestTracker.current?.selectTarget(nextTargetId);
        setTargetId(nextTargetId);
        setThreads([]);
        setNextCursor(null);
        setThreadsLoaded(false);
        setThreadsBusy(false);
        setThreadsError('');
        updateSelected(null);
        setSelectedMissing(false);
        setStatus(null);
        setStatusBusy(false);
        setStatusError('');
      }
    } catch {
      if (generation === targetListGeneration.current) {
        setConnection('error');
        setConnectionMessage('Bridgeへ接続できません。');
        invalidateThreadData();
      }
    }
  }

  useEffect(() => {
    void refreshTargets();
  }, []);

  async function loadThreads(loadMore: boolean) {
    if (!targetId || threadsBusy || (loadMore && !nextCursor)) return;
    const requestedTargetId = targetIdRef.current;
    const requestedCursor = loadMore ? nextCursor : null;
    const request = requestTracker.current!.beginThreads(requestedTargetId, requestedCursor);
    if (!requestTracker.current!.isCurrentThreads(request)) return;
    setThreadsBusy(true);
    setThreadsError('');
    if (!loadMore) {
      setThreads([]);
      setNextCursor(null);
      setThreadsLoaded(false);
      setSelectedMissing(Boolean(selectedRef.current));
      setStatus(null);
      setStatusError('');
    }
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CODEX_BRIDGE_MCP_GET_THREADS,
        targetId: requestedTargetId,
        ...(requestedCursor ? { cursor: requestedCursor } : {}),
      });
      if (!requestTracker.current!.isCurrentThreads(request)) return;
      if (!isReadResponse<CodexBridgeThreadPage>(response) || !response.ok
        || !isRecord(response.data) || !Array.isArray(response.data.threads)
        || !(response.data.nextCursor === null || typeof response.data.nextCursor === 'string')) {
        setThreadsError(isReadResponse(response) && !response.ok
          ? errorLabel(response.reason)
          : 'Bridgeから不正な応答が返りました。');
        return;
      }
      if (!requestTracker.current!.setNextCursor(request, response.data.nextCursor)) return;
      const updated = loadMore ? mergeCodexBridgeThreads(threads, response.data.threads) : [...response.data.threads];
      setThreads(updated);
      setNextCursor(response.data.nextCursor);
      setThreadsLoaded(true);
      const selectedNow = selectedRef.current;
      if (selectedNow) {
        const found = updated.find((thread) => thread.targetId === selectedNow.targetId && thread.id === selectedNow.id);
        if (found) {
          updateSelected(found);
          setSelectedMissing(false);
        } else if (!loadMore) {
          setSelectedMissing(true);
        }
      }
    } catch {
      if (requestTracker.current!.isCurrentThreads(request)) setThreadsError('Bridgeへ接続できません。');
    } finally {
      if (requestTracker.current!.isLatestThreads(request)) setThreadsBusy(false);
    }
  }

  async function checkSelectedStatus() {
    if (!selected || statusBusy) return;
    const requested = selected;
    const request = requestTracker.current!.beginStatus(requested.targetId, requested.id);
    setStatusBusy(true);
    setStatusError('');
    setStatus(null);
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CODEX_BRIDGE_MCP_GET_STATUS,
        targetId: requested.targetId,
        threadId: requested.id,
      });
      if (!requestTracker.current!.isCurrentStatus(request)) return;
      if (!isReadResponse<CodexBridgeThreadStatus>(response) || !response.ok
        || !isRecord(response.data) || response.data.targetId !== requested.targetId
        || response.data.threadId !== requested.id) {
        setStatusError(isReadResponse(response) && !response.ok
          ? errorLabel(response.reason)
          : 'Bridgeから不正な応答が返りました。');
        return;
      }
      setStatus(response.data);
    } catch {
      if (requestTracker.current!.isCurrentStatus(request)) setStatusError('Bridgeへ接続できません。');
    } finally {
      if (requestTracker.current!.isCurrentStatus(request)) setStatusBusy(false);
    }
  }

  const selectedStatus = selected && status?.targetId === selected.targetId && status.threadId === selected.id ? status : null;
  const selectedTarget = selected ? targets.find((target) => target.id === selected.targetId) : null;
  const selectedListRow = selected && threadsLoaded && !selectedMissing ? selected : null;

  return (
    <section className="codex-bridge" aria-label="CodexBridge一覧">
      <div className="codex-bridge-heading">
        <h2>CodexBridge</h2>
        <button type="button" className="codex-bridge-button" onClick={() => { void refreshTargets(); }} disabled={connection === 'loading'}>
          {connection === 'loading' ? '確認中…' : '接続更新'}
        </button>
      </div>
      <p className={`codex-bridge-connection is-${connection}`} role="status">接続状態: {connectionMessage}</p>
      {targets.length > 0 && (
        <label className="codex-bridge-target">
          対象マシン
          <select value={targetId} onChange={(event) => {
            const value = event.currentTarget.value;
            targetIdRef.current = value;
            requestTracker.current?.selectTarget(value);
            setTargetId(value);
            setThreads([]);
            setNextCursor(null);
            setThreadsLoaded(false);
            setThreadsBusy(false);
            setThreadsError('');
            updateSelected(null);
            setSelectedMissing(false);
            setStatus(null);
            setStatusBusy(false);
            setStatusError('');
          }}>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.name} · {target.available === true ? '利用可能' : target.available === false ? '利用不可' : '利用状態不明'}
              </option>
            ))}
          </select>
        </label>
      )}
      {connection === 'connected' && targets.length === 0 && <p className="codex-bridge-empty">対象マシンがありません。</p>}
      {targetId && (
        <>
          <div className="codex-bridge-actions">
            <button type="button" className="codex-bridge-button" onClick={() => { void loadThreads(false); }} disabled={threadsBusy}>
              {threadsBusy ? '読込中…' : 'thread一覧を更新'}
            </button>
            {nextCursor && (
              <button type="button" className="codex-bridge-button" onClick={() => { void loadThreads(true); }} disabled={threadsBusy}>
                次ページ
              </button>
            )}
          </div>
          {threadsError && <p className="codex-bridge-error" role="alert">{threadsError}</p>}
          {!threadsLoaded && <p className="codex-bridge-empty">thread一覧は未読込です。</p>}
          {threadsLoaded && threads.length === 0 && <p className="codex-bridge-empty">threadはありません。状態確認は行われていません。</p>}
          {threads.length > 0 && (
            <ul className="codex-bridge-thread-list" aria-label="thread一覧">
              {threads.map((thread) => {
                const isSelected = selected?.targetId === thread.targetId && selected.id === thread.id;
                return (
                  <li key={`${thread.targetId}:${thread.id}`}>
                    <button type="button" className={`codex-bridge-thread${isSelected ? ' is-selected' : ''}`} onClick={() => {
                      requestTracker.current?.selectThread(thread.targetId, thread.id);
                      updateSelected(thread);
                      setSelectedMissing(false);
                      setStatus(null);
                      setStatusBusy(false);
                      setStatusError('');
                    }}>
                      <span>{thread.title ?? thread.preview ?? thread.id}</span>
                      <small>current_execution: {observationLabel(thread.currentExecution)}</small>
                      <small>last_turn: {lastTurnLabel(thread.lastTurn)} · needs_attention: {attentionLabel(thread.needsAttention)}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {selected && (
            <div className="codex-bridge-selected">
              <strong>{selected.title ?? selected.preview ?? selected.id}</strong>
              <code>{selected.id}</code>
              <p className="codex-bridge-note">対象マシン: {selectedTarget?.name ?? '不明'} ({selected.targetId})</p>
              <p className="codex-bridge-note">cwd: {selectedListRow?.cwd ?? '不明'}</p>
              <p className="codex-bridge-note">最終更新: {dateLabel(selectedListRow?.updatedAt)}</p>
              {selectedMissing && <p className="codex-bridge-note">
                {threadsError || connection === 'error' || (threadsBusy && !threadsLoaded)
                  ? 'thread一覧の更新を確認できていません。状態は未確認です。'
                  : threadsLoaded
                    ? '選択中のthreadは現在の一覧ページにありません。完了状態ではなく、状態は未確認です。'
                    : 'thread一覧は未読込です。状態は未確認です。'}
              </p>}
              <button type="button" className="codex-bridge-button" onClick={() => { void checkSelectedStatus(); }} disabled={statusBusy}>
                {statusBusy ? '確認中…' : '選択threadの状態を手動確認'}
              </button>
              {statusError && <p className="codex-bridge-error" role="alert">{statusError}</p>}
              <dl className="codex-bridge-status">
                <dt>応答状態</dt>
                <dd>{stateLabel(selectedStatus?.state)}</dd>
                <dt>current_execution{selectedStatus ? '（手動確認）' : '（一覧取得時）'}</dt>
                <dd>{observationLabel(selectedStatus ? selectedStatus.currentExecution : selectedListRow?.currentExecution)}</dd>
                <dt>last_turn{selectedStatus ? '（手動確認）' : '（一覧取得時）'}</dt>
                <dd>{lastTurnLabel(selectedStatus ? selectedStatus.lastTurn : selectedListRow?.lastTurn)}</dd>
                <dt>last_turn.turn_id</dt>
                <dd>{(selectedStatus ? selectedStatus.lastTurn : selectedListRow?.lastTurn)?.turnId ?? '不明'}</dd>
                <dt>needs_attention</dt>
                <dd>{attentionLabel(selectedStatus ? selectedStatus.needsAttention : selectedListRow?.needsAttention)}</dd>
              </dl>
            </div>
          )}
        </>
      )}
    </section>
  );
}
