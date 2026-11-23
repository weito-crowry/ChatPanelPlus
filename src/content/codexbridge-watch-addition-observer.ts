import type { CodexBridgeWatchSnapshot } from '../shared/codexbridge-thread-monitor-protocol.ts';
import { isCodexBridgeWatchIdentifier } from '../shared/codexbridge-thread-monitor-protocol.ts';

type WatchIdentity = Pick<CodexBridgeWatchSnapshot, 'watchId' | 'connectionId' | 'targetId' | 'threadId' | 'ownerConversationId'>;

export type CodexBridgeWatchAdditionSignal = Readonly<{
  watchId: string;
  connectionId: string;
  targetId: string;
  threadId: string;
  ownerConversationId: string;
}>;

export type CodexBridgeWatchAdditionBatch = Readonly<{
  ownerConversationId: string;
  connectionId: string | null;
  additions: readonly CodexBridgeWatchAdditionSignal[];
}>;

export function collectCodexBridgeWatchAdditionBatch(
  observer: CodexBridgeWatchAdditionObserver,
  pending: Map<string, CodexBridgeWatchAdditionSignal>,
  ownerConversationId: string,
  connectionId: string | null,
  items: readonly WatchIdentity[],
): CodexBridgeWatchAdditionBatch {
  const additions = observer.observeSuccessfulSnapshot(ownerConversationId, connectionId, items);
  if (!connectionId) return { ownerConversationId, connectionId, additions };
  const visible = new Set(items.filter((item) => item.ownerConversationId === ownerConversationId
    && item.connectionId === connectionId).map(watchIdentity));
  const confirmed = new Map(additions.map((item) => [watchIdentity(item), item]));
  for (const [key, item] of pending) {
    if (item.ownerConversationId !== ownerConversationId || item.connectionId !== connectionId) continue;
    if (visible.has(key)) confirmed.set(key, item);
    pending.delete(key);
  }
  return { ownerConversationId, connectionId, additions: [...confirmed.values()] };
}

function watchIdentity(item: WatchIdentity): string {
  return `${item.connectionId}\u0000${item.targetId}\u0000${item.threadId}\u0000${item.watchId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function storedOwnerWatches(value: unknown, ownerConversationId: string): readonly WatchIdentity[] {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2) || !Array.isArray(value.items)) return [];
  return value.items.flatMap((candidate): WatchIdentity[] => {
    if (!isRecord(candidate) || candidate.enabled !== true || candidate.ownerConversationId !== ownerConversationId
      || typeof candidate.watchId !== 'string' || candidate.watchId.length > 96
      || !isCodexBridgeWatchIdentifier(candidate.connectionId) || !isCodexBridgeWatchIdentifier(candidate.targetId)
      || !isCodexBridgeWatchIdentifier(candidate.threadId)) return [];
    return [{
      watchId: candidate.watchId, connectionId: candidate.connectionId, targetId: candidate.targetId,
      threadId: candidate.threadId, ownerConversationId,
    }];
  });
}

export class CodexBridgeWatchAdditionObserver {
  private ownerConversationId: string | null = null;
  private connectionId: string | null = null;
  private observed = new Set<string>();

  observeStorageChange(
    ownerConversationId: string,
    oldValue: unknown,
    newValue: unknown,
  ): readonly CodexBridgeWatchAdditionSignal[] {
    const previous = new Set(storedOwnerWatches(oldValue, ownerConversationId).map(watchIdentity));
    return storedOwnerWatches(newValue, ownerConversationId)
      .filter((item) => !previous.has(watchIdentity(item)))
      .map((item) => ({ watchId: item.watchId, connectionId: item.connectionId, targetId: item.targetId,
        threadId: item.threadId, ownerConversationId }));
  }

  observeSuccessfulSnapshot(
    ownerConversationId: string,
    currentConnectionId: string | null,
    items: readonly WatchIdentity[],
  ): readonly CodexBridgeWatchAdditionSignal[] {
    const current = currentConnectionId ? items.filter((item) => item.connectionId === currentConnectionId
      && item.ownerConversationId === ownerConversationId) : [];
    const identities = new Set(current.map(watchIdentity));
    if (this.ownerConversationId !== ownerConversationId || this.connectionId !== currentConnectionId) {
      this.ownerConversationId = ownerConversationId;
      this.connectionId = currentConnectionId;
      this.observed = identities;
      return [];
    }

    const added = current.filter((item) => !this.observed.has(watchIdentity(item)));
    this.observed = identities;
    return added.map((item) => ({
      watchId: item.watchId, connectionId: item.connectionId, targetId: item.targetId,
      threadId: item.threadId, ownerConversationId,
    }));
  }
}
