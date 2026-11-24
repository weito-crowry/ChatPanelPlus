import {
  CODEX_BRIDGE_TERMINAL_EVENT_SAVED,
  isCodexBridgeWatchIdentifier,
  type CodexBridgeTerminalEvent,
  type CodexBridgeTerminalEventSavedMessage,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeOwnerIdentity, CodexBridgeOwnerLeaseResolution } from './thread-monitor-owner-lease.ts';
import type { CodexBridgeThreadMonitorStorage } from './thread-monitor-storage.ts';

type OwnerResolver = (identity: CodexBridgeOwnerIdentity) => Promise<CodexBridgeOwnerLeaseResolution>;
type EventSender = (tabId: number, message: CodexBridgeTerminalEventSavedMessage) => Promise<unknown>;

function isPending(event: CodexBridgeTerminalEvent): boolean {
  return event.ownerDeliveryState === 'pending' && !event.acknowledgedAt
    && isCodexBridgeWatchIdentifier(event.eventId) && Boolean(event.ownerConversationId)
    && Number.isFinite(Date.parse(event.detectedAt));
}

function identityForEvent(event: CodexBridgeTerminalEvent): CodexBridgeOwnerIdentity | null {
  return event.ownerConversationId
    ? { connectionId: event.connectionId, targetId: event.targetId, conversationId: event.ownerConversationId } : null;
}

function sameIdentity(left: CodexBridgeOwnerIdentity, right: CodexBridgeOwnerIdentity): boolean {
  return left.connectionId === right.connectionId && left.targetId === right.targetId
    && left.conversationId === right.conversationId;
}

function savedMessage(event: CodexBridgeTerminalEvent): CodexBridgeTerminalEventSavedMessage {
  return {
    type: CODEX_BRIDGE_TERMINAL_EVENT_SAVED,
    eventId: event.eventId,
    ownerConversationId: event.ownerConversationId!,
    detectedAt: event.detectedAt,
  };
}

export class CodexBridgeTerminalEventDelivery {
  private readonly storage: CodexBridgeThreadMonitorStorage;
  private readonly resolveOwner: OwnerResolver;
  private readonly send: EventSender;

  constructor(storage: CodexBridgeThreadMonitorStorage, resolveOwner: OwnerResolver, send: EventSender) {
    this.storage = storage;
    this.resolveOwner = resolveOwner;
    this.send = send;
  }

  async dispatch(eventId: string): Promise<boolean> {
    const event = (await this.storage.listEvents()).find((candidate) => candidate.eventId === eventId);
    if (!event || !isPending(event)) return false;
    const identity = identityForEvent(event);
    if (!identity) return false;
    const owner = await this.resolveOwner(identity);
    if (owner.kind !== 'owner') return false;
    return this.dispatchPending(event, identity, owner.tabId);
  }

  async resume(identity: CodexBridgeOwnerIdentity, verifiedOwnerTabId: number): Promise<void> {
    if (!Number.isSafeInteger(verifiedOwnerTabId) || verifiedOwnerTabId < 0) return;
    const events = (await this.storage.listEvents()).filter((event) => isPending(event)
      && identityForEvent(event) !== null && sameIdentity(identityForEvent(event)!, identity))
      .sort((left, right) => left.detectedAt.localeCompare(right.detectedAt));
    if (!events.length) return;
    for (const event of events) await this.dispatchPending(event, identity, verifiedOwnerTabId);
  }

  async resumeAll(): Promise<void> {
    const events = (await this.storage.listEvents()).filter(isPending)
      .sort((left, right) => left.detectedAt.localeCompare(right.detectedAt));
    const groups = new Map<string, { identity: CodexBridgeOwnerIdentity; events: CodexBridgeTerminalEvent[] }>();
    for (const event of events) {
      const identity = identityForEvent(event);
      if (!identity) continue;
      const key = `${identity.connectionId}\u0000${identity.targetId}\u0000${identity.conversationId}`;
      const group = groups.get(key) ?? { identity, events: [] };
      group.events.push(event);
      groups.set(key, group);
    }
    for (const { identity, events: pending } of groups.values()) {
      const owner = await this.resolveOwner(identity);
      if (owner.kind !== 'owner') continue;
      for (const event of pending) await this.dispatchPending(event, identity, owner.tabId);
    }
  }

  private async dispatchPending(event: CodexBridgeTerminalEvent, identity: CodexBridgeOwnerIdentity, tabId: number): Promise<boolean> {
    let claimed: boolean;
    try {
      claimed = await this.storage.mutate((items, events) => {
        const index = events.findIndex((candidate) => candidate.eventId === event.eventId);
        const current = index < 0 ? null : events[index]!;
        if (!current || !isPending(current) || !identityForEvent(current)
          || !sameIdentity(identityForEvent(current)!, identity)) return { items, events, result: false };
        const next = [...events];
        next[index] = { ...current, ownerDeliveryState: 'requested', ownerTabId: tabId };
        return { items, events: next, result: true };
      });
    } catch { return false; }
    if (!claimed) return false;

    try { await this.send(tabId, savedMessage(event)); }
    catch { return false; }

    try {
      await this.storage.mutate((items, events) => ({
        items,
        events: events.map((candidate) => candidate.eventId === event.eventId
          && candidate.ownerDeliveryState === 'requested' ? { ...candidate, ownerDeliveryState: 'delivered' } : candidate),
        result: undefined,
      }));
    } catch { /* The persisted requested state intentionally suppresses another insertion attempt. */ }
    return true;
  }
}
