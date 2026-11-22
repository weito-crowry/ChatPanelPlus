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
}>;

export function registerCodexBridgeWatch(
  items: CodexBridgeWatchSnapshot[],
  events: CodexBridgeTerminalEvent[],
  candidate: CodexBridgeWatchSnapshot,
  owner?: CodexBridgeWatchOwnerMute,
): Readonly<{ items: CodexBridgeWatchSnapshot[]; events: CodexBridgeTerminalEvent[]; result: WatchRegistrationResult }> {
  const key = codexBridgeWatchKey(candidate.connectionId, candidate.targetId, candidate.threadId);
  const existing = items.find((item) => codexBridgeWatchKey(item.connectionId, item.targetId, item.threadId) === key);
  if (existing) {
    if (!owner || existing.ownerConversationId === owner.ownerConversationId) {
      return { items, events, result: { item: existing, created: false, transferred: false, ownerUnavailable: false } };
    }
    if (!existing.ownerConversationId) {
      return { items, events, result: { item: existing, created: false, transferred: false, ownerUnavailable: true } };
    }
    const moved = { ...existing, ...owner };
    return {
      items: items.map((item) => item.watchId === existing.watchId ? moved : item), events,
      result: { item: moved, created: false, transferred: true, ownerUnavailable: false },
    };
  }
  if (items.length >= CODEX_BRIDGE_THREAD_MONITOR_MAX_WATCHES) {
    return { items, events, result: { item: null, created: false, transferred: false, ownerUnavailable: false } };
  }
  return {
    items: [...items, candidate], events,
    result: { item: candidate, created: true, transferred: false, ownerUnavailable: false },
  };
}
