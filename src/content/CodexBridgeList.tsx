import { useEffect, useRef, useState } from 'react';
import {
  CODEX_BRIDGE_MCP_GET_STATUS,
  CODEX_BRIDGE_MCP_GET_TARGETS,
  CODEX_BRIDGE_MCP_GET_THREADS,
  type CodexBridgeReadResponse,
  type CodexBridgeTarget,
  type CodexBridgeThread,
  type CodexBridgeThreadPage,
  type CodexBridgeThreadStatus,
} from '../shared/codexbridge-mcp-protocol.ts';
import { CodexBridgeRequestTracker, mergeCodexBridgeThreads, type CodexBridgeThreadListMode } from './codexbridge-request-tracker.ts';
import { sortCodexBridgeThreadsByActivity } from './codexbridge-thread-order.ts';
import { CodexBridgeWatchPanel } from './CodexBridgeWatchPanel.tsx';
import { CodexBridgeSelectedThreadDetails } from './CodexBridgeSelectedThreadDetails.tsx';
import { CodexBridgeThreadModePicker } from './CodexBridgeThreadModePicker.tsx';
import { CodexBridgeProjectFolderFilter } from './CodexBridgeProjectFolderFilter.tsx';
import { reconcileCodexBridgeThreadSelection } from './codexbridge-thread-selection.ts';
import { codexBridgeReadErrorLabel } from './codexbridge-read-error-label.ts';
import type { ConversationPanelWatchSelection } from '../shared/conversation-panel-state-repository.ts';
import type { RunningThreadSummary } from './codexbridge-running-summary.ts';
import { conversationIdFromPath } from '../shared/conversation-route.ts';
import { CodexBridgeTerminalRefreshCoordinator, type CodexBridgeTerminalEventSignal } from './codexbridge-terminal-refresh.ts';
import type { CodexBridgeWatchAdditionBatch } from './codexbridge-watch-addition-observer.ts';
import { isCodexBridgeWatchRefreshContextCurrent, type CodexBridgeWatchRefreshContext } from './codexbridge-watch-refresh-context.ts';

