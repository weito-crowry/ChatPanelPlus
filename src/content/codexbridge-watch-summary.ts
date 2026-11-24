import type { CodexBridgeTerminalEvent, CodexBridgeWatchSnapshot } from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeWatchListFailureReason } from './codexbridge-watch-response.ts';
import { filterOwnedWatchData, watchListFailureLabel, type CodexBridgeUnacknowledgedEventGroup } from './codexbridge-watch-presentation.ts';

export type CodexBridgeWatchSummary = Readonly<{
  conversationId: string;
  status: 'loading' | 'ready' | 'error';
  currentConnectionId: string | null;
  items: readonly CodexBridgeWatchSnapshot[];
  events: readonly CodexBridgeTerminalEvent[];
  unacknowledgedGroups: readonly CodexBridgeUnacknowledgedEventGroup[];
  watchingCount: number | null;
  unacknowledgedThreadCount: number | null;
  operationBusy: boolean;
  error: string | null;
}>;

export type CodexBridgeWatchSummaryInput = Readonly<{
  conversationId: string | null;
  listConversationId: string | null;
  listLoading: boolean;
  listFailure: CodexBridgeWatchListFailureReason | 'runtime-unavailable' | 'timeout' | null;
  listFailureConversationId: string | null;
  currentConnectionId: string | null;
  items: readonly CodexBridgeWatchSnapshot[];
  events: readonly CodexBridgeTerminalEvent[];
  operationBusy: boolean;
  notificationError: string | null;
}>;

const EMPTY_ITEMS: readonly CodexBridgeWatchSnapshot[] = [];
const EMPTY_EVENTS: readonly CodexBridgeTerminalEvent[] = [];
const EMPTY_GROUPS: readonly CodexBridgeUnacknowledgedEventGroup[] = [];

function emptySummary(conversationId: string, input: CodexBridgeWatchSummaryInput,
  status: 'loading' | 'error', error: string | null): CodexBridgeWatchSummary {
  return { conversationId, status, currentConnectionId: null, items: EMPTY_ITEMS, events: EMPTY_EVENTS,
    unacknowledgedGroups: EMPTY_GROUPS, watchingCount: null, unacknowledgedThreadCount: null,
    operationBusy: input.operationBusy, error };
}

export function createCodexBridgeWatchSummary(input: CodexBridgeWatchSummaryInput): CodexBridgeWatchSummary | null {
  const { conversationId } = input;
  if (!conversationId) return null;
  const notificationError = input.listConversationId === conversationId ? input.notificationError : null;
  if (input.listFailure && input.listFailureConversationId === conversationId) {
    return emptySummary(conversationId, input, 'error', notificationError ?? watchListFailureLabel(input.listFailure));
  }
  if (input.listLoading || input.listConversationId !== conversationId) {
    return emptySummary(conversationId, input, 'loading', notificationError);
  }
  const owned = filterOwnedWatchData({ items: input.items, events: input.events }, conversationId);
  const unacknowledgedGroups = owned.unacknowledgedGroups;
  return {
    conversationId, status: 'ready', currentConnectionId: input.currentConnectionId,
    items: owned.items, events: owned.events, unacknowledgedGroups,
    watchingCount: owned.summary.watchingCount, unacknowledgedThreadCount: unacknowledgedGroups.length,
    operationBusy: input.operationBusy, error: notificationError,
  };
}
