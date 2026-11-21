import { useEffect, useId, useRef, useState } from 'react';
import {
  CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY,
  CODEX_BRIDGE_THREAD_MONITOR_FOREGROUND_MS,
  CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH,
  CODEX_BRIDGE_WATCH_LIST,
  CODEX_BRIDGE_WATCH_ACK_EVENTS,
  CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER,
  CODEX_BRIDGE_WATCH_START,
  CODEX_BRIDGE_WATCH_STOP,
  deriveCodexBridgeWatchTurnState,
  isCodexBridgeTerminalEvent,
  type CodexBridgeWatchFetchOutcome,
  type CodexBridgeWatchSnapshot,
  type CodexBridgeTerminalEvent,
  type CodexBridgeFinalAnswerResult,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeThread } from '../shared/codexbridge-mcp-protocol.ts';
import { conversationIdFromPath } from '../shared/conversation-route.ts';
import type { ConversationPanelWatchSelection } from '../shared/conversation-panel-state-repository.ts';
import { acknowledgeCodexBridgeEventIds } from './codexbridge-event-ack.ts';
import { editorInsertionFailureLabel, filterOwnedWatchData } from './codexbridge-watch-presentation.ts';
import { codexBridgeThreadDisplayName } from './codexbridge-thread-presentation.ts';
import { CodexBridgeNotificationCard } from './CodexBridgeNotificationCard.tsx';
import { captureSelectionForPaste, getBrowserEditorEnvironment, insertAtCaret } from './editor/adapter.ts';
type SelectedThread = Readonly<{ targetId: string; threadId: string }>;
type Props = Readonly<{
  selected: SelectedThread | null;
  foregroundEnabled: boolean;
  conversationId: string | null;
  threadCandidates?: readonly Pick<CodexBridgeThread, 'id' | 'targetId' | 'title'>[];
  bridgeWatchSelection: ConversationPanelWatchSelection | null;
  bridgeEventSelection: string | null;
  onSelectBridgeWatch: (selection: ConversationPanelWatchSelection | null) => void;
  onSelectBridgeEvent: (eventId: string | null) => void;
  onSummaryChange?: (summary: Readonly<{ watchingCount: number; unacknowledgedThreadCount: number }> | null) => void;
}>;
type ListData = Readonly<{
  items: readonly CodexBridgeWatchSnapshot[];
  events: readonly CodexBridgeTerminalEvent[];
  currentConnectionId: string | null;
  summary: Readonly<{ watchingCount: number; unacknowledgedThreadCount: number }>;
}>;

const OUTCOME_LABELS: Record<CodexBridgeWatchFetchOutcome, string> = {
  ok: '取得成功', '401': '認証失敗（401）', '403': '拒否（403）', timeout: 'timeout',
  disconnected: '切断', unknown: '不明', 'permission-required': '権限なし',
  'settings-unavailable': '接続設定またはtokenを取得できません', 'endpoint-not-found': 'endpointなし',
  'session-expired': 'MCP session失効', 'http-error': 'HTTPエラー', 'protocol-error': '応答形式不明',
  'protocol-version-unsupported': 'protocol version非対応', 'readonly-tool-unavailable': 'codex_statusなし',
  'readonly-probe-failed': 'codex_status失敗', 'connection-changed': '接続先変更',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWatchSnapshot(value: unknown): value is CodexBridgeWatchSnapshot {
  return isRecord(value) && typeof value.watchId === 'string' && typeof value.connectionId === 'string'
    && typeof value.targetId === 'string' && typeof value.threadId === 'string' && value.enabled === true
    && typeof value.baselineCaptured === 'boolean' && typeof value.fetchOutcome === 'string';
}

function readWatchList(value: unknown): ListData | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.data) || !Array.isArray(value.data.items)
    || !(typeof value.data.currentConnectionId === 'string' || value.data.currentConnectionId === null)
    || !isRecord(value.data.summary) || !Number.isSafeInteger(value.data.summary.watchingCount)
    || !Number.isSafeInteger(value.data.summary.unacknowledgedThreadCount)) return null;
  return {
    items: value.data.items.filter(isWatchSnapshot),
    events: Array.isArray(value.data.events) ? value.data.events.filter(isCodexBridgeTerminalEvent) : [],
    currentConnectionId: value.data.currentConnectionId,
    summary: {
      watchingCount: value.data.summary.watchingCount as number,
      unacknowledgedThreadCount: value.data.summary.unacknowledgedThreadCount as number,
    },
  };
}

