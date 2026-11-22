import { CODEX_BRIDGE_WATCH_ACK_EVENT_IDS_LIMIT } from '../shared/codexbridge-thread-monitor-protocol.ts';

export type CodexBridgeEventClearResult = Readonly<{
  status: 'complete' | 'partial' | 'failed' | 'cancelled';
  totalCount: number;
  clearedCount: number;
}>;

export async function clearCodexBridgeEventIds(
  eventIds: readonly string[],
  sendBatch: (eventIds: readonly string[]) => Promise<boolean>,
  isCurrent: () => boolean,
): Promise<CodexBridgeEventClearResult> {
  const snapshot = [...new Set(eventIds)];
  let clearedCount = 0;
  for (let offset = 0; offset < snapshot.length; offset += CODEX_BRIDGE_WATCH_ACK_EVENT_IDS_LIMIT) {
    if (!isCurrent()) return {
      status: clearedCount ? 'partial' : 'cancelled', totalCount: snapshot.length, clearedCount,
    };
    const batch = Object.freeze(snapshot.slice(offset, offset + CODEX_BRIDGE_WATCH_ACK_EVENT_IDS_LIMIT));
    let cleared: boolean;
    try { cleared = await sendBatch(batch); } catch { cleared = false; }
    if (!cleared) return {
      status: clearedCount ? 'partial' : 'failed', totalCount: snapshot.length, clearedCount,
    };
    clearedCount += batch.length;
  }
  return { status: 'complete', totalCount: snapshot.length, clearedCount };
}
