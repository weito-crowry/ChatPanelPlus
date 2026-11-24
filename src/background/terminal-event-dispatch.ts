import { isConversationId } from '../shared/conversation-route.ts';
import {
  CODEX_BRIDGE_TERMINAL_EVENT_SAVED,
  isCodexBridgeWatchIdentifier,
  type CodexBridgeTerminalEventSavedMessage,
} from '../shared/codexbridge-thread-monitor-protocol.ts';

export type TerminalEventDispatchPorts = Readonly<{
  ownerMatches: (tabId: number, conversationId: string) => Promise<boolean>;
  send: (tabId: number, message: CodexBridgeTerminalEventSavedMessage) => Promise<unknown>;
}>;

export async function dispatchCodexBridgeTerminalEventSaved(event: unknown, ports: TerminalEventDispatchPorts): Promise<boolean> {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return false;
  const identity = event as Record<string, unknown>;
  if (!isCodexBridgeWatchIdentifier(identity.eventId) || identity.eventId.length > 96
    || !Number.isSafeInteger(identity.ownerTabId) || (identity.ownerTabId as number) < 0
    || !isConversationId(identity.ownerConversationId)
    || typeof identity.detectedAt !== 'string' || !Number.isFinite(Date.parse(identity.detectedAt))) return false;
  const message: CodexBridgeTerminalEventSavedMessage = {
    type: CODEX_BRIDGE_TERMINAL_EVENT_SAVED,
    eventId: identity.eventId,
    ownerConversationId: identity.ownerConversationId,
    detectedAt: identity.detectedAt,
  };
  try {
    if (!await ports.ownerMatches(identity.ownerTabId as number, identity.ownerConversationId)) return false;
    await ports.send(identity.ownerTabId as number, message);
    return true;
  } catch {
    return false;
  }
}
