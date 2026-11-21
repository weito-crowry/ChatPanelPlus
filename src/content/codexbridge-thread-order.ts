import type { CodexBridgeThread } from '../shared/codexbridge-mcp-protocol.ts';

export type CodexBridgeThreadActivity = 'running' | 'estimated' | 'inactive';
const ACTIVITY_RANK: Record<CodexBridgeThreadActivity, number> = { running: 0, estimated: 1, inactive: 2 };

export function classifyCodexBridgeThreadActivity(thread: CodexBridgeThread): CodexBridgeThreadActivity {
  const state = thread.currentExecution?.state;
  if (state === 'in_progress' || state === 'running') return 'running';
  return state === 'estimated_running' ? 'estimated' : 'inactive';
}

function updatedAtTimestamp(thread: CodexBridgeThread): number | null {
  if (!thread.updatedAt) return null;
  const timestamp = Date.parse(thread.updatedAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function sortCodexBridgeThreadsByActivity(threads: readonly CodexBridgeThread[]): CodexBridgeThread[] {
  return threads.map((thread, index) => ({ thread, index, timestamp: updatedAtTimestamp(thread) }))
    .sort((left, right) => {
      const activityOrder = ACTIVITY_RANK[classifyCodexBridgeThreadActivity(left.thread)]
        - ACTIVITY_RANK[classifyCodexBridgeThreadActivity(right.thread)];
      if (activityOrder) return activityOrder;
      if (left.timestamp !== right.timestamp) {
        if (left.timestamp === null) return 1;
        if (right.timestamp === null) return -1;
        return right.timestamp - left.timestamp;
      }
      return left.index - right.index;
    })
    .map(({ thread }) => thread);
}

export function filterCodexBridgeThreads(
  threads: readonly CodexBridgeThread[],
  runningOnly: boolean,
): CodexBridgeThread[] {
  const ordered = sortCodexBridgeThreadsByActivity(threads);
  return runningOnly
    ? ordered.filter((thread) => classifyCodexBridgeThreadActivity(thread) !== 'inactive')
    : ordered;
}
