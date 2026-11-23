import { conversationIdFromPath, isConversationId } from './conversation-route.ts';

export const CODEX_BRIDGE_OWNER_IDENTITY_PING = 'CODEX_BRIDGE_OWNER_IDENTITY_PING' as const;
export const CODEX_BRIDGE_OWNER_IDENTITY_PONG = 'CODEX_BRIDGE_OWNER_IDENTITY_PONG' as const;

const OWNER_ORIGIN = 'https://chatgpt.com';
const OWNER_IDENTITY_NONCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonce(value: unknown): value is string {
  return typeof value === 'string' && OWNER_IDENTITY_NONCE_PATTERN.test(value);
}

export type CodexBridgeOwnerIdentityPong = Readonly<{
  type: typeof CODEX_BRIDGE_OWNER_IDENTITY_PONG;
  nonce: string;
  conversationId: string;
}>;

export function createCodexBridgeOwnerIdentityResponse(
  message: unknown,
  senderId: string | undefined,
  extensionId: string,
  pageUrl: string,
): CodexBridgeOwnerIdentityPong | null {
  if (senderId !== extensionId || !isRecord(message) || Object.keys(message).length !== 2
    || message.type !== CODEX_BRIDGE_OWNER_IDENTITY_PING || !isNonce(message.nonce)) return null;
  try {
    const url = new URL(pageUrl);
    if (url.origin !== OWNER_ORIGIN || url.username || url.password) return null;
    const conversationId = conversationIdFromPath(url.pathname);
    if (!isConversationId(conversationId)) return null;
    return { type: CODEX_BRIDGE_OWNER_IDENTITY_PONG, nonce: message.nonce, conversationId };
  } catch { return null; }
}

export function isCodexBridgeOwnerIdentityResponse(
  value: unknown,
  nonce: string,
  conversationId: string,
): value is CodexBridgeOwnerIdentityPong {
  return codexBridgeOwnerIdentityConversationId(value, nonce) === conversationId;
}

export function codexBridgeOwnerIdentityConversationId(value: unknown, nonce: string): string | null {
  return isRecord(value) && Object.keys(value).length === 3
    && value.type === CODEX_BRIDGE_OWNER_IDENTITY_PONG && isNonce(nonce) && value.nonce === nonce
    && isConversationId(value.conversationId) ? value.conversationId : null;
}
