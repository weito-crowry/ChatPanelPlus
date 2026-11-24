import type { CodexBridgeRunningSnapshot } from './codexbridge-read-service.ts';
import type { CodexBridgeMonitorAccess } from './thread-monitor.ts';
import type { CodexBridgeWatchSnapshot } from '../shared/codexbridge-thread-monitor-protocol.ts';

type Cadence = 'foreground' | 'background';
type Poll = (item: CodexBridgeWatchSnapshot, priority: 'urgent') => Promise<void>;

export async function refreshMissingCodexBridgeWatches(
  items: readonly CodexBridgeWatchSnapshot[],
  access: CodexBridgeMonitorAccess,
  cadence: Cadence,
  poll: Poll,
): Promise<void> {
  if (access.isCurrent && !access.isCurrent()) return;
  if (!access.readRunningSnapshot) return;
  const byTarget = new Map<string, CodexBridgeWatchSnapshot[]>();
  for (const item of items) {
    if (!item.enabled || item.connectionId !== access.connectionId) continue;
    const group = byTarget.get(item.targetId) ?? [];
    group.push(item);
    byTarget.set(item.targetId, group);
  }
  await Promise.all([...byTarget].map(async ([targetId, watches]) => {
    let snapshot: CodexBridgeRunningSnapshot;
    try {
      snapshot = await access.readRunningSnapshot!(targetId, {
        priority: cadence === 'foreground' ? 'foreground' : 'background',
        maxAgeMs: cadence === 'foreground' ? 5_000 : 30_000,
      });
    } catch { return; }
    if (!snapshot.ok || snapshot.freshness !== 'fresh' || snapshot.page.nextCursor !== null
      || (access.isCurrent && !access.isCurrent())) return;
    const present = new Set(snapshot.page.threads.filter((thread) => thread.targetId === targetId).map((thread) => thread.id));
    const missing = watches.filter((item) => !present.has(item.threadId));
    await Promise.all(missing.map((item) => poll(item, 'urgent')));
  }));
}