function readFinalAnswer(value: unknown): CodexBridgeFinalAnswerResult | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.data)) return null;
  const data = value.data;
  if (data.status === 'retrieved' && typeof data.text === 'string' && data.text.length <= 256 * 1024
    && data.completeness === 'unconfirmed') {
    return { status: 'retrieved', text: data.text, completeness: 'unconfirmed' };
  }
  if (data.status === 'no-final-answer' && data.completeness === 'unconfirmed') {
    return { status: 'no-final-answer', completeness: 'unconfirmed' };
  }
  if (data.status === 'pending') return { status: 'pending' };
  if (data.status === 'incomplete' && ['history-too-large', 'text-too-large', 'malformed-history', 'turn-not-found',
    'multiple-matching-turns', 'multiple-final-answers'].includes(String(data.reason))
    && data.completeness === 'unconfirmed') {
    return { status: 'incomplete', reason: data.reason as Extract<CodexBridgeFinalAnswerResult, { status: 'incomplete' }>['reason'], completeness: 'unconfirmed' };
  }
  if (data.status === 'failed' && ['connection-changed', 'event-not-found', 'authentication-required', 'forbidden',
    'endpoint-not-found', 'session-expired', 'http-error', 'disconnected', 'timeout', 'protocol-error',
    'protocol-version-unsupported', 'readonly-tool-unavailable', 'readonly-probe-failed', 'permission-required',
    'settings-unavailable', 'unknown-error'].includes(String(data.reason))) {
    return { status: 'failed', reason: data.reason as Extract<CodexBridgeFinalAnswerResult, { status: 'failed' }>['reason'] };
  }
  return null;
}

function dateLabel(value: string | null): string {
  if (value === null) return '未取得';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('ja-JP') : '不明';
}

function turnStateLabel(snapshot: CodexBridgeWatchSnapshot, sameConnection: boolean): string {
  if (!sameConnection) return '現在の接続先では未確認';
  if (snapshot.fetchOutcome !== 'ok') return '最新取得に失敗、現在状態不明';
  const state = deriveCodexBridgeWatchTurnState(snapshot);
  if (state === 'baseline') return '登録時のturn（新規完了ではありません）';
  if (state === 'running') return '別turnの実行を観測';
  if (state === 'in_progress') return '進行中';
  if (state === 'completed') return '新しいturnの完了を観測';
  if (state === 'failed') return '新しいturnの失敗を観測';
  if (state === 'interrupted') return '新しいturnの中断を観測';
  if (state === 'gap') return '観測gapあり（中間turn不明）';
  return '不明';
}

function connectionLabel(connectionId: string): string {
  return connectionId.length > 20 ? `${connectionId.slice(0, 15)}…${connectionId.slice(-6)}` : connectionId;
}

