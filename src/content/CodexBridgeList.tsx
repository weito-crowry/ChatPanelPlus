import { useEffect, useState } from 'react';
import {
  CODEX_BRIDGE_MCP_GET_STATUS,
  CODEX_BRIDGE_MCP_GET_TARGETS,
  CODEX_BRIDGE_MCP_GET_THREADS,
  type CodexBridgeObservation,
  type CodexBridgeReadFailureReason,
  type CodexBridgeReadResponse,
  type CodexBridgeTarget,
  type CodexBridgeThread,
  type CodexBridgeThreadPage,
  type CodexBridgeThreadStatus,
} from '../shared/codexbridge-mcp-protocol.ts';

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

function mergeThreads(current: readonly CodexBridgeThread[], incoming: readonly CodexBridgeThread[]): CodexBridgeThread[] {
  const merged = new Map(current.map((thread) => [`${thread.targetId}\u0000${thread.id}`, thread]));
  for (const thread of incoming) merged.set(`${thread.targetId}\u0000${thread.id}`, thread);
  return [...merged.values()];
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

  async function refreshTargets() {
    setConnection('loading');
    setConnectionMessage('対象マシンを確認しています。');
    try {
      const response: unknown = await chrome.runtime.sendMessage({ type: CODEX_BRIDGE_MCP_GET_TARGETS });
      if (!isReadResponse<readonly CodexBridgeTarget[]>(response) || !response.ok || !Array.isArray(response.data)) {
        setConnection('error');
        setConnectionMessage(isReadResponse(response) && !response.ok
          ? errorLabel(response.reason)
          : 'Bridgeから不正な応答が返りました。');
        return;
      }
      const availableTargets = response.data;
      const nextTargetId = availableTargets.some((target) => target.id === targetId)
        ? targetId
        : availableTargets[0]?.id ?? '';
      setTargets(availableTargets);
      setConnection('connected');
      setConnectionMessage('Bridgeへ接続しています。');
      if (nextTargetId !== targetId) {
        setTargetId(nextTargetId);
        setThreads([]);
        setNextCursor(null);
        setThreadsLoaded(false);
        setSelected(null);
        setSelectedMissing(false);
        setStatus(null);
      }
    } catch {
      setConnection('error');
      setConnectionMessage('Bridgeへ接続できません。');
    }
  }

  useEffect(() => {
    void refreshTargets();
  }, []);

  async function loadThreads(loadMore: boolean) {
    if (!targetId || threadsBusy || (loadMore && !nextCursor)) return;
    setThreadsBusy(true);
    setThreadsError('');
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CODEX_BRIDGE_MCP_GET_THREADS,
        targetId,
        ...(loadMore && nextCursor ? { cursor: nextCursor } : {}),
      });
      if (!isReadResponse<CodexBridgeThreadPage>(response) || !response.ok
        || !isRecord(response.data) || !Array.isArray(response.data.threads)
        || !(response.data.nextCursor === null || typeof response.data.nextCursor === 'string')) {
        setThreadsError(isReadResponse(response) && !response.ok
          ? errorLabel(response.reason)
          : 'Bridgeから不正な応答が返りました。');
        return;
      }
      const updated = loadMore ? mergeThreads(threads, response.data.threads) : [...response.data.threads];
      setThreads(updated);
      setNextCursor(response.data.nextCursor);
      setThreadsLoaded(true);
      if (selected) {
        const found = updated.find((thread) => thread.targetId === selected.targetId && thread.id === selected.id);
        if (found) {
          setSelected(found);
          setSelectedMissing(false);
        } else if (!loadMore) {
          setSelectedMissing(true);
        }
      }
    } catch {
      setThreadsError('Bridgeへ接続できません。');
    } finally {
      setThreadsBusy(false);
    }
  }

  async function checkSelectedStatus() {
    if (!selected || statusBusy) return;
    setStatusBusy(true);
    setStatusError('');
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: CODEX_BRIDGE_MCP_GET_STATUS,
        targetId: selected.targetId,
        threadId: selected.id,
      });
      if (!isReadResponse<CodexBridgeThreadStatus>(response) || !response.ok
        || !isRecord(response.data) || response.data.targetId !== selected.targetId
        || response.data.threadId !== selected.id) {
        setStatusError(isReadResponse(response) && !response.ok
          ? errorLabel(response.reason)
          : 'Bridgeから不正な応答が返りました。');
        return;
      }
      setStatus(response.data);
    } catch {
      setStatusError('Bridgeへ接続できません。');
    } finally {
      setStatusBusy(false);
    }
  }

  const selectedStatus = selected && status?.targetId === selected.targetId && status.threadId === selected.id ? status : null;

  return (
    <section className="codex-bridge" aria-label="CodexBridge一覧">
      <div className="codex-bridge-heading">
        <h2>CodexBridge</h2>
        <button type="button" className="codex-bridge-button" onClick={() => { void refreshTargets(); }} disabled={connection === 'loading'}>
          {connection === 'loading' ? '確認中…' : '接続更新'}
        </button>
      </div>
      <p className={`codex-bridge-connection is-${connection}`} role="status">接続状態: {connectionMessage}</p>
      {connection === 'error' && <p className="codex-bridge-error">{connectionMessage}</p>}
      {targets.length > 0 && (
        <label className="codex-bridge-target">
          対象マシン
          <select value={targetId} onChange={(event) => {
            const value = event.currentTarget.value;
            setTargetId(value);
            setThreads([]);
            setNextCursor(null);
            setThreadsLoaded(false);
            setThreadsError('');
            setSelected(null);
            setSelectedMissing(false);
            setStatus(null);
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
                      setSelected(thread);
                      setSelectedMissing(false);
                      setStatus(null);
                      setStatusError('');
                    }}>
                      <span>{thread.title ?? thread.id}</span>
                      <small>{thread.currentExecution ? observationLabel(thread.currentExecution) : '実行状態: 不明'}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {selected && (
            <div className="codex-bridge-selected">
              <strong>{selected.title ?? selected.id}</strong>
              <code>{selected.id}</code>
              {selectedMissing && <p className="codex-bridge-note">選択中のthreadは現在の一覧ページにありません。完了状態ではなく、状態は未確認です。</p>}
              <button type="button" className="codex-bridge-button" onClick={() => { void checkSelectedStatus(); }} disabled={statusBusy}>
                {statusBusy ? '確認中…' : '選択threadの状態を手動確認'}
              </button>
              {statusError && <p className="codex-bridge-error" role="alert">{statusError}</p>}
              <dl className="codex-bridge-status">
                <dt>応答状態</dt>
                <dd>{stateLabel(selectedStatus?.state)}</dd>
                <dt>current_execution</dt>
                <dd>{observationLabel(selectedStatus?.currentExecution ?? selected.currentExecution)}</dd>
                <dt>last_turn</dt>
                <dd>{observationLabel(selectedStatus?.lastTurn ?? selected.lastTurn)}</dd>
                <dt>needs_attention</dt>
                <dd>{attentionLabel(selectedStatus?.needsAttention ?? selected.needsAttention)}</dd>
              </dl>
            </div>
          )}
        </>
      )}
    </section>
  );
}
