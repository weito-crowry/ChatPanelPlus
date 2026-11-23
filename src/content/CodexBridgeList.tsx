import { useEffect, useRef, useState } from 'react';
import {
  CODEX_BRIDGE_MCP_GET_STATUS,
  CODEX_BRIDGE_MCP_GET_TARGETS,
  CODEX_BRIDGE_MCP_GET_THREADS,
  type CodexBridgeObservation,
  type CodexBridgeLastTurn,
  type CodexBridgeReadResponse,
  type CodexBridgeTarget,
  type CodexBridgeThread,
  type CodexBridgeThreadPage,
  type CodexBridgeThreadStatus,
} from '../shared/codexbridge-mcp-protocol.ts';
import { CodexBridgeRequestTracker, mergeCodexBridgeThreads, type CodexBridgeThreadListMode } from './codexbridge-request-tracker.ts';
import { sortCodexBridgeThreadsByActivity } from './codexbridge-thread-order.ts';
import { CodexBridgeWatchPanel } from './CodexBridgeWatchPanel.tsx';
import { CodexBridgeThreadModePicker } from './CodexBridgeThreadModePicker.tsx';
import { CodexBridgeProjectFolderFilter } from './CodexBridgeProjectFolderFilter.tsx';
import { codexBridgeReadErrorLabel } from './codexbridge-read-error-label.ts';
import type { ConversationPanelWatchSelection } from '../shared/conversation-panel-state-repository.ts';
import type { RunningThreadSummary } from './codexbridge-running-summary.ts';
import { conversationIdFromPath } from '../shared/conversation-route.ts';
import { CodexBridgeTerminalRefreshCoordinator, type CodexBridgeTerminalEventSignal } from './codexbridge-terminal-refresh.ts';

type ConnectionState = 'loading' | 'connected' | 'error';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function attentionLabel(value: boolean | null | undefined): string {
  return value === true ? '要対応' : value === false ? '不要' : '不明';
}

