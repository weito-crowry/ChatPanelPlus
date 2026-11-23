import type { CodexBridgeTerminalEvent } from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeThreadListMode } from './codexbridge-request-tracker.ts';
import type { CodexBridgeWatchAdditionSignal } from './codexbridge-watch-addition-observer.ts';

export type CodexBridgeTerminalEventSignal = Pick<CodexBridgeTerminalEvent, 'connectionId' | 'eventId' | 'targetId'>;
export type CodexBridgeTerminalRefreshAction = 'threads' | 'summary';
export type CodexBridgeTerminalRefreshSnapshot = Readonly<{
  ownerConversationId: string | null;
  connectionId: string | null;
  targetId: string | null;
  mode: CodexBridgeThreadListMode;
  connected: boolean;
  routeCurrent: boolean;
  threadsBusy: boolean;
}>;

export class CodexBridgeTerminalRefreshCoordinator {
  private readonly handledEvents = new Set<string>();
  private readonly handledWatches = new Set<string>();
  private pendingRunningContext: Readonly<{ ownerConversationId: string; connectionId: string; targetId: string }> | null = null;

  observe(
    events: readonly CodexBridgeTerminalEventSignal[],
    snapshot: CodexBridgeTerminalRefreshSnapshot,
  ): CodexBridgeTerminalRefreshAction | null {
    const { targetId, connectionId, ownerConversationId } = snapshot;
    if (!targetId || !connectionId || !ownerConversationId || !snapshot.connected || !snapshot.routeCurrent) return null;

    let hasNewEvent = false;
    for (const event of events) {
      if (event.targetId !== targetId || event.connectionId !== connectionId) continue;
      const identity = `${event.connectionId}\u0000${event.targetId}\u0000${event.eventId}`;
      if (this.handledEvents.has(identity)) continue;
      this.handledEvents.add(identity);
      hasNewEvent = true;
    }
    return hasNewEvent ? this.actionForCurrentSnapshot(snapshot) : null;
  }

  observeWatchAdditions(
    watches: readonly CodexBridgeWatchAdditionSignal[],
    snapshot: CodexBridgeTerminalRefreshSnapshot,
  ): CodexBridgeTerminalRefreshAction | null {
    const { targetId, connectionId, ownerConversationId } = snapshot;
    if (!targetId || !connectionId || !ownerConversationId || !snapshot.connected || !snapshot.routeCurrent) return null;

    let hasNewWatch = false;
    for (const watch of watches) {
      if (watch.ownerConversationId !== ownerConversationId || watch.connectionId !== connectionId || watch.targetId !== targetId) continue;
      const identity = `${watch.connectionId}\u0000${watch.targetId}\u0000${watch.threadId}\u0000${watch.watchId}`;
      if (this.handledWatches.has(identity)) continue;
      this.handledWatches.add(identity);
      hasNewWatch = true;
    }
    return hasNewWatch ? this.actionForCurrentSnapshot(snapshot) : null;
  }

  finishRunningRequest(requestedTargetId: string, snapshot: CodexBridgeTerminalRefreshSnapshot): boolean {
    const pending = this.pendingRunningContext;
    this.pendingRunningContext = null;
    return pending !== null && pending.targetId === requestedTargetId && pending.targetId === snapshot.targetId
      && pending.connectionId === snapshot.connectionId && pending.ownerConversationId === snapshot.ownerConversationId
      && snapshot.mode === 'running' && snapshot.connected && snapshot.routeCurrent;
  }

  clearPending(): void {
    this.pendingRunningContext = null;
  }

  private actionForCurrentSnapshot(snapshot: CodexBridgeTerminalRefreshSnapshot): CodexBridgeTerminalRefreshAction | null {
    if (snapshot.mode === 'normal') return 'summary';
    if (snapshot.threadsBusy) {
      this.pendingRunningContext = {
        ownerConversationId: snapshot.ownerConversationId!,
        connectionId: snapshot.connectionId!,
        targetId: snapshot.targetId!,
      };
      return null;
    }
    return 'threads';
  }
}
