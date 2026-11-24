import { BridgeSummaryCounter } from './BridgeSummaryCounter.tsx';
import type { CodexBridgeThread } from '../shared/codexbridge-mcp-protocol.ts';
import type { CodexBridgeWatchSnapshot } from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeWatchSummary } from './codexbridge-watch-summary.ts';
import { formatRunningThreadCount, type RunningThreadSummary } from './codexbridge-running-summary.ts';
import { classifyCodexBridgeThreadActivity } from './codexbridge-thread-order.ts';
import { eventKindLabel, watchDateLabel, watchTurnStateLabel } from './codexbridge-watch-presentation.ts';

type Props = Readonly<{
  compact?: boolean;
  conversationId: string | null;
  watchSummary: CodexBridgeWatchSummary | null;
  connection: Readonly<{ state: 'loading' | 'connected' | 'error'; targetId: string | null; targetName: string | null }>;
  runningSummary: RunningThreadSummary;
  onAcknowledgeEvents?: () => void;
  expanded?: boolean;
  onToggle?: () => void;
}>;

function threadName(threads: readonly Pick<CodexBridgeThread, 'id' | 'targetId' | 'title' | 'preview'>[] | null,
  targetId: string, threadId: string): string {
  const thread = threads?.find((candidate) => candidate.targetId === targetId && candidate.id === threadId);
  return thread?.title?.trim() || thread?.preview?.trim() || '不明';
}

function runningDetail(runningSummary: RunningThreadSummary, targetId: string | null,
  connectionState: Props['connection']['state']) {
  const count = formatRunningThreadCount(runningSummary, targetId, connectionState);
  const threads = connectionState === 'connected' && targetId === runningSummary.targetId
    && ['ready', 'stale', 'unknown'].includes(runningSummary.status) ? runningSummary.threads : null;
  const empty = threads?.length === 0;
  return <>
    {!threads && <p role="status">{count.title}</p>}
    {threads && runningSummary.status === 'stale' && <p role="status">一覧の最終確認: {runningSummary.observedAt ?? '時刻不明'}。表示件数は最新状態ではありません。</p>}
    {threads && runningSummary.status === 'unknown' && <p role="status">一覧の鮮度を確認できていません。件数は未確定です。</p>}
    {empty && <p role="status">実行中threadはありません。</p>}
    {threads && threads.length > 0 && <ul className="phase6-counter-list" aria-label="running_only thread一覧">
      {threads.map((thread) => {
        const activity = classifyCodexBridgeThreadActivity(thread);
        const status = activity === 'running' ? '実行中（確定）' : activity === 'estimated' ? '実行中（推定）'
          : thread.currentExecution?.state || '状態不明';
        return <li key={`${thread.targetId}:${thread.id}`}><strong>{thread.title?.trim() || thread.preview?.trim() || '不明'}</strong>
          <small>{status}</small></li>;
      })}
    </ul>}
  </>;
}

function watchDetail(summary: CodexBridgeWatchSummary | null, threads: RunningThreadSummary['threads']) {
  if (!summary || summary.status === 'loading') return <p role="status">監視一覧を取得中です。</p>;
  if (summary.status === 'error') return <p role="alert">{summary.error || '監視一覧を取得できませんでした。'}</p>;
  if (!summary.items.length) return <p role="status">監視対象はありません。</p>;
  return <ul className="phase6-counter-list" aria-label="現在の会話の監視対象一覧">
    {summary.items.map((item) => <WatchDetailItem key={`${item.connectionId}:${item.targetId}:${item.threadId}`}
      item={item} summary={summary} threads={threads} />)}
  </ul>;
}

function WatchDetailItem({ item, summary, threads }: Readonly<{
  item: CodexBridgeWatchSnapshot;
  summary: CodexBridgeWatchSummary;
  threads: RunningThreadSummary['threads'];
}>) {
  const title = threadName(threads, item.targetId, item.threadId);
  return <li><strong>{title}</strong><small>{watchTurnStateLabel(item, item.connectionId === summary.currentConnectionId)}</small></li>;
}

