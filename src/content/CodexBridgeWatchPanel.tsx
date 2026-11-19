import { useEffect, useRef, useState } from 'react';
import {
  CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY,
  CODEX_BRIDGE_THREAD_MONITOR_FOREGROUND_MS,
  CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH,
  CODEX_BRIDGE_WATCH_LIST,
  CODEX_BRIDGE_WATCH_START,
  CODEX_BRIDGE_WATCH_STOP,
  deriveCodexBridgeWatchTurnState,
  type CodexBridgeWatchFetchOutcome,
  type CodexBridgeWatchSnapshot,
} from '../shared/codexbridge-thread-monitor-protocol.ts';

type SelectedThread = Readonly<{ targetId: string; threadId: string }>;
type Props = Readonly<{ selected: SelectedThread | null; foregroundEnabled: boolean }>;
type ListData = Readonly<{ items: readonly CodexBridgeWatchSnapshot[]; currentConnectionId: string | null }>;

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
    || !(typeof value.data.currentConnectionId === 'string' || value.data.currentConnectionId === null)) return null;
  return {
    items: value.data.items.filter(isWatchSnapshot),
    currentConnectionId: value.data.currentConnectionId,
  };
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

export function CodexBridgeWatchPanel({ selected, foregroundEnabled }: Props) {
  const [items, setItems] = useState<readonly CodexBridgeWatchSnapshot[]>([]);
  const [currentConnectionId, setCurrentConnectionId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const listGeneration = useRef(0);

  async function refreshList() {
    const generation = ++listGeneration.current;
    try {
      const response: unknown = await chrome.runtime.sendMessage({ type: CODEX_BRIDGE_WATCH_LIST });
      if (generation !== listGeneration.current) return;
      const data = readWatchList(response);
      if (!data) return;
      setItems(data.items);
      setCurrentConnectionId(data.currentConnectionId);
    } catch {
      if (generation === listGeneration.current) setError('監視一覧を読み取れません。');
    }
  }

  function acceptStoredItems(value: unknown) {
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.items)) return;
    listGeneration.current += 1;
    setItems(value.items.filter(isWatchSnapshot));
  }

  useEffect(() => {
    void refreshList();
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') return;
      const monitorChange = changes[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY];
      if (monitorChange) acceptStoredItems(monitorChange.newValue);
      void refreshList();
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  useEffect(() => {
    if (!foregroundEnabled) return;
    const isForeground = () => document.visibilityState === 'visible' && document.hasFocus();
    const refreshForeground = () => {
      if (!isForeground()) return;
      void chrome.runtime.sendMessage({ type: CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH })
        .then((response: unknown) => {
          const data = readWatchList(response);
          if (data) {
            setItems(data.items);
            setCurrentConnectionId(data.currentConnectionId);
          }
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
    if (!selected) return;
    const key = `start:${selected.targetId}:${selected.threadId}`;
    setBusyKey(key);
    setError('');
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CODEX_BRIDGE_WATCH_START,
        targetId: selected.targetId,
        threadId: selected.threadId,
      });
      if (!isRecord(response) || response.ok !== true) {
        setError(response && isRecord(response) && response.reason === 'watch-limit'
          ? '監視件数の上限に達しています。不要な監視を解除してください。'
          : '監視を開始できません。接続先・権限を確認してください。');
      }
      await refreshList();
    } catch {
      setError('監視を開始できません。');
    } finally {
      setBusyKey('');
    }
  }

  async function stopWatch(item: CodexBridgeWatchSnapshot) {
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
      await refreshList();
    } catch {
      setError('監視を解除できません。');
    } finally {
      setBusyKey('');
    }
  }

  const selectedWatch = selected && items.find((item) => item.connectionId === currentConnectionId
    && item.targetId === selected.targetId && item.threadId === selected.threadId);

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
        : <button type="button" className="codex-bridge-button" onClick={() => { void startWatch(); }} disabled={busyKey !== '' || !currentConnectionId}>
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
    </section>
  );
}
