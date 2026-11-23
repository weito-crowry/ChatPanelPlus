import { useEffect, useId, useRef, useState } from 'react';
import {
  CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY,
  CODEX_BRIDGE_THREAD_MONITOR_FOREGROUND_MS,
  CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH,
  CODEX_BRIDGE_WATCH_LIST,
  CODEX_BRIDGE_WATCH_ACK_EVENTS,
  CODEX_BRIDGE_WATCH_CLEAR_EVENTS,
  CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER,
  CODEX_BRIDGE_WATCH_START,
  type CodexBridgeWatchSnapshot,
  type CodexBridgeTerminalEvent,
  type CodexBridgeFinalAnswerResult,
  type CodexBridgeWatchListData,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeThread } from '../shared/codexbridge-mcp-protocol.ts';
import { conversationIdFromPath } from '../shared/conversation-route.ts';
import type { ConversationPanelWatchSelection } from '../shared/conversation-panel-state-repository.ts';
import { acknowledgeCodexBridgeEventIds } from './codexbridge-event-ack.ts';
import { clearCodexBridgeEventIds } from './codexbridge-event-clear.ts';
import {
  editorInsertionFailureLabel,
  filterOwnedWatchData,
  watchListFailureLabel,
  watchStartDisabledReason,
} from './codexbridge-watch-presentation.ts';
import { codexBridgeWatchThreadLabel } from './codexbridge-thread-presentation.ts';
import { CodexBridgeWatchList } from './CodexBridgeWatchList.tsx';
import { CodexBridgeWatchStartFeedback, codexBridgeWatchStartFailureLabel, currentCodexBridgeWatchStartIdentity } from './codexbridge-watch-start-feedback.ts';
import { stopOwnedCodexBridgeWatch } from './codexbridge-watch-actions.ts';
import {
  CODEX_BRIDGE_WATCH_LIST_TIMEOUT_MS,
  sendWatchListRequestWithTimeout,
  WatchListRequestCoordinator,
  type WatchListRequestKind,
} from './codexbridge-watch-list-coordinator.ts';
import {
  isRecord,
  parseCodexBridgeFinalAnswer,
  parseCodexBridgeWatchListResponse,
  type CodexBridgeWatchListFailureReason,
} from './codexbridge-watch-response.ts';
import { CodexBridgeNotificationCard } from './CodexBridgeNotificationCard.tsx';
import { captureSelectionForPaste, getBrowserEditorEnvironment, insertAtCaret } from './editor/adapter.ts';
import { CodexBridgeTerminalEventObserver } from './codexbridge-terminal-event-observer.ts';
import type { CodexBridgeTerminalEventSignal } from './codexbridge-terminal-refresh.ts';
type SelectedThread = Readonly<{ targetId: string; threadId: string }>;
const NO_WATCH_ITEMS: readonly CodexBridgeWatchSnapshot[] = [];
const NO_WATCH_EVENTS: readonly CodexBridgeTerminalEvent[] = [];
type Props = Readonly<{
  selected: SelectedThread | null;
  watchFeedbackResetToken?: number;
  foregroundEnabled: boolean;
  conversationId: string | null;
  threadCandidates?: readonly Pick<CodexBridgeThread, 'id' | 'targetId' | 'title'>[];
  bridgeWatchSelection: ConversationPanelWatchSelection | null;
  bridgeEventSelection: string | null;
  onSelectBridgeWatch: (selection: ConversationPanelWatchSelection | null) => void;
  onSelectBridgeEvent: (eventId: string | null) => void;
  onSummaryChange?: (summary: Readonly<{ watchingCount: number; unacknowledgedThreadCount: number }> | null) => void;
  onTerminalEvents?: (events: readonly CodexBridgeTerminalEventSignal[]) => void;
}>;
export function CodexBridgeWatchPanel({
  selected, watchFeedbackResetToken = 0, foregroundEnabled, conversationId, bridgeWatchSelection, bridgeEventSelection,
  threadCandidates = [], onSelectBridgeWatch, onSelectBridgeEvent, onSummaryChange, onTerminalEvents,
}: Props) {
  const [items, setItems] = useState<readonly CodexBridgeWatchSnapshot[]>([]);
  const [events, setEvents] = useState<readonly CodexBridgeTerminalEvent[]>([]);
  const [currentConnectionId, setCurrentConnectionId] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listFailure, setListFailure] = useState<CodexBridgeWatchListFailureReason | 'runtime-unavailable' | 'timeout' | null>(null);
  const [listConversationId, setListConversationId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [watchStartError, setWatchStartError] = useState('');
  const [watchMessage, setWatchMessage] = useState('');
  const [answer, setAnswer] = useState<Readonly<{ eventId: string; result: CodexBridgeFinalAnswerResult }> | null>(null);
  const [answerBusy, setAnswerBusy] = useState(false);
  const [answerMessage, setAnswerMessage] = useState('');
  const [eventOperationMessage, setEventOperationMessage] = useState('');
  const listRequests = useRef(new WatchListRequestCoordinator());
  const terminalEventObserver = useRef(new CodexBridgeTerminalEventObserver());
  const answerGeneration = useRef(0);
  const clearInFlight = useRef(false);
  const watchStartFeedback = useRef(new CodexBridgeWatchStartFeedback());
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const summaryCallbackRef = useRef(onSummaryChange);
  summaryCallbackRef.current = onSummaryChange;
  const terminalEventsCallbackRef = useRef(onTerminalEvents);
  terminalEventsCallbackRef.current = onTerminalEvents;
  const watchSelectionRef = useRef(bridgeWatchSelection);
  watchSelectionRef.current = bridgeWatchSelection;
  const eventSelectionRef = useRef(bridgeEventSelection);
  eventSelectionRef.current = bridgeEventSelection;
  const watchSelectionCallbackRef = useRef(onSelectBridgeWatch);
  watchSelectionCallbackRef.current = onSelectBridgeWatch;
  const eventSelectionCallbackRef = useRef(onSelectBridgeEvent);
  eventSelectionCallbackRef.current = onSelectBridgeEvent;
  const threadIdDescriptionPrefix = useId();
  const listIsCurrent = Boolean(conversationId && listConversationId === conversationId);
  const currentItems = listIsCurrent ? items : NO_WATCH_ITEMS;
  const currentEvents = listIsCurrent ? events : NO_WATCH_EVENTS;

  const currentWatchStartIdentity = () => currentCodexBridgeWatchStartIdentity(selectedRef.current, conversationIdRef.current);
  function setListData(data: CodexBridgeWatchListData, ownerConversationId: string) {
    const owned = filterOwnedWatchData(data, ownerConversationId);
    const newEvents = terminalEventObserver.current.observeSuccessfulSnapshot(ownerConversationId, data.currentConnectionId, owned.events);
    if (newEvents.length) terminalEventsCallbackRef.current?.(newEvents.map(({ connectionId, eventId, targetId }) => ({ connectionId, eventId, targetId })));
    setItems(owned.items);
    setEvents(owned.events);
    setListConversationId(ownerConversationId);
    const watchSelection = watchSelectionRef.current;
    if (watchSelection && !owned.items.some((item) => item.connectionId === watchSelection.connectionId
      && item.targetId === watchSelection.targetId && item.threadId === watchSelection.threadId)) {
      watchSelectionCallbackRef.current(null);
    }
    const eventSelection = eventSelectionRef.current;
    if (eventSelection && !owned.events.some((event) => event.eventId === eventSelection)) {
      eventSelectionCallbackRef.current(null);
    }
    setAnswer((current) => current && owned.events.some((event) => event.eventId === current.eventId) ? current : null);
    setCurrentConnectionId(data.currentConnectionId);
    summaryCallbackRef.current?.(owned.summary);
  }

  function reportListFailure(reason: CodexBridgeWatchListFailureReason | 'runtime-unavailable' | 'timeout') {
    setItems([]); setEvents([]); setListConversationId(null); setCurrentConnectionId(null); setListFailure(reason);
    summaryCallbackRef.current?.(null);
  }

  async function refreshList(kind: WatchListRequestKind = 'storage', clearStartError = false) {
    const requestConversationId = conversationIdRef.current;
    if (!requestConversationId) { setListLoading(false); return; }
    if (clearStartError) setWatchStartError('');
    const coordinator = listRequests.current;
    const token = coordinator.begin(requestConversationId, kind);
    if (!token) return;
    const showLoading = kind === 'initial' || kind === 'manual';
    if (showLoading) { setListLoading(true); setListFailure(null); }
    if (conversationIdFromPath(window.location.pathname) !== requestConversationId) {
      reportListFailure('sender-unverified');
      coordinator.finish(token, false);
      setListLoading(false);
      return;
    }
    let succeeded = false;
    try {
      const result = await sendWatchListRequestWithTimeout<unknown>(
        () => chrome.runtime.sendMessage({ type: kind === 'foreground' ? CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH : CODEX_BRIDGE_WATCH_LIST }),
        CODEX_BRIDGE_WATCH_LIST_TIMEOUT_MS,
      );
      if (!coordinator.isCurrent(token) || conversationIdRef.current !== requestConversationId
        || conversationIdFromPath(window.location.pathname) !== requestConversationId) return;
      if (result.kind === 'timeout') { reportListFailure('timeout'); return; }
      if (result.kind === 'send-error') { reportListFailure('runtime-unavailable'); return; }
      const parsed = parseCodexBridgeWatchListResponse(result.response);
      if (!parsed.ok) {
        reportListFailure(parsed.reason);
        return;
      }
      setListFailure(null);
      setListData(parsed.data, requestConversationId);
      succeeded = true;
    } catch {
      if (coordinator.isCurrent(token) && conversationIdRef.current === requestConversationId
        && conversationIdFromPath(window.location.pathname) === requestConversationId) reportListFailure('runtime-unavailable');
    } finally {
      if (coordinator.isCurrent(token) && conversationIdRef.current === requestConversationId) {
        if (conversationIdFromPath(window.location.pathname) !== requestConversationId) {
          reportListFailure('sender-unverified');
          succeeded = false;
        }
        coordinator.finish(token, succeeded);
        setListLoading(false);
      }
    }
  }

  useEffect(() => {
    watchStartFeedback.current.invalidate();
    listRequests.current.setRoute(conversationId);
    answerGeneration.current += 1;
    setItems([]);
    setEvents([]);
    setCurrentConnectionId(null);
    setListLoading(Boolean(conversationId));
    setListFailure(null);
    setListConversationId(null);
    setAnswer(null);
    setAnswerBusy(false);
    setAnswerMessage('');
    setEventOperationMessage('');
    setError('');
    setWatchMessage('');
    setBusyKey('');
    summaryCallbackRef.current?.(null);
    if (conversationId) void refreshList('initial');
  }, [conversationId]);

  useEffect(() => {
    watchStartFeedback.current.invalidate();
    setWatchStartError('');
    setWatchMessage('');
  }, [selected?.targetId, selected?.threadId]);
  useEffect(() => {
    setWatchStartError('');
    setWatchMessage('');
  }, [watchFeedbackResetToken]);
  useEffect(() => {
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') return;
      if (changes[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY]) void refreshList('storage');
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, []);
  useEffect(() => {
    if (!conversationId || listConversationId !== conversationId
      || conversationIdFromPath(window.location.pathname) !== conversationId) return;
    if (bridgeWatchSelection && !currentItems.some((item) => item.ownerConversationId === conversationId
      && item.connectionId === bridgeWatchSelection.connectionId && item.targetId === bridgeWatchSelection.targetId
      && item.threadId === bridgeWatchSelection.threadId)) watchSelectionCallbackRef.current(null);
    if (bridgeEventSelection && !currentEvents.some((event) => event.ownerConversationId === conversationId
      && event.eventId === bridgeEventSelection)) eventSelectionCallbackRef.current(null);
  }, [conversationId, listConversationId, currentItems, currentEvents, bridgeWatchSelection, bridgeEventSelection]);
  useEffect(() => {
    if (!foregroundEnabled) return;
    const isForeground = () => document.visibilityState === 'visible' && document.hasFocus();
    const refreshForeground = () => { if (isForeground()) void refreshList('foreground'); };
    const timer = window.setInterval(refreshForeground, CODEX_BRIDGE_THREAD_MONITOR_FOREGROUND_MS);
    document.addEventListener('visibilitychange', refreshForeground);
    window.addEventListener('focus', refreshForeground);
    refreshForeground();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshForeground);
      window.removeEventListener('focus', refreshForeground);
    };
  }, [foregroundEnabled]);

  async function startWatch() {
    const ownerConversationId = conversationIdRef.current;
    if (!selected || !ownerConversationId || listConversationId !== ownerConversationId || listLoading || listFailure
      || !currentConnectionId || conversationIdFromPath(window.location.pathname) !== ownerConversationId) return;
    const key = `start:${selected.targetId}:${selected.threadId}`;
    const ticket = watchStartFeedback.current.begin({ ...selected, conversationId: ownerConversationId });
    const isCurrent = () => watchStartFeedback.current.isCurrent(ticket, currentWatchStartIdentity())
      && conversationIdFromPath(window.location.pathname) === ownerConversationId;
    setBusyKey(key);
    setWatchStartError('');
    setWatchMessage('');
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CODEX_BRIDGE_WATCH_START,
        targetId: selected.targetId,
        threadId: selected.threadId,
        conversationId: ownerConversationId,
      });
      if (!isCurrent()) return;
      if (!isRecord(response) || response.ok !== true) {
        const reason = response && isRecord(response) ? response.reason : null;
        if (watchStartFeedback.current.recordFailure(ticket, currentWatchStartIdentity())) {
          setWatchStartError(codexBridgeWatchStartFailureLabel(reason));
        }
        return;
      }
      if (isRecord(response.data) && response.data.transferred === true) {
        setWatchStartError('');
        setWatchMessage('監視登録をこの会話へ移管しました。過去の通知は元の会話に残ります。');
      } else {
        setWatchStartError('');
      }
      await refreshList('action');
    } catch {
      if (watchStartFeedback.current.recordFailure(ticket, currentWatchStartIdentity())) {
        setWatchStartError('監視開始: 拡張機能から応答がありません。');
      }
    } finally {
      setBusyKey((current) => current === key ? '' : current);
    }
  }

  async function stopWatch(item: CodexBridgeWatchSnapshot) {
    await stopOwnedCodexBridgeWatch({ item, getConversationId: () => conversationIdRef.current,
      getPathname: () => window.location.pathname, sendMessage: (message) => chrome.runtime.sendMessage(message),
      refreshList: () => refreshList('action'), setBusyKey, setError });
  }
  function selectWatch(item: CodexBridgeWatchSnapshot) {
    const ownerConversationId = conversationIdRef.current;
    if (!ownerConversationId || item.ownerConversationId !== ownerConversationId
      || conversationIdFromPath(window.location.pathname) !== ownerConversationId) return;
    watchSelectionCallbackRef.current({ connectionId: item.connectionId, targetId: item.targetId, threadId: item.threadId });
  }
  function selectEvent(eventId: string) {
    const ownerConversationId = conversationIdRef.current;
    if (!ownerConversationId || conversationIdFromPath(window.location.pathname) !== ownerConversationId
      || !currentEvents.some((event) => event.eventId === eventId && event.ownerConversationId === ownerConversationId)) return;
    answerGeneration.current += 1;
    eventSelectionCallbackRef.current(eventId);
    setAnswer(null);
    setAnswerBusy(false);
    setAnswerMessage('');
    setEventOperationMessage('');
  }
  async function fetchSelectedAnswer() {
    const event = currentEvents.find((candidate) => candidate.eventId === bridgeEventSelection);
    const currentConversationId = conversationIdRef.current;
    if (!event || !currentConversationId || event.ownerConversationId !== currentConversationId
      || conversationIdFromPath(window.location.pathname) !== currentConversationId) return;
    if (event.connectionId !== currentConnectionId) {
      setAnswer({ eventId: event.eventId, result: { status: 'failed', reason: 'connection-changed' } });
      setAnswerMessage('');
      return;
    }
    const generation = ++answerGeneration.current;
    setAnswerBusy(true);
    setAnswer(null);
    setAnswerMessage('');
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER,
        eventId: event.eventId,
      });
      if (generation !== answerGeneration.current || eventSelectionRef.current !== event.eventId
        || conversationIdRef.current !== currentConversationId
        || conversationIdFromPath(window.location.pathname) !== event.ownerConversationId) return;
      const result = parseCodexBridgeFinalAnswer(response);
      setAnswer({ eventId: event.eventId, result: result ?? { status: 'failed', reason: 'protocol-error' } });
    } catch {
      if (generation === answerGeneration.current && eventSelectionRef.current === event.eventId) {
        setAnswer({ eventId: event.eventId, result: { status: 'failed', reason: 'unknown-error' } });
      }
    } finally {
      if (generation === answerGeneration.current) setAnswerBusy(false);
    }
  }

  async function acknowledgeVisibleEvents() {
    const currentConversationId = conversationIdRef.current;
    if (!currentConversationId || conversationIdFromPath(window.location.pathname) !== currentConversationId) return;
    const eventIds = [...currentEvents.filter((event) => !event.acknowledgedAt
      && event.ownerConversationId === currentConversationId).map((event) => event.eventId)];
    if (!eventIds.length || busyKey) return;
    setBusyKey('acknowledge');
    setError('');
    const isCurrent = () => conversationIdRef.current === currentConversationId
      && conversationIdFromPath(window.location.pathname) === currentConversationId;
    try {
      const result = await acknowledgeCodexBridgeEventIds(eventIds, async (batch) => {
        const response: unknown = await chrome.runtime.sendMessage({
          type: CODEX_BRIDGE_WATCH_ACK_EVENTS, conversationId: currentConversationId, eventIds: batch,
        });
        return isRecord(response) && response.ok === true;
      }, isCurrent);
      if (!isCurrent() || result.status === 'cancelled') return;
      await refreshList('action');
      if (result.status !== 'complete' && isCurrent()) {
        setError(`通知確認: ${result.confirmedCount}/${result.totalCount} 件を確認しました。一覧を再取得しました。未確認分は再試行できます。`);
      }
    } finally { setBusyKey(''); }
  }
  async function clearVisibleEvents() {
    const ownerConversationId = conversationIdRef.current;
    if (!ownerConversationId || conversationIdFromPath(window.location.pathname) !== ownerConversationId
      || busyKey || clearInFlight.current) return;
    const eventIds = [...new Set(currentEvents.filter((event) => event.ownerConversationId === ownerConversationId)
      .map((event) => event.eventId))];
    if (!eventIds.length || !window.confirm(`現在の会話に属する終了通知 ${eventIds.length} 件を削除します。監視登録は残ります。`)) return;
    clearInFlight.current = true;
    setBusyKey('clear');
    setError('');
    setEventOperationMessage('');
    answerGeneration.current += 1;
    const isCurrent = () => conversationIdRef.current === ownerConversationId
      && conversationIdFromPath(window.location.pathname) === ownerConversationId;
    try {
      const result = await clearCodexBridgeEventIds(eventIds, async (batch) => {
        const response: unknown = await chrome.runtime.sendMessage({
          type: CODEX_BRIDGE_WATCH_CLEAR_EVENTS, conversationId: ownerConversationId, eventIds: batch,
        });
        return isRecord(response) && response.ok === true && isRecord(response.data) && response.data.cleared === true;
      }, isCurrent);
      if (!isCurrent() || result.status === 'cancelled') return;
      await refreshList('action');
      if (!isCurrent()) return;
      if (result.status === 'complete') {
        setEventOperationMessage(`現在の会話の終了通知 ${result.clearedCount} 件を削除しました。監視登録は残っています。`);
        setAnswer(null);
        setAnswerBusy(false);
        setAnswerMessage('');
        if (bridgeEventSelection && eventIds.includes(bridgeEventSelection)) eventSelectionCallbackRef.current(null);
      } else {
        setError(`通知削除: ${result.clearedCount}/${result.totalCount} 件を削除しました。一覧を再取得しました。残りは再試行できます。`);
      }
    } finally { clearInFlight.current = false; setBusyKey(''); }
  }

  async function copyAnswer(event: CodexBridgeTerminalEvent, text: string) {
    if (conversationIdRef.current !== event.ownerConversationId
      || conversationIdFromPath(window.location.pathname) !== event.ownerConversationId) return;
    setAnswerMessage('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setAnswerMessage('最終回答をコピーしました。');
    } catch {
      setAnswerMessage('コピーできませんでした。ブラウザのクリップボード権限を確認してください。');
    }
  }
  function insertAnswer(event: CodexBridgeTerminalEvent, text: string) {
    if (conversationIdRef.current !== event.ownerConversationId
      || conversationIdFromPath(window.location.pathname) !== event.ownerConversationId) return;
    setAnswerMessage('');
    const environment = getBrowserEditorEnvironment();
    const snapshot = captureSelectionForPaste(environment);
    const result = insertAtCaret(text, environment, snapshot);
    if (result.ok) {
      setAnswerMessage('現在のChatGPT入力欄へ挿入しました。送信はしていません。');
      return;
    }
    setAnswerMessage(editorInsertionFailureLabel(result.reason));
  }
  const selectedWatch = selected && currentItems.find((item) => item.connectionId === currentConnectionId
    && item.targetId === selected.targetId && item.threadId === selected.threadId);
  const selectedEvent = currentEvents.find((event) => event.eventId === bridgeEventSelection
    && event.ownerConversationId === conversationId) ?? null;
  const displayedAnswer = answer && selectedEvent && answer.eventId === selectedEvent.eventId ? answer.result : null;
  const routeConversationValid = Boolean(conversationId && conversationIdFromPath(window.location.pathname) === conversationId);
  const startDisabledReason = watchStartDisabledReason({
    busy: busyKey !== '', conversationValid: routeConversationValid, loading: listLoading || !listIsCurrent,
    listFailure: listFailure !== null, connectionId: currentConnectionId, selected: selected !== null,
  });
  const startReasonId = `${threadIdDescriptionPrefix}-start-disabled-reason`;
  if (!routeConversationValid) return (
    <section className="codex-bridge-watch phase6-card phase6-card-b" aria-label="選択スレッド・監視中">
      <div className="codex-bridge-heading"><h2>B 選択スレッド・監視中</h2><span>—</span></div>
      <button type="button" className="codex-bridge-button" disabled aria-describedby={startReasonId}>選択threadの監視を開始</button>
      <small id={startReasonId} role="status">会話IDを確認できないため、監視情報を表示・変更していません。</small>
    </section>
  );
  return (
    <>
    <section className="codex-bridge-watch phase6-card phase6-card-b" aria-label="選択スレッド・監視中">
      <div className="codex-bridge-heading">
        <h2>B 選択スレッド・監視中</h2>
        <span>{listIsCurrent && !listFailure ? `${currentItems.length}件` : '—'}</span>
      </div>
      {selectedWatch
        ? <button type="button" className="codex-bridge-button" onClick={() => { void stopWatch(selectedWatch); }} disabled={busyKey !== ''}>
          {busyKey === `stop:${selectedWatch.watchId}` ? '解除中…' : '選択threadの監視を解除'}
        </button>
        : <>
        <button type="button" className="codex-bridge-button" onClick={() => { void startWatch(); }}
          disabled={startDisabledReason !== ''} aria-describedby={startDisabledReason ? startReasonId : undefined}
          title={startDisabledReason || '選択threadの監視を開始'}>
          {busyKey.startsWith('start:') ? '登録中…' : '選択threadの監視を開始'}
        </button>
        {startDisabledReason && <small id={startReasonId} className="codex-bridge-note" role="status">{startDisabledReason}</small>}
        </>}
      {listLoading && <p className="codex-bridge-empty" role="status">監視一覧を読み込み中…</p>}
      {listFailure && <p className="codex-bridge-error" role="alert">{watchListFailureLabel(listFailure)}
        <button type="button" className="codex-bridge-button" disabled={listLoading}
          onClick={() => { void refreshList('manual', true); }}>再試行</button>
      </p>}
      {error && <p className="codex-bridge-error" role="alert">{error}</p>}
      {watchStartError && <p className="codex-bridge-error" role="alert">{watchStartError}</p>}
      {watchMessage && <p className="codex-bridge-note" role="status">{watchMessage}</p>}
      {currentItems.length === 0 && listIsCurrent && !listLoading && !listFailure
        && <p className="codex-bridge-empty">監視対象はありません。threadを選んで明示的に開始してください。</p>}
      {currentItems.length > 0 && <CodexBridgeWatchList items={currentItems} currentConnectionId={currentConnectionId}
        selection={bridgeWatchSelection} threadCandidates={threadCandidates} busyKey={busyKey}
        onSelect={selectWatch} onStop={(item) => { void stopWatch(item); }} />}
    </section>
    <CodexBridgeNotificationCard
      events={currentEvents} selectedEvent={selectedEvent} selectedEventId={bridgeEventSelection}
      currentConnectionId={currentConnectionId} busyKey={busyKey} answerBusy={answerBusy}
      answerMessage={answerMessage} operationMessage={eventOperationMessage} displayedAnswer={displayedAnswer}
      threadLabel={(targetId, threadId) => codexBridgeWatchThreadLabel(threadCandidates, targetId, threadId, false)}
      onAcknowledge={() => { void acknowledgeVisibleEvents(); }} onClear={() => { void clearVisibleEvents(); }} onSelectEvent={selectEvent}
      onFetchAnswer={() => { void fetchSelectedAnswer(); }} onCopyAnswer={copyAnswer} onInsertAnswer={insertAnswer}
    />
    </>
  );
}
