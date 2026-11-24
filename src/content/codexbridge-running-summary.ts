import type { CodexBridgeThread } from '../shared/codexbridge-mcp-protocol.ts';

export type RunningThreadSummaryStatus = 'loading' | 'ready' | 'stale' | 'unknown' | 'unsupported' | 'error';
export type RunningThreadSummary = Readonly<{
  targetId: string | null;
  threads: readonly CodexBridgeThread[] | null;
  status: RunningThreadSummaryStatus;
  observedAt?: string | null;
}>;
export type BridgeConnectionState = 'loading' | 'connected' | 'error';
export type RunningThreadCountView = Readonly<{ value: number | '—'; title: string }>;

export function staleRunningThreadSummary(targetId: string, previous: RunningThreadSummary,
  observedAt: string | null): RunningThreadSummary {
  return { targetId, threads: previous.targetId === targetId ? previous.threads : null,
    status: previous.targetId === targetId && previous.threads ? 'stale' : 'error', observedAt };
}

const RUNNING_COUNT_TITLE = '選択中の対象に対するBridgeの実行中一覧です（確定・推定を含む）。';

export function formatRunningThreadCount(
  summary: RunningThreadSummary,
  targetId: string | null,
  connectionState: BridgeConnectionState,
): RunningThreadCountView {
  if (connectionState !== 'connected') return { value: '—', title: 'Bridge接続を確認できていません。' };
  if (!targetId) return { value: '—', title: '対象マシンが選択されていません。' };
  if (summary.targetId !== targetId) return { value: '—', title: '対象マシン切替後の実行中一覧を取得中です。' };
  if (summary.status === 'ready' && summary.threads) {
    return { value: summary.threads.length, title: RUNNING_COUNT_TITLE };
  }
  if (summary.status === 'stale') return { value: '—', title: '実行中一覧は古いデータです。最新状態を確認できていません。' };
  if (summary.status === 'unknown') return { value: '—', title: '実行中threadの状態は未確認です。' };
  if (summary.status === 'unsupported') return { value: '—', title: 'Bridge更新待ちです。running_onlyに未対応です。' };
  if (summary.status === 'error') return { value: '—', title: 'Bridgeの実行中一覧を取得できませんでした。' };
  return { value: '—', title: 'Bridgeの実行中一覧を取得中です。' };
}
