import { CODEX_BRIDGE_WATCH_ACK_EVENT_IDS_LIMIT } from '../shared/codexbridge-thread-monitor-protocol.ts';

export type CodexBridgeEventAckResult = Readonly<{
  status: 'complete' | 'partial' | 'failed' | 'cancelled';
  totalCount: number;
  confirmedCount: number;
}>;

export async function acknowledgeCodexBridgeEventIds(
  eventIds: readonly string[],
  sendBatch: (eventIds: readonly string[]) => Promise<boolean>,
  isCurrent: () => boolean,
): Promise<CodexBridgeEventAckResult> {
  const snapshot = [...new Set(eventIds)];
  let confirmedCount = 0;
  for (let offset = 0; offset < snapshot.length; offset += CODEX_BRIDGE_WATCH_ACK_EVENT_IDS_LIMIT) {
    if (!isCurrent()) return {
      status: confirmedCount ? 'partial' : 'cancelled', totalCount: snapshot.length, confirmedCount,
    };
    const batch = Object.freeze(snapshot.slice(offset, offset + CODEX_BRIDGE_WATCH_ACK_EVENT_IDS_LIMIT));
    let confirmed: boolean;
    try { confirmed = await sendBatch(batch); } catch { confirmed = false; }
    if (!confirmed) return {
      status: confirmedCount ? 'partial' : 'failed', totalCount: snapshot.length, confirmedCount,
    };
    confirmedCount += batch.length;
  }
  return { status: 'complete', totalCount: snapshot.length, confirmedCount };
}