function notificationDetail(summary: CodexBridgeWatchSummary | null,
  threads: RunningThreadSummary['threads']) {
  if (!summary || summary.status === 'loading') return <p role="status">未確認通知を取得中です。</p>;
  if (summary.status === 'error') return <p role="alert">{summary.error || '未確認通知を取得できませんでした。'}</p>;
  if (!summary.unacknowledgedGroups.length) return <p role="status">未確認通知はありません。</p>;
  return <ul className="phase6-counter-list" aria-label="現在の会話の未確認終了通知">
    {summary.unacknowledgedGroups.map((group) => <li key={`${group.connectionId}:${group.targetId}:${group.threadId}`}>
      <strong>{threadName(threads, group.targetId, group.threadId)}</strong>
      <ul className="phase6-counter-events">
        {group.events.map((event, index) => <li key={event.eventId}>
          通知 {index + 1}: {eventKindLabel(event.status)} · 終了 {watchDateLabel(event.detectedAt)}
        </li>)}
      </ul>
    </li>)}
  </ul>;
}

export function BridgeSummaryBar({ compact = false, conversationId, watchSummary, connection, runningSummary,
  onAcknowledgeEvents, expanded = false, onToggle }: Props) {
  const runningCount = formatRunningThreadCount(runningSummary, connection.targetId, connection.state);
  const targetName = connection.targetName?.trim();
  const connectionLabel = connection.state === 'loading' ? '接続状況を確認中'
    : connection.state === 'error' ? '接続できません'
      : targetName ? `接続中（${targetName}）` : '接続中（対象なし）';
  const currentSummary = conversationId && watchSummary?.conversationId === conversationId ? watchSummary : null;
  const watchingCount = currentSummary?.status === 'ready' ? currentSummary.watchingCount ?? '—' : '—';
  const notificationCount = currentSummary?.status === 'ready' ? currentSummary.unacknowledgedThreadCount ?? '—' : '—';
  const notificationDisabled = !currentSummary || currentSummary.status !== 'ready'
    || currentSummary.unacknowledgedThreadCount === null || currentSummary.unacknowledgedThreadCount === 0
    || currentSummary.operationBusy || !onAcknowledgeEvents;
  const notificationDescription = 'クリックすると、現在の会話の未確認終了イベントを確認済みにします。通知履歴・監視登録・最終回答は保持されます。';
  const runningKey = `${connection.targetId ?? 'none'}:${runningSummary.targetId ?? 'none'}`;
  const watchKey = conversationId ?? 'no-conversation';

  return (
    <section className={`phase6-bridge-bar${compact ? ' is-compact' : ''}`} aria-label="CodexBridge">
      <div className={`phase6-bridge-status is-${connection.state}`}>
        <span className="phase6-bridge-status-dot" aria-hidden="true" />
        <strong>CodexBridge</strong>
        <span className="phase6-bridge-connection">{connectionLabel}</span>
      </div>
      <div className="phase6-bridge-counters" role="group" aria-label="CodexBridge件数">
        <BridgeSummaryCounter key={runningKey} label="実行中" value={runningCount.value} description={runningCount.title}>
          {runningDetail(runningSummary, connection.targetId, connection.state)}
        </BridgeSummaryCounter>
        <BridgeSummaryCounter key={`watch:${watchKey}`} label="監視中" value={watchingCount}
          description="現在の会話から登録した監視対象と最新状態です。">
          {watchDetail(currentSummary, runningSummary.threads)}
        </BridgeSummaryCounter>
        <BridgeSummaryCounter key={`notification:${watchKey}`} label="通知" value={notificationCount} description={notificationDescription}
          onActivate={onAcknowledgeEvents} disabled={notificationDisabled}>
          {notificationDetail(currentSummary, runningSummary.threads)}
        </BridgeSummaryCounter>
      </div>
      {!compact && onToggle && (
        <button type="button" className="phase6-details-toggle" aria-expanded={expanded}
          aria-controls="panel-bridge-details" onClick={onToggle}>
          {expanded ? '詳細を閉じる' : '詳細を表示'} <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
        </button>
      )}
      {!compact && <p className="phase6-bridge-note" role="note">
        {!conversationId ? '会話ID確認後に監視・通知件数を表示します。'
          : currentSummary?.status === 'ready' ? '監視中・通知は現在の会話の件数です。実行中は選択対象のBridge結果です。'
            : currentSummary?.status === 'error' ? '会話別の監視・通知件数を取得できません。'
              : '会話別の監視・通知件数を確認しています。'}
      </p>}
      {currentSummary?.error && <p className="phase6-bridge-ack-error" role="alert">{currentSummary.error}</p>}
    </section>
  );
}
