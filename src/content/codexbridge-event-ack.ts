import { CODEX_BRIDGE_WATCH_ACK_EVENT_IDS_LIMIT } from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeTerminalEvent } from '../shared/codexbridge-thread-monitor-protocol.ts';

export type CodexBridgeEventAckResult = Readonly<{
  status: 'complete' | 'partial' | 'failed' | 'cancelled';
  totalCount: number;
  confirmedCount: number;
}>;

export type CodexBridgeEventAckAttempt = CodexBridgeEventAckResult | Readonly<{
  status: 'busy' | 'empty';
  totalCount: 0;
  confirmedCount: 0;
}>;

export type CodexBridgeEventAckOwner = Readonly<{ conversationId: string | null; generation: number }>;

export class CodexBridgeEventAcknowledger {
  private inFlight = false;

  get isBusy(): boolean { return this.inFlight; }

  async acknowledge(input: Readonly<{
    events: readonly Pick<CodexBridgeTerminalEvent, 'eventId' | 'ownerConversationId' | 'acknowledgedAt'>[];
    ownerConversationId: string;
    ownerGeneration: number;
    getCurrentOwner: () => CodexBridgeEventAckOwner;
    sendBatch: (eventIds: readonly string[]) => Promise<boolean>;
  }>): Promise<CodexBridgeEventAckAttempt> {
    if (this.inFlight) return { status: 'busy', totalCount: 0, confirmedCount: 0 };
    const snapshot = [...new Set(input.events.filter((event) => event.ownerConversationId === input.ownerConversationId
      && !event.acknowledgedAt).map((event) => event.eventId))];
    if (snapshot.length === 0) return { status: 'empty', totalCount: 0, confirmedCount: 0 };
    this.inFlight = true;
    try {
      return await acknowledgeCodexBridgeEventIds(snapshot, input.sendBatch, () => {
        const owner = input.getCurrentOwner();
        return owner.conversationId === input.ownerConversationId && owner.generation === input.ownerGeneration;
      });
    } finally {
      this.inFlight = false;
    }
  }
}

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
