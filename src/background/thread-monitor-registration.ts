import {
  CODEX_BRIDGE_THREAD_MONITOR_MAX_WATCHES,
  codexBridgeWatchKey,
  type CodexBridgeTerminalEvent,
  type CodexBridgeWatchOwnerMute,
  type CodexBridgeWatchSnapshot,
} from '../shared/codexbridge-thread-monitor-protocol.ts';

export type WatchRegistrationResult = Readonly<{
  item: CodexBridgeWatchSnapshot | null;
  created: boolean;
  transferred: boolean;
  ownerUnavailable: boolean;
  ownerConflict: boolean;
}>;

export type GuardedWatchRegistrationResult = Readonly<{
  registration: WatchRegistrationResult;
  generationChanged: boolean;
}>;

export function registerCodexBridgeWatch(
  items: CodexBridgeWatchSnapshot[],
  events: CodexBridgeTerminalEvent[],
  candidate: CodexBridgeWatchSnapshot,
  owner?: CodexBridgeWatchOwnerMute,
  allowOwnerTransfer = true,
): Readonly<{ items: CodexBridgeWatchSnapshot[]; events: CodexBridgeTerminalEvent[]; result: WatchRegistrationResult }> {
  const key = codexBridgeWatchKey(candidate.connectionId, candidate.targetId, candidate.threadId);
  const existing = items.find((item) => codexBridgeWatchKey(item.connectionId, item.targetId, item.threadId) === key);
  if (existing) {
    if (!owner || existing.ownerConversationId === owner.ownerConversationId) {
      return { items, events, result: { item: existing, created: false, transferred: false, ownerUnavailable: false, ownerConflict: false } };
    }
    if (!existing.ownerConversationId) {
      return { items, events, result: { item: null, created: false, transferred: false, ownerUnavailable: true, ownerConflict: false } };
    }
    if (!allowOwnerTransfer) {
      return { items, events, result: { item: null, created: false, transferred: false, ownerUnavailable: false, ownerConflict: true } };
    }
    const moved = { ...existing, ...owner };
    return {
      items: items.map((item) => item.watchId === existing.watchId ? moved : item), events,
      result: { item: moved, created: false, transferred: true, ownerUnavailable: false, ownerConflict: false },
    };
  }
  if (items.length >= CODEX_BRIDGE_THREAD_MONITOR_MAX_WATCHES) {
    return { items, events, result: { item: null, created: false, transferred: false, ownerUnavailable: false, ownerConflict: false } };
  }
  return {
    items: [...items, candidate], events,
    result: { item: candidate, created: true, transferred: false, ownerUnavailable: false, ownerConflict: false },
  };
}

export function registerCodexBridgeWatchForGeneration(
  items: CodexBridgeWatchSnapshot[], events: CodexBridgeTerminalEvent[], candidate: CodexBridgeWatchSnapshot,
  owner: CodexBridgeWatchOwnerMute | undefined, allowOwnerTransfer: boolean,
  access: Readonly<{ generation?: number; isCurrent?: () => boolean }>, expectedGeneration?: number,
): Readonly<{ items: CodexBridgeWatchSnapshot[]; events: CodexBridgeTerminalEvent[];
  result: GuardedWatchRegistrationResult }> {
  const current = expectedGeneration === undefined || (access.generation === expectedGeneration
    && (!access.isCurrent || access.isCurrent()));
  if (!current) return { items, events, result: { registration: { item: null, created: false,
    transferred: false, ownerUnavailable: false, ownerConflict: false }, generationChanged: true } };
  const registered = registerCodexBridgeWatch(items, events, candidate, owner, allowOwnerTransfer);
  return { ...registered, result: { registration: registered.result, generationChanged: false } };
}
