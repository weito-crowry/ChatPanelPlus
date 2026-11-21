import { formatRunningThreadCount, type RunningThreadSummary } from './codexbridge-running-summary.ts';

type BridgeSummary = Readonly<{
  watchingCount: number;
  unacknowledgedThreadCount: number;
}>;

type Props = Readonly<{
  compact?: boolean;
  conversationId: string | null;
  summary: BridgeSummary | null;
  connection: Readonly<{ state: 'loading' | 'connected' | 'error'; targetId: string | null; targetName: string | null }>;
  runningSummary: RunningThreadSummary;
  expanded?: boolean;
  onToggle?: () => void;
}>;

export function BridgeSummaryBar({ compact = false, conversationId, summary, connection, runningSummary, expanded = false, onToggle }: Props) {
  const runningCount = formatRunningThreadCount(runningSummary, connection.targetId, connection.state);
  const targetName = connection.targetName?.trim();
  const connectionLabel = connection.state === 'loading' ? '接続状況を確認中'
    : connection.state === 'error' ? '接続できません'
      : targetName ? `接続中（${targetName}）` : '接続中（対象なし）';
  const currentSummary = conversationId ? summary : null;

  return (
    <section className={`phase6-bridge-bar${compact ? ' is-compact' : ''}`} aria-label="CodexBridge">
      <div className={`phase6-bridge-status is-${connection.state}`}>
        <span className="phase6-bridge-status-dot" aria-hidden="true" />
        <strong>CodexBridge</strong>
        <span className="phase6-bridge-connection">{connectionLabel}</span>
      </div>
      <dl className="phase6-bridge-counters" aria-label="CodexBridge件数">
        <div title={runningCount.title}>
          <dt>実行中</dt>
          <dd aria-label="Bridge実行中件数">{runningCount.value}</dd>
        </div>
        <div title="現在の会話から登録した監視対象です。">
          <dt>監視中</dt>
          <dd aria-label="この会話の監視件数">{currentSummary?.watchingCount ?? '—'}</dd>
        </div>
        <div title="未確認終了イベントを持つ、この会話の監視対象数です。">
          <dt>通知</dt>
          <dd aria-label="この会話の未確認終了件数">{currentSummary?.unacknowledgedThreadCount ?? '—'}</dd>
        </div>
      </dl>
      {!compact && onToggle && (
        <button type="button" className="phase6-details-toggle" aria-expanded={expanded}
          aria-controls="panel-bridge-details" onClick={onToggle}>
          {expanded ? '詳細を閉じる' : '詳細を表示'} <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
        </button>
      )}
      {!compact && <p className="phase6-bridge-note" role="note">
        {!conversationId ? '会話ID確認後に監視・通知件数を表示します。'
          : currentSummary ? '監視中・通知は現在の会話の件数です。実行中は選択対象のBridge結果です。'
            : '会話別の監視・通知件数を確認しています。'}
      </p>}
    </section>
  );
}