type ConnectionState = 'loading' | 'connected' | 'error';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  const routeIdentity = useRef({ conversationId, generation: 0 });
  const watchSnapshot = useRef<Readonly<{ ownerConversationId: string; connectionId: string | null;
    generation: number; routeGeneration: number }> | null>(null);
  if (!requestTracker.current) requestTracker.current = new CodexBridgeRequestTracker();
  if (routeIdentity.current.conversationId !== conversationId) {
    routeIdentity.current = { conversationId, generation: routeIdentity.current.generation + 1 };
    terminalRefresh.current.clearPending();
    runningSummaryGeneration.current += 1;
  }

  function updateSelected(thread: CodexBridgeThread | null) {
    selectedRef.current = thread;
    setSelected(thread);
  }

  function reportRunningSummary(summary: RunningThreadSummary) {
    onRunningSummaryChange?.(summary);
  }

  function updateConnection(next: ConnectionState) { terminalContext.current.connection = next; setConnection(next); }
  function updateThreadsBusy(busy: boolean) { terminalContext.current.threadsBusy = busy; setThreadsBusy(busy); }

  function currentWatchRefreshContext(): CodexBridgeWatchRefreshContext | null {
    const current = watchSnapshot.current;
    if (!current?.connectionId || !targetIdRef.current) return null;
    return { ownerConversationId: current.ownerConversationId, connectionId: current.connectionId,
      targetId: targetIdRef.current, mode: terminalContext.current.mode, watchGeneration: current.generation,
      routeGeneration: routeIdentity.current.generation };
  }

  function isWatchRefreshContextCurrent(context: CodexBridgeWatchRefreshContext): boolean {
    const current = watchSnapshot.current;
    return Boolean(current && isCodexBridgeWatchRefreshContextCurrent(context, {
      ownerConversationId: current.ownerConversationId, connectionId: current.connectionId ?? '',
      targetId: targetIdRef.current ?? '', mode: terminalContext.current.mode, watchGeneration: current.generation,
      routeGeneration: routeIdentity.current.generation, connected: terminalContext.current.connection === 'connected',
      routeCurrent: conversationId === context.ownerConversationId
        && conversationIdFromPath(window.location.pathname) === context.ownerConversationId,
    }));
  }

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

  async function loadThreads(loadMore: boolean, resetWatchFeedback = true, refreshContext?: CodexBridgeWatchRefreshContext) {
    const requestedTargetId = targetIdRef.current;
    if (!requestedTargetId || terminalContext.current.threadsBusy || (refreshContext && !isWatchRefreshContextCurrent(refreshContext))
      || (loadMore && (terminalContext.current.mode !== 'normal' || !nextCursor))) return;
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
      if (!requestTracker.current!.isCurrentThreads(request) || (refreshContext && !isWatchRefreshContextCurrent(refreshContext))) return;
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
      const selectionUpdate = reconcileCodexBridgeThreadSelection(selectedRef.current, updated, loadMore);
      if (selectionUpdate) { updateSelected(selectionUpdate.thread); setSelectedMissing(selectionUpdate.missing); }
    } catch {
      if (requestTracker.current!.isCurrentThreads(request) && (!refreshContext || isWatchRefreshContextCurrent(refreshContext))) {
        setThreadsError('Bridgeへ接続できません。');
        if (request.mode === 'running' && !loadMore) reportRunningSummary({ targetId: requestedTargetId, count: null, status: 'error' });
      }
    } finally {
      if (requestTracker.current!.isLatestThreads(request)) {
        updateThreadsBusy(false);
        const context = currentWatchRefreshContext();
        if (terminalRefresh.current.finishRunningRequest(requestedTargetId, {
          ownerConversationId: context?.ownerConversationId ?? null, connectionId: context?.connectionId ?? null,
          targetId: targetIdRef.current || null, mode: terminalContext.current.mode,
          connected: terminalContext.current.connection === 'connected',
          routeCurrent: Boolean(conversationId && conversationIdFromPath(window.location.pathname) === conversationId), threadsBusy: false,
        }) && context) void loadThreads(false, false, context);
      }
    }
  }

  async function loadRunningSummary(requestedTargetId: string, refreshContext?: CodexBridgeWatchRefreshContext) {
    if (refreshContext && !isWatchRefreshContextCurrent(refreshContext)) return;
    const generation = ++runningSummaryGeneration.current;
    reportRunningSummary({ targetId: requestedTargetId, count: null, status: 'loading' });
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CODEX_BRIDGE_MCP_GET_THREADS, targetId: requestedTargetId, runningOnly: true,
      });
      if (generation !== runningSummaryGeneration.current || targetIdRef.current !== requestedTargetId
        || (refreshContext && !isWatchRefreshContextCurrent(refreshContext))) return;
      if (!isReadResponse<CodexBridgeThreadPage>(response) || !response.ok
        || !isRecord(response.data) || !Array.isArray(response.data.threads) || response.data.nextCursor !== null) {
        const reason = isReadResponse(response) && !response.ok ? response.reason : null;
        reportRunningSummary({ targetId: requestedTargetId, count: null,
          status: reason === 'running-only-unsupported' ? 'unsupported' : 'error' });
        return;
      }
      reportRunningSummary({ targetId: requestedTargetId, count: response.data.threads.length, status: 'ready' });
    } catch {
      if (generation === runningSummaryGeneration.current && targetIdRef.current === requestedTargetId
        && (!refreshContext || isWatchRefreshContextCurrent(refreshContext))) {
        reportRunningSummary({ targetId: requestedTargetId, count: null, status: 'error' });
      }
    }
  }

  function handleTerminalEvents(events: readonly CodexBridgeTerminalEventSignal[]) {
    const requestedTargetId = targetIdRef.current || null;
    const context = currentWatchRefreshContext();
    const action = terminalRefresh.current.observe(events, {
      ownerConversationId: context?.ownerConversationId ?? null, connectionId: context?.connectionId ?? null,
      targetId: requestedTargetId, mode: terminalContext.current.mode, connected: terminalContext.current.connection === 'connected',
      routeCurrent: Boolean(conversationId && conversationIdFromPath(window.location.pathname) === conversationId),
      threadsBusy: terminalContext.current.threadsBusy,
    });
    if (action === 'threads' && context) void loadThreads(false, false, context);
    else if (action === 'summary' && requestedTargetId && context) void loadRunningSummary(requestedTargetId, context);
  }

  function handleWatchAdditions(batch: CodexBridgeWatchAdditionBatch) {
    if (batch.ownerConversationId !== conversationId || conversationIdFromPath(window.location.pathname) !== batch.ownerConversationId) return;
    const previous = watchSnapshot.current;
    const routeGeneration = routeIdentity.current.generation;
    const changed = Boolean(previous && (previous.ownerConversationId !== batch.ownerConversationId
      || previous.connectionId !== batch.connectionId || previous.routeGeneration !== routeGeneration));
    if (changed) {
      terminalRefresh.current.clearPending();
      runningSummaryGeneration.current += 1;
      reportRunningSummary({ targetId: targetIdRef.current || null, count: null, status: 'error' });
    }
    watchSnapshot.current = { ownerConversationId: batch.ownerConversationId, connectionId: batch.connectionId,
      generation: (previous?.generation ?? 0) + Number(changed), routeGeneration };
    const context = currentWatchRefreshContext();
    const action = terminalRefresh.current.observeWatchAdditions(batch.additions, {
      ownerConversationId: batch.ownerConversationId, connectionId: batch.connectionId,
      targetId: targetIdRef.current || null, mode: terminalContext.current.mode,
      connected: terminalContext.current.connection === 'connected', routeCurrent: true,
      threadsBusy: terminalContext.current.threadsBusy,
    });
    if (action === 'threads' && context) void loadThreads(false, false, context);
    else if (action === 'summary' && context) void loadRunningSummary(context.targetId, context);
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
  }, [connection, targetId, listMode, conversationId]);

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
            <CodexBridgeSelectedThreadDetails selected={selected} targetName={selectedTarget?.name ?? null}
              row={selectedListRow} status={selectedStatus} missing={selectedMissing} listError={threadsError}
              connectionError={connection === 'error'} listBusy={threadsBusy} listLoaded={threadsLoaded}
              statusBusy={statusBusy} statusError={statusError} onCheckStatus={() => { void checkSelectedStatus(); }} />
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
        onWatchAdditions={handleWatchAdditions}
      />
    </section>
  );
}
