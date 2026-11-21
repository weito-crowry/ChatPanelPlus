import { useEffect, useRef, useState } from 'react';
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
import { conversationIdFromPath } from '../shared/conversation-route.ts';
import { captureSelectionForPaste, getBrowserEditorEnvironment, insertAtCaret } from './editor/adapter.ts';

type SelectedThread = Readonly<{ targetId: string; threadId: string }>;
type Props = Readonly<{
  selected: SelectedThread | null;
  foregroundEnabled: boolean;
  conversationId: string | null;
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

export function CodexBridgeWatchPanel({ selected, foregroundEnabled, conversationId, onSummaryChange }: Props) {
  const [items, setItems] = useState<readonly CodexBridgeWatchSnapshot[]>([]);
  const [events, setEvents] = useState<readonly CodexBridgeTerminalEvent[]>([]);
  const [currentConnectionId, setCurrentConnectionId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [answer, setAnswer] = useState<Readonly<{ eventId: string; result: CodexBridgeFinalAnswerResult }> | null>(null);
  const [answerBusy, setAnswerBusy] = useState(false);
  const [answerMessage, setAnswerMessage] = useState('');
  const listGeneration = useRef(0);
  const answerGeneration = useRef(0);
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const summaryCallbackRef = useRef(onSummaryChange);
  summaryCallbackRef.current = onSummaryChange;

  function setListData(data: ListData) {
    setItems(data.items);
    setEvents(data.events);
    setSelectedEventId((current) => data.events.some((event) => event.eventId === current) ? current : '');
    setAnswer((current) => current && data.events.some((event) => event.eventId === current.eventId) ? current : null);
    setCurrentConnectionId(data.currentConnectionId);
    summaryCallbackRef.current?.(data.summary);
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
      setListData(data);
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
    setSelectedEventId('');
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
          if (data) setListData(data);
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

  function selectEvent(eventId: string) {
    answerGeneration.current += 1;
    setSelectedEventId(eventId);
    setAnswer(null);
    setAnswerBusy(false);
    setAnswerMessage('');
  }

  async function fetchSelectedAnswer() {
    const event = events.find((candidate) => candidate.eventId === selectedEventId);
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
      if (generation !== answerGeneration.current || selectedEventId !== event.eventId
        || conversationIdRef.current !== currentConversationId
        || conversationIdFromPath(window.location.pathname) !== event.ownerConversationId) return;
      const result = readFinalAnswer(response);
      setAnswer({ eventId: event.eventId, result: result ?? { status: 'failed', reason: 'protocol-error' } });
    } catch {
      if (generation === answerGeneration.current && selectedEventId === event.eventId) {
        setAnswer({ eventId: event.eventId, result: { status: 'failed', reason: 'unknown-error' } });
      }
    } finally {
      if (generation === answerGeneration.current) setAnswerBusy(false);
    }
  }

  async function acknowledgeVisibleEvents() {
    const currentConversationId = conversationIdRef.current;
    if (!currentConversationId || conversationIdFromPath(window.location.pathname) !== currentConversationId) return;
    const eventIds = events.filter((event) => !event.acknowledgedAt
      && event.ownerConversationId === currentConversationId).map((event) => event.eventId);
    if (!eventIds.length || busyKey) return;
    setBusyKey('acknowledge');
    setError('');
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CODEX_BRIDGE_WATCH_ACK_EVENTS, conversationId: currentConversationId, eventIds,
      });
      if (conversationIdRef.current !== currentConversationId
        || conversationIdFromPath(window.location.pathname) !== currentConversationId) return;
      if (!isRecord(response) || response.ok !== true) { setError('終了通知を確認できません。'); return; }
      await refreshList();
    } catch {
      if (conversationIdRef.current === currentConversationId) setError('終了通知を確認できません。');
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
    const labels: Record<string, string> = {
      'ime-composing': 'IME変換中のため挿入しませんでした。',
      'composer-changed': '入力欄が切り替わったため挿入しませんでした。',
      'editor-not-found': 'ChatGPT入力欄が見つからないため挿入しませんでした。',
      'editor-hidden': 'ChatGPT入力欄が表示されていないため挿入しませんでした。',
      'editor-disabled': 'ChatGPT入力欄が編集できないため挿入しませんでした。',
      'selection-invalid': '入力位置を確認できないため挿入しませんでした。',
      'edit-rejected': 'ChatGPT入力欄が挿入を受け付けませんでした。',
      'edit-unconfirmed': '挿入結果を確認できないため、再試行しませんでした。',
      'unexpected-error': '挿入結果を確認できないため、再試行しませんでした。',
      'complex-content': '複雑な入力欄を確認できないため挿入しませんでした。',
    };
    setAnswerMessage(labels[result.reason] ?? '入力欄へ挿入できませんでした。');
  }

  function eventStatusLabel(event: CodexBridgeTerminalEvent): string {
    const state: Record<CodexBridgeTerminalEvent['notificationState'], string> = {
      pending: '音声通知結果不明（再試行なし）', requested: '音声要求済み（再生結果不明、再試行なし）',
      played: '音声再生成功', skipped: event.notificationReason === 'disabled' ? '音声通知無効' : '音声通知スキップ',
      failed: '音声再生失敗',
    };
    return state[event.notificationState];
  }

  function eventKindLabel(status: CodexBridgeTerminalEvent['status']): string {
    return status === 'completed' ? '完了' : status === 'failed' ? '失敗' : '中断';
  }

  function finalAnswerLabel(result: CodexBridgeFinalAnswerResult): string {
    if (result.status === 'retrieved') return '本文を取得しました。完全性は未確認です。';
    if (result.status === 'no-final-answer') return 'このturnのfinal_answerは見つかりませんでした。完全性は未確認です。';
    if (result.status === 'pending') return 'turnが未完了のため、取得を保留しました。';
    if (result.status === 'incomplete') {
      const labels: Record<typeof result.reason, string> = {
        'history-too-large': '履歴または本文が上限を超えたため、結果は不完全です。',
        'text-too-large': '本文が上限を超えたため、無言で切り詰めず取得を止めました。',
        'malformed-history': '履歴形式を確認できないため、最終回答を特定できません。',
        'turn-not-found': '指定turnを履歴内で確認できません。履歴応答の切り詰め情報がないため不完全です。',
        'multiple-matching-turns': '指定turnの候補が複数あり、回答を特定できません。',
        'multiple-final-answers': '最終回答候補が複数あり、本文を選べません。',
      };
      return labels[result.reason];
    }
    const labels: Record<typeof result.reason, string> = {
      'connection-changed': '接続先がイベント発生時から変わったため取得しませんでした。',
      'event-not-found': '選択したイベントが台帳にありません。',
      'authentication-required': '認証に失敗しました。', forbidden: 'Bridgeから拒否されました。',
      'endpoint-not-found': 'MCP endpointが見つかりません。', 'session-expired': 'MCP sessionが失効しました。',
      'http-error': 'BridgeからHTTPエラーが返りました。', disconnected: 'Bridgeに接続できません。',
      timeout: 'Bridgeへの要求がタイムアウトしました。', 'protocol-error': 'Bridgeの応答形式を確認できません。',
      'protocol-version-unsupported': 'MCP protocol versionに対応していません。',
      'readonly-tool-unavailable': 'codex_threads読み取りtoolがありません。',
      'readonly-probe-failed': 'codex_threadsの読み取りに失敗しました。',
      'permission-required': '接続先へのアクセス権限がありません。',
      'settings-unavailable': '接続設定を読み取れません。', 'unknown-error': '最終回答を取得できませんでした。',
    };
    return labels[result.reason];
  }

  const selectedWatch = selected && items.find((item) => item.connectionId === currentConnectionId
    && item.targetId === selected.targetId && item.threadId === selected.threadId);
  const selectedEvent = events.find((event) => event.eventId === selectedEventId) ?? null;
  const displayedAnswer = answer && selectedEvent && answer.eventId === selectedEvent.eventId ? answer.result : null;
  if (!conversationId || conversationIdFromPath(window.location.pathname) !== conversationId) return null;

  return (
    <section className="codex-bridge-watch" aria-label="CodexBridgeスレッド監視">
      <div className="codex-bridge-heading">
        <h3>スレッド監視</h3>
        <span>{items.length} / 32</span>
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
        {items.map((item) => {
          const sameConnection = item.connectionId === currentConnectionId;
          const outcome = OUTCOME_LABELS[item.fetchOutcome] ?? '不明';
          return <li key={item.watchId} className="codex-bridge-watch-item">
            <div className="codex-bridge-watch-heading">
              <strong>{item.targetId} / {item.threadId}</strong>
              <button type="button" className="codex-bridge-button" onClick={() => { void stopWatch(item); }}
                disabled={busyKey !== ''} aria-label={`${item.threadId}の監視を解除`}>
                {busyKey === `stop:${item.watchId}` ? '解除中…' : '解除'}
              </button>
            </div>
            <small>connection ID: {connectionLabel(item.connectionId)}{sameConnection ? '' : '（現在の接続先と異なります）'}</small>
            <small>取得: {outcome} · {dateLabel(item.observedAt)} · 最終成功: {dateLabel(item.lastSuccessAt)}</small>
            <small>turn: {turnStateLabel(item, sameConnection)} · baseline: {item.baselineTurnId ?? '不明'} · 最終観測: {item.lastObservedTurnId ?? '不明'}</small>
            <small>codex_status state（最終成功時）: {item.statusState ?? '不明'}</small>
            <small>last_turn（最終成功時 {dateLabel(item.lastSuccessAt)}）: {item.lastTurnStatus ?? '不明'} · evidence: {item.lastTurnEvidence ?? '不明'}</small>
            <small>current_execution（最終成功時）: {item.currentExecutionState ?? '不明'}
              · turn_id: {item.currentExecutionTurnId ?? '不明'} · evidence: {item.currentExecutionEvidence ?? '不明'}</small>
            <small>needs_attention（最終成功時）: {item.needsAttention === true ? '要対応' : item.needsAttention === false ? '不要' : '不明'}
              {!sameConnection && ' · 現在の状態は不明（接続先が異なります）'}
            </small>
          </li>;
        })}
      </ul>}
      <div className="codex-bridge-event-heading">
        <h3>終了イベント</h3><span>{events.length} 件</span>
        <button type="button" className="codex-bridge-button" onClick={() => { void acknowledgeVisibleEvents(); }}
          disabled={busyKey !== '' || !events.some((event) => !event.acknowledgedAt)}>
          {busyKey === 'acknowledge' ? '確認中…' : '未確認の終了通知を確認'}
        </button>
      </div>
      {events.length === 0 && <p className="codex-bridge-empty">通知イベントはありません。</p>}
      {events.length > 0 && <ul className="codex-bridge-event-list" aria-label="監視終了イベント一覧">
        {events.map((event) => <li key={event.eventId} className="codex-bridge-event-item">
          <button type="button" className="codex-bridge-event-select" aria-pressed={event.eventId === selectedEventId}
            onClick={() => selectEvent(event.eventId)}>
            <strong>{eventKindLabel(event.status)} · {event.targetId} / {event.threadId}</strong>
            <small>turn: {event.turnId} · 検出: {dateLabel(event.detectedAt)}</small>
            <small>{event.acknowledgedAt ? 'ユーザー確認済み' : '未確認の終了通知'}</small>
            <small>{eventStatusLabel(event)}</small>
            {event.notificationReason && <small>通知理由: {event.notificationReason}</small>}
            {event.connectionId !== currentConnectionId && <small>イベント発生時と現在の接続先が異なります。</small>}
          </button>
        </li>)}
      </ul>}
      {selectedEvent && <div className="codex-bridge-final-answer">
        <strong>選択イベント: {eventKindLabel(selectedEvent.status)} · {selectedEvent.turnId}</strong>
        <button type="button" className="codex-bridge-button" onClick={() => { void fetchSelectedAnswer(); }}
          disabled={answerBusy || selectedEvent.connectionId !== currentConnectionId}>
          {answerBusy ? '最終回答を取得中…' : '最終回答を取得'}
        </button>
        {selectedEvent.connectionId !== currentConnectionId && <p className="codex-bridge-note">イベント発生時のBridge接続先と現在の接続先が一致しません。</p>}
        {displayedAnswer && <>
          <p className="codex-bridge-note" role="status">{finalAnswerLabel(displayedAnswer)}</p>
          {displayedAnswer.status === 'retrieved' && <>
            <p className="codex-bridge-note">Bridge応答には切詰め情報がないため、取得本文の完全性は確認できません。</p>
            <div className="codex-bridge-answer-actions">
              <button type="button" className="codex-bridge-button" onMouseDown={(mouseEvent) => mouseEvent.preventDefault()} onClick={() => { void copyAnswer(selectedEvent, displayedAnswer.text); }}>コピー</button>
              <button type="button" className="codex-bridge-button" onMouseDown={(event) => event.preventDefault()} onClick={() => insertAnswer(selectedEvent, displayedAnswer.text)}>ChatGPT入力欄へ挿入</button>
            </div>
            <pre className="codex-bridge-answer-text">{displayedAnswer.text}</pre>
          </>}
        </>}
        {answerMessage && <p className="codex-bridge-note" role="status">{answerMessage}</p>}
      </div>}
    </section>
  );
}