export function CodexBridgeWatchPanel({
  selected, foregroundEnabled, conversationId, bridgeWatchSelection, bridgeEventSelection,
  threadCandidates = [], onSelectBridgeWatch, onSelectBridgeEvent, onSummaryChange,
}: Props) {
  const [items, setItems] = useState<readonly CodexBridgeWatchSnapshot[]>([]);
  const [events, setEvents] = useState<readonly CodexBridgeTerminalEvent[]>([]);
  const [currentConnectionId, setCurrentConnectionId] = useState<string | null>(null);
  const [listConversationId, setListConversationId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState<Readonly<{ eventId: string; result: CodexBridgeFinalAnswerResult }> | null>(null);
  const [answerBusy, setAnswerBusy] = useState(false);
  const [answerMessage, setAnswerMessage] = useState('');
  const listGeneration = useRef(0);
  const answerGeneration = useRef(0);
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const summaryCallbackRef = useRef(onSummaryChange);
  summaryCallbackRef.current = onSummaryChange;
  const watchSelectionRef = useRef(bridgeWatchSelection);
  watchSelectionRef.current = bridgeWatchSelection;
  const eventSelectionRef = useRef(bridgeEventSelection);
  eventSelectionRef.current = bridgeEventSelection;
  const watchSelectionCallbackRef = useRef(onSelectBridgeWatch);
  watchSelectionCallbackRef.current = onSelectBridgeWatch;
  const eventSelectionCallbackRef = useRef(onSelectBridgeEvent);
  eventSelectionCallbackRef.current = onSelectBridgeEvent;
  const threadIdDescriptionPrefix = useId();

  function setListData(data: ListData, ownerConversationId: string) {
    const owned = filterOwnedWatchData(data, ownerConversationId);
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

  async function refreshList() {
    const requestConversationId = conversationIdRef.current;
    if (!requestConversationId || conversationIdFromPath(window.location.pathname) !== requestConversationId) return;
    const generation = ++listGeneration.current;
    try {
      const response: unknown = await chrome.runtime.sendMessage({ type: CODEX_BRIDGE_WATCH_LIST });
      if (generation !== listGeneration.current || conversationIdRef.current !== requestConversationId
        || conversationIdFromPath(window.location.pathname) !== requestConversationId) return;
      const data = readWatchList(response);
      if (!data) return;
      setListData(data, requestConversationId);
    } catch {
      if (generation === listGeneration.current) setError('監視一覧を読み取れません。');
    }
  }

  useEffect(() => {
    listGeneration.current += 1;
    answerGeneration.current += 1;
    setItems([]);
    setEvents([]);
    setCurrentConnectionId(null);
    setListConversationId(null);
    setAnswer(null);
    setAnswerBusy(false);
    setAnswerMessage('');
    setError('');
    setBusyKey('');
    summaryCallbackRef.current?.(null);
    if (conversationId) void refreshList();
  }, [conversationId]);

  useEffect(() => {
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') return;
      if (changes[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY]) void refreshList();
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  useEffect(() => {
    if (!conversationId || listConversationId !== conversationId
      || conversationIdFromPath(window.location.pathname) !== conversationId) return;
    if (bridgeWatchSelection && !items.some((item) => item.ownerConversationId === conversationId
      && item.connectionId === bridgeWatchSelection.connectionId && item.targetId === bridgeWatchSelection.targetId
      && item.threadId === bridgeWatchSelection.threadId)) watchSelectionCallbackRef.current(null);
    if (bridgeEventSelection && !events.some((event) => event.ownerConversationId === conversationId
      && event.eventId === bridgeEventSelection)) eventSelectionCallbackRef.current(null);
  }, [conversationId, listConversationId, items, events, bridgeWatchSelection, bridgeEventSelection]);

  useEffect(() => {
    if (!foregroundEnabled) return;
    const isForeground = () => document.visibilityState === 'visible' && document.hasFocus();
    const refreshForeground = () => {
      const requestConversationId = conversationIdRef.current;
      if (!isForeground() || !requestConversationId || conversationIdFromPath(window.location.pathname) !== requestConversationId) return;
      const generation = ++listGeneration.current;
      void chrome.runtime.sendMessage({ type: CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH })
        .then((response: unknown) => {
          if (generation !== listGeneration.current || conversationIdRef.current !== requestConversationId
            || conversationIdFromPath(window.location.pathname) !== requestConversationId) return;
          const data = readWatchList(response);
          if (data) setListData(data, requestConversationId);
        })
        .catch(() => {});
    };
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
    if (!selected || !ownerConversationId || conversationIdFromPath(window.location.pathname) !== ownerConversationId) return;
    const key = `start:${selected.targetId}:${selected.threadId}`;
    setBusyKey(key);
    setError('');
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CODEX_BRIDGE_WATCH_START,
        targetId: selected.targetId,
        threadId: selected.threadId,
        conversationId: ownerConversationId,
      });
      if (conversationIdRef.current !== ownerConversationId
        || conversationIdFromPath(window.location.pathname) !== ownerConversationId) return;
      if (!isRecord(response) || response.ok !== true) {
        const reason = response && isRecord(response) ? response.reason : null;
        setError(reason === 'watch-limit' ? '監視件数の上限に達しています。不要な監視を解除してください。'
          : reason === 'owner-conflict' ? 'このthreadは別会話の登録元で監視中です。登録元会話から解除してください。'
            : '監視を開始できません。接続先・権限を確認してください。');
      }
      await refreshList();
    } catch {
      if (conversationIdRef.current === ownerConversationId) setError('監視を開始できません。');
    } finally {
      setBusyKey('');
    }
  }

  async function stopWatch(item: CodexBridgeWatchSnapshot) {
    const currentConversationId = conversationIdRef.current;
    if (!currentConversationId || item.ownerConversationId !== currentConversationId
      || conversationIdFromPath(window.location.pathname) !== currentConversationId) return;
    const key = `stop:${item.watchId}`;
    setBusyKey(key);
    setError('');
    try {
      await chrome.runtime.sendMessage({
        type: CODEX_BRIDGE_WATCH_STOP,
        connectionId: item.connectionId,
        targetId: item.targetId,
        threadId: item.threadId,
      });
      if (conversationIdRef.current !== currentConversationId
        || conversationIdFromPath(window.location.pathname) !== currentConversationId) return;
      await refreshList();
    } catch {
      if (conversationIdRef.current === currentConversationId) setError('監視を解除できません。');
    } finally {
      setBusyKey('');
    }
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
      || !events.some((event) => event.eventId === eventId && event.ownerConversationId === ownerConversationId)) return;
    answerGeneration.current += 1;
    eventSelectionCallbackRef.current(eventId);
    setAnswer(null);
    setAnswerBusy(false);
    setAnswerMessage('');
  }

  async function fetchSelectedAnswer() {
    const event = events.find((candidate) => candidate.eventId === bridgeEventSelection);
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
      const result = readFinalAnswer(response);
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
    const eventIds = [...events.filter((event) => !event.acknowledgedAt
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
      await refreshList();
      if (result.status !== 'complete' && isCurrent()) {
        setError(`終了通知の確認応答が ${result.confirmedCount}/${result.totalCount} 件です。一覧を再取得しました。未確認分は再試行できます。`);
      }
    } finally { setBusyKey(''); }
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

  const selectedWatch = selected && items.find((item) => item.connectionId === currentConnectionId
    && item.targetId === selected.targetId && item.threadId === selected.threadId);
  const selectedEvent = events.find((event) => event.eventId === bridgeEventSelection
    && event.ownerConversationId === conversationId) ?? null;
  const displayedAnswer = answer && selectedEvent && answer.eventId === selectedEvent.eventId ? answer.result : null;
  function threadLabel(targetId: string, threadId: string, fallbackToId: boolean) {
    const candidate = threadCandidates.find((thread) => thread.targetId === targetId && thread.id === threadId);
    if (!candidate) return fallbackToId ? threadId : '監視スレッド';
    if (fallbackToId) return codexBridgeThreadDisplayName(candidate.title, threadId);
    return candidate.title?.trim() || '表示名未取得';
  }
  if (!conversationId || conversationIdFromPath(window.location.pathname) !== conversationId) return null;

  return (
    <>
    <section className="codex-bridge-watch phase6-card phase6-card-b" aria-label="選択スレッド・監視中">
      <div className="codex-bridge-heading">
        <h2>B 選択スレッド・監視中</h2>
        <span>{items.length}件</span>
      </div>
      {selected && (selectedWatch
        ? <button type="button" className="codex-bridge-button" onClick={() => { void stopWatch(selectedWatch); }} disabled={busyKey !== ''}>
          {busyKey === `stop:${selectedWatch.watchId}` ? '解除中…' : '選択threadの監視を解除'}
        </button>
        : <button type="button" className="codex-bridge-button" onClick={() => { void startWatch(); }} disabled={busyKey !== '' || !currentConnectionId || !conversationId}>
          {busyKey.startsWith('start:') ? '登録中…' : '選択threadの監視を開始'}
        </button>)}
      {error && <p className="codex-bridge-error" role="alert">{error}</p>}
      {items.length === 0 && <p className="codex-bridge-empty">監視対象はありません。threadを選んで明示的に開始してください。</p>}
      {items.length > 0 && <ul className="codex-bridge-watch-list" aria-label="監視対象一覧">
        {items.map((item, index) => {
          const sameConnection = item.connectionId === currentConnectionId;
          const outcome = OUTCOME_LABELS[item.fetchOutcome] ?? '不明';
          const isSelected = bridgeWatchSelection?.connectionId === item.connectionId
            && bridgeWatchSelection.targetId === item.targetId && bridgeWatchSelection.threadId === item.threadId;
          const threadIdDescriptionId = `${threadIdDescriptionPrefix}-watch-${index}`;
          return <li key={item.watchId} className="codex-bridge-watch-item">
            <div className="codex-bridge-watch-heading">
              <button type="button" title={item.threadId} aria-describedby={threadIdDescriptionId}
                className="codex-bridge-watch-select" aria-pressed={isSelected} onClick={() => selectWatch(item)}>
                <strong>{threadLabel(item.targetId, item.threadId, true)}</strong>
              </button>
              <span id={threadIdDescriptionId} className="phase6-sr-only">スレッドID：{item.threadId}</span>
              <button type="button" className="codex-bridge-button" onClick={() => { void stopWatch(item); }}
                disabled={busyKey !== ''} aria-label={`${item.threadId}の監視を解除`}>
                {busyKey === `stop:${item.watchId}` ? '解除中…' : '解除'}
              </button>
            </div>
            <small className="phase6-watch-status">{turnStateLabel(item, sameConnection)}</small>
            <details className="phase6-technical-details">
              <summary>技術情報</summary>
              <small>thread ID: {item.threadId} · target ID: {item.targetId}</small>
              <small>connection ID: {connectionLabel(item.connectionId)}</small>
              <small>取得: {outcome} · {dateLabel(item.observedAt)} · 最終成功: {dateLabel(item.lastSuccessAt)}</small>
              <small>baseline: {item.baselineTurnId ?? '不明'} · 最終観測: {item.lastObservedTurnId ?? '不明'}</small>
              <small>codex_status: {item.statusState ?? '不明'} · last_turn: {item.lastTurnStatus ?? '不明'} / {item.lastTurnEvidence ?? '不明'}</small>
              <small>current_execution: {item.currentExecutionState ?? '不明'} · turn_id: {item.currentExecutionTurnId ?? '不明'} / {item.currentExecutionEvidence ?? '不明'}</small>
              <small>needs_attention: {item.needsAttention === true ? '要対応' : item.needsAttention === false ? '不要' : '不明'}</small>
            </details>
          </li>;
        })}
      </ul>}
    </section>
    <CodexBridgeNotificationCard
      events={events} selectedEvent={selectedEvent} selectedEventId={bridgeEventSelection}
      currentConnectionId={currentConnectionId} busyKey={busyKey} answerBusy={answerBusy}
      answerMessage={answerMessage} displayedAnswer={displayedAnswer}
      threadLabel={(targetId, threadId) => threadLabel(targetId, threadId, false)}
      onAcknowledge={() => { void acknowledgeVisibleEvents(); }} onSelectEvent={selectEvent}
      onFetchAnswer={() => { void fetchSelectedAnswer(); }} onCopyAnswer={copyAnswer} onInsertAnswer={insertAnswer}
    />
    </>
  );
}
