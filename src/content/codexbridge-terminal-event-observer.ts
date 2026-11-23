import type { CodexBridgeTerminalEvent } from '../shared/codexbridge-thread-monitor-protocol.ts';

export class CodexBridgeTerminalEventObserver {
  private ownerConversationId: string | null = null;
  private connectionId: string | null = null;
  private observedIds = new Set<string>();

  observeSuccessfulSnapshot(
    ownerConversationId: string,
    currentConnectionId: string | null,
    events: readonly CodexBridgeTerminalEvent[],
  ): readonly CodexBridgeTerminalEvent[] {
    const currentEvents = currentConnectionId ? events.filter((event) => event.connectionId === currentConnectionId) : [];
    if (this.ownerConversationId !== ownerConversationId || this.connectionId !== currentConnectionId) {
      this.ownerConversationId = ownerConversationId;
      this.connectionId = currentConnectionId;
      this.observedIds = new Set(currentEvents.map((event) => `${event.targetId}\u0000${event.eventId}`));
      return [];
    }

    const newlyObserved: CodexBridgeTerminalEvent[] = [];
    for (const event of currentEvents) {
      const identity = `${event.targetId}\u0000${event.eventId}`;
      if (this.observedIds.has(identity)) continue;
      this.observedIds.add(identity);
      newlyObserved.push(event);
    }
    return newlyObserved;
  }
}
