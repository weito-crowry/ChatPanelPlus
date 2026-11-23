import type { CodexBridgeTerminalEvent } from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeThreadListMode } from './codexbridge-request-tracker.ts';

export type CodexBridgeTerminalEventSignal = Pick<CodexBridgeTerminalEvent, 'connectionId' | 'eventId' | 'targetId'>;
export type CodexBridgeTerminalRefreshAction = 'threads' | 'summary';
export type CodexBridgeTerminalRefreshSnapshot = Readonly<{
  targetId: string | null;
  mode: CodexBridgeThreadListMode;
  connected: boolean;
  routeCurrent: boolean;
  threadsBusy: boolean;
}>;

export class CodexBridgeTerminalRefreshCoordinator {
  private readonly handledEvents = new Set<string>();
  private pendingRunningTargetId: string | null = null;

  observe(
    events: readonly CodexBridgeTerminalEventSignal[],
    snapshot: CodexBridgeTerminalRefreshSnapshot,
  ): CodexBridgeTerminalRefreshAction | null {
    const { targetId } = snapshot;
    if (!targetId || !snapshot.connected || !snapshot.routeCurrent) return null;

    let hasNewEvent = false;
    for (const event of events) {
      if (event.targetId !== targetId) continue;
      const identity = `${event.connectionId}\u0000${event.targetId}\u0000${event.eventId}`;
      if (this.handledEvents.has(identity)) continue;
      this.handledEvents.add(identity);
      hasNewEvent = true;
    }
    if (!hasNewEvent) return null;
    if (snapshot.mode === 'normal') return 'summary';
    if (snapshot.threadsBusy) {
      this.pendingRunningTargetId = targetId;
      return null;
    }
    return 'threads';
  }

  finishRunningRequest(requestedTargetId: string, snapshot: CodexBridgeTerminalRefreshSnapshot): boolean {
    const pendingTargetId = this.pendingRunningTargetId;
    this.pendingRunningTargetId = null;
    return pendingTargetId === requestedTargetId && pendingTargetId === snapshot.targetId
      && snapshot.mode === 'running' && snapshot.connected && snapshot.routeCurrent;
  }

  clearPending(): void {
    this.pendingRunningTargetId = null;
  }
}
