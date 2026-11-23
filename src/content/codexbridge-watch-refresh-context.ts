import type { CodexBridgeThreadListMode } from './codexbridge-request-tracker.ts';

export type CodexBridgeWatchRefreshContext = Readonly<{
  ownerConversationId: string;
  connectionId: string;
  targetId: string;
  mode: CodexBridgeThreadListMode;
  watchGeneration: number;
  routeGeneration: number;
}>;

export function isCodexBridgeWatchRefreshContextCurrent(
  expected: CodexBridgeWatchRefreshContext,
  current: CodexBridgeWatchRefreshContext & Readonly<{ connected: boolean; routeCurrent: boolean }>,
): boolean {
  return current.ownerConversationId === expected.ownerConversationId && current.connectionId === expected.connectionId
    && current.targetId === expected.targetId && current.mode === expected.mode
    && current.watchGeneration === expected.watchGeneration && current.routeGeneration === expected.routeGeneration
    && current.connected && current.routeCurrent;
}