function stateLabel(value: string | null | undefined): string {
  if (!value) return '不明（未取得）';
  if (value === 'not_loaded') return '未読込';
  if (value === 'unknown') return '不明';
  if (value === 'in_progress' || value === 'running') return '実行中';
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

export function CodexBridgeList({
  foregroundEnabled = true,
  conversationId = null,
  bridgeWatchSelection = null,
  bridgeEventSelection = null,
  onSummaryChange,
  onRunningSummaryChange,
  onSelectBridgeWatch = () => {},
  onSelectBridgeEvent = () => {},
  onConnectionChange,
  currentProjectId = null,
}: Readonly<{
  foregroundEnabled?: boolean;
  conversationId?: string | null;
  bridgeWatchSelection?: ConversationPanelWatchSelection | null;
  bridgeEventSelection?: string | null;
  onSelectBridgeWatch?: (selection: ConversationPanelWatchSelection | null) => void;
  onSelectBridgeEvent?: (eventId: string | null) => void;
  onConnectionChange?: (connection: Readonly<{ state: ConnectionState; targetId: string | null; targetName: string | null }>) => void;
  currentProjectId?: string | null;
  onSummaryChange?: (summary: Readonly<{ watchingCount: number; unacknowledgedThreadCount: number }> | null) => void;
  onRunningSummaryChange?: (summary: RunningThreadSummary) => void;
}> = {}) {
  const [connection, setConnection] = useState<ConnectionState>('loading');
  const [connectionMessage, setConnectionMessage] = useState('対象マシンを確認しています。');
  const [targets, setTargets] = useState<readonly CodexBridgeTarget[]>([]);
  const [targetId, setTargetId] = useState('');
  const [threads, setThreads] = useState<readonly CodexBridgeThread[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [threadsBusy, setThreadsBusy] = useState(false);
  const [threadsError, setThreadsError] = useState('');
  const [listMode, setListMode] = useState<CodexBridgeThreadListMode>('running');
  const [watchFeedbackResetToken, setWatchFeedbackResetToken] = useState(0);
  const [selected, setSelected] = useState<CodexBridgeThread | null>(null);
  const [selectedMissing, setSelectedMissing] = useState(false);
  const [status, setStatus] = useState<CodexBridgeThreadStatus | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState('');
  const terminalContext = useRef({ connection, mode: listMode, threadsBusy: false });
  const selectedRef = useRef<CodexBridgeThread | null>(null);
  const targetIdRef = useRef('');
  const targetListGeneration = useRef(0);
  const runningSummaryGeneration = useRef(0);
  const terminalRefresh = useRef(new CodexBridgeTerminalRefreshCoordinator());
  const requestTracker = useRef<CodexBridgeRequestTracker | null>(null);
  if (!requestTracker.current) requestTracker.current = new CodexBridgeRequestTracker();

  function updateSelected(thread: CodexBridgeThread | null) {
    selectedRef.current = thread;
    setSelected(thread);
  }

  function reportRunningSummary(summary: RunningThreadSummary) {
    onRunningSummaryChange?.(summary);
  }

  function updateConnection(next: ConnectionState) { terminalContext.current.connection = next; setConnection(next); }
  function updateThreadsBusy(busy: boolean) { terminalContext.current.threadsBusy = busy; setThreadsBusy(busy); }

  function invalidateRunningSummary(status: RunningThreadSummary['status'], targetId = targetIdRef.current || null) {
    runningSummaryGeneration.current += 1;
    reportRunningSummary({ targetId, count: null, status });
  }

  function invalidateThreadData() {
    requestTracker.current?.invalidateThreads();
    requestTracker.current?.invalidateStatus();
    terminalRefresh.current.clearPending();
    setThreads([]);
    setNextCursor(null);
    setThreadsLoaded(false);
    updateThreadsBusy(false);
    setStatus(null);
    setStatusBusy(false);
    setThreadsError('');
    setStatusError('');
    setSelectedMissing(Boolean(selectedRef.current));
    invalidateRunningSummary('error');
  }

  async function refreshTargets() {
    const generation = ++targetListGeneration.current;
    terminalRefresh.current.clearPending(); updateConnection('loading');
    setConnectionMessage('対象マシンを確認しています。');
    try {
      const response: unknown = await chrome.runtime.sendMessage({ type: CODEX_BRIDGE_MCP_GET_TARGETS });
      if (generation !== targetListGeneration.current) return;
      if (!isReadResponse<readonly CodexBridgeTarget[]>(response) || !response.ok || !Array.isArray(response.data)) {
        updateConnection('error');
        setConnectionMessage(isReadResponse(response) && !response.ok
          ? codexBridgeReadErrorLabel(response.reason)
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
      updateConnection('connected');
      setConnectionMessage('Bridgeへ接続しています。');
      if (nextTargetId !== activeTargetId) {
        targetIdRef.current = nextTargetId;
        requestTracker.current?.selectTarget(nextTargetId);
        invalidateRunningSummary('loading', nextTargetId || null);
        setTargetId(nextTargetId);
        setThreads([]);
        setNextCursor(null);
        setThreadsLoaded(false);
        updateThreadsBusy(false);
        setThreadsError('');
        updateSelected(null);
        setSelectedMissing(false);
        setStatus(null);
        setStatusBusy(false);
        setStatusError('');
      }
    } catch {
      if (generation === targetListGeneration.current) {
        updateConnection('error');
        setConnectionMessage('Bridgeへ接続できません。');
        invalidateThreadData();
      }
    }
  }

  useEffect(() => {
    void refreshTargets();
  }, []);

  useEffect(() => {
    const targetName = targets.find((target) => target.id === targetId)?.name?.trim() || null;
    onConnectionChange?.({ state: connection, targetId: targetId || null, targetName });
  }, [connection, onConnectionChange, targetId, targets]);

  async function loadThreads(loadMore: boolean, resetWatchFeedback = true) {
    const requestedTargetId = targetIdRef.current;
    if (!requestedTargetId || terminalContext.current.threadsBusy || (loadMore && (terminalContext.current.mode !== 'normal' || !nextCursor))) return;
    if (resetWatchFeedback) setWatchFeedbackResetToken((current) => current + 1);
    const requestedCursor = loadMore ? nextCursor : null;
    const request = requestTracker.current!.beginThreads(requestedTargetId, requestedCursor);
    if (!requestTracker.current!.isCurrentThreads(request)) return;
    if (terminalContext.current.mode === 'running' && !loadMore) {
      invalidateRunningSummary('loading', requestedTargetId);
    }
    updateThreadsBusy(true);
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
        ...(terminalContext.current.mode === 'running' ? { runningOnly: true } : {}),
        ...(requestedCursor ? { cursor: requestedCursor } : {}),
      });
      if (!requestTracker.current!.isCurrentThreads(request)) return;
      if (!isReadResponse<CodexBridgeThreadPage>(response) || !response.ok
        || !isRecord(response.data) || !Array.isArray(response.data.threads)
        || !(response.data.nextCursor === null || typeof response.data.nextCursor === 'string')) {
        setThreadsError(isReadResponse(response) && !response.ok
          ? codexBridgeReadErrorLabel(response.reason)
          : 'Bridgeから不正な応答が返りました。');
        if (request.mode === 'running' && !loadMore) {
          const reason = isReadResponse(response) && !response.ok ? response.reason : null;
          reportRunningSummary({ targetId: requestedTargetId, count: null,
            status: reason === 'running-only-unsupported' ? 'unsupported' : 'error' });
        }
        return;
      }
      if (!requestTracker.current!.setNextCursor(request, response.data.nextCursor)) return;
      const updated = loadMore ? mergeCodexBridgeThreads(threads, response.data.threads) : [...response.data.threads];
      setThreads(updated);
      setNextCursor(response.data.nextCursor);
      setThreadsLoaded(true);
      if (request.mode === 'running' && !loadMore) {
        reportRunningSummary({ targetId: requestedTargetId, count: updated.length, status: 'ready' });
      }
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
      if (requestTracker.current!.isCurrentThreads(request)) {
        setThreadsError('Bridgeへ接続できません。');
        if (request.mode === 'running' && !loadMore) reportRunningSummary({ targetId: requestedTargetId, count: null, status: 'error' });
      }
    } finally {
      if (requestTracker.current!.isLatestThreads(request)) {
        updateThreadsBusy(false);
        if (terminalRefresh.current.finishRunningRequest(requestedTargetId, {
          targetId: targetIdRef.current || null, mode: terminalContext.current.mode,
          connected: terminalContext.current.connection === 'connected',
          routeCurrent: Boolean(conversationId && conversationIdFromPath(window.location.pathname) === conversationId), threadsBusy: false,
        })) void loadThreads(false, false);
      }
    }
  }

  async function loadRunningSummary(requestedTargetId: string) {
    const generation = ++runningSummaryGeneration.current;
    reportRunningSummary({ targetId: requestedTargetId, count: null, status: 'loading' });
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CODEX_BRIDGE_MCP_GET_THREADS, targetId: requestedTargetId, runningOnly: true,
      });
      if (generation !== runningSummaryGeneration.current || targetIdRef.current !== requestedTargetId) return;
      if (!isReadResponse<CodexBridgeThreadPage>(response) || !response.ok
        || !isRecord(response.data) || !Array.isArray(response.data.threads) || response.data.nextCursor !== null) {
        const reason = isReadResponse(response) && !response.ok ? response.reason : null;
        reportRunningSummary({ targetId: requestedTargetId, count: null,
          status: reason === 'running-only-unsupported' ? 'unsupported' : 'error' });
        return;
      }
      reportRunningSummary({ targetId: requestedTargetId, count: response.data.threads.length, status: 'ready' });
    } catch {
      if (generation === runningSummaryGeneration.current && targetIdRef.current === requestedTargetId) {
        reportRunningSummary({ targetId: requestedTargetId, count: null, status: 'error' });
      }
    }
  }

  function handleTerminalEvents(events: readonly CodexBridgeTerminalEventSignal[]) {
    const requestedTargetId = targetIdRef.current || null;
    const action = terminalRefresh.current.observe(events, {
      targetId: requestedTargetId, mode: terminalContext.current.mode, connected: terminalContext.current.connection === 'connected',
      routeCurrent: Boolean(conversationId && conversationIdFromPath(window.location.pathname) === conversationId),
      threadsBusy: terminalContext.current.threadsBusy,
    });
    if (action === 'threads') void loadThreads(false, false);
    else if (action === 'summary' && requestedTargetId) void loadRunningSummary(requestedTargetId);
  }

  function changeListMode(mode: CodexBridgeThreadListMode) {
    if (mode === listMode) return;
    requestTracker.current?.selectMode(mode);
    terminalContext.current.mode = mode; terminalRefresh.current.clearPending();
    runningSummaryGeneration.current += 1; setListMode(mode);
    setThreads([]);
    setNextCursor(null);
    setThreadsLoaded(false);
    updateThreadsBusy(false);
    setThreadsError('');
    setSelectedMissing(Boolean(selectedRef.current));
    setStatus(null);
    setStatusBusy(false);
    setStatusError('');
    if (mode === 'running') invalidateRunningSummary('loading');
  }

  useEffect(() => {
    if (connection !== 'connected' || !targetId) return;
    void loadThreads(false);
    if (listMode === 'normal') void loadRunningSummary(targetId);
  }, [connection, targetId, listMode]);

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
          ? codexBridgeReadErrorLabel(response.reason)
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
  const displayedThreads = sortCodexBridgeThreadsByActivity(threads);

  return (
    <section className="codex-bridge phase6-bridge-columns" aria-label="CodexBridge詳細">
      <section className="phase6-card phase6-card-a" aria-label="スレッド一覧">
      <div className="codex-bridge-heading">
        <h2>A スレッド一覧</h2>
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
            requestTracker.current?.selectTarget(value); terminalRefresh.current.clearPending();
            invalidateRunningSummary('loading', value || null);
            setTargetId(value);
            setThreads([]);
            setNextCursor(null);
            setThreadsLoaded(false);
            updateThreadsBusy(false);
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
            <button type="button" className="codex-bridge-button" onClick={() => {
              void loadThreads(false);
              if (listMode === 'normal') void loadRunningSummary(targetIdRef.current);
            }} disabled={threadsBusy}>
              {threadsBusy ? '読込中…' : 'thread一覧を更新'}
            </button>
            {listMode === 'normal' && nextCursor && (
              <button type="button" className="codex-bridge-button" onClick={() => { void loadThreads(true); }} disabled={threadsBusy}>
                次ページ
              </button>
            )}
          </div>
          <CodexBridgeThreadModePicker mode={listMode} onChange={changeListMode} />
          {threadsError && <p className="codex-bridge-error" role="alert">{threadsError}</p>}
          {!threadsLoaded && <p className="codex-bridge-empty">thread一覧は未読込です。</p>}
          {threadsLoaded && threads.length === 0 && <p className="codex-bridge-empty">
            {listMode === 'running' ? 'Bridgeが返した実行中threadはありません。' : 'この通常一覧ページにthreadはありません。'}
          </p>}
          {targetId && (
            <CodexBridgeProjectFolderFilter threads={threadsLoaded ? displayedThreads : []} selected={selected} currentProjectId={currentProjectId}
              onSelectThread={(thread) => {
                requestTracker.current?.selectThread(thread.targetId, thread.id);
                updateSelected(thread);
                setSelectedMissing(false);
                setStatus(null);
                setStatusBusy(false);
                setStatusError('');
              }} />
          )}
          {selected && (
                <div className="codex-bridge-selected phase6-selected-thread">
                  <strong>{selected.title?.trim() || selected.preview?.trim() || 'タイトル未取得'}</strong>
                  <p className="codex-bridge-note">対象マシン: {selectedTarget?.name ?? '不明'}</p>
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
                  <details className="phase6-technical-details">
                    <summary>技術情報</summary>
                    <code>thread ID: {selected.id} · target ID: {selected.targetId}</code>
                    <p className="codex-bridge-note">cwd: {selectedListRow?.cwd ?? '不明'} · 最終更新: {dateLabel(selectedListRow?.updatedAt)}</p>
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
                  </details>
            </div>
          )}
        </>
      )}
      </section>
      <CodexBridgeWatchPanel
        selected={selected ? { targetId: selected.targetId, threadId: selected.id } : null}
        target={targets.find((target) => target.id === targetId) ?? null}
        watchFeedbackResetToken={watchFeedbackResetToken}
        foregroundEnabled={foregroundEnabled}
        conversationId={conversationId}
        bridgeWatchSelection={bridgeWatchSelection}
        bridgeEventSelection={bridgeEventSelection}
        onSelectBridgeWatch={onSelectBridgeWatch}
        onSelectBridgeEvent={onSelectBridgeEvent}
        threadCandidates={threads}
        onSummaryChange={onSummaryChange}
        onTerminalEvents={handleTerminalEvents}
      />
    </section>
  );
}
