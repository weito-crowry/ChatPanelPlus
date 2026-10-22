import { isConversationId } from '../shared/conversation-route.ts';
import {
  CODEX_WORK_MODE_GET,
  CODEX_WORK_MODE_SET,
  CODEX_WORK_MODE_UPDATED,
  codexWorkModeRequestType,
} from '../shared/codex-work-mode-protocol.ts';
import {
  validateCodexWorkMode,
  type CodexWorkModeReadResult,
  type CodexWorkModeValue,
} from '../shared/codex-work-mode-repository.ts';

export const CODEX_WORK_MODE_SESSION_KEY_PREFIX = 'chatPanelPlus.codexWorkMode.session.v1:';
const CHATGPT_ORIGIN = 'https://chatgpt.com';

export interface CodexWorkModeSessionStorageLike {
  get(keys: string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface CodexWorkModeMessageSenderLike {
  readonly id?: string;
  readonly origin?: string;
  readonly url?: string;
  readonly frameId?: number;
  readonly tab?: { readonly id?: number };
}

export type CodexWorkModeMessageHandler = (
  message: unknown,
  sender: CodexWorkModeMessageSenderLike,
) => Promise<unknown | null>;

type NotifyTab = (tabId: number, message: unknown) => void | Promise<unknown>;

function sessionKey(tabId: number, conversationId: string): string {
  return `${CODEX_WORK_MODE_SESSION_KEY_PREFIX}${tabId}.${conversationId}`;
}

function trustedTabId(sender: CodexWorkModeMessageSenderLike, extensionId: string): number | null {
  const tabId = sender.tab?.id;
  if (sender.id !== extensionId || !Number.isSafeInteger(tabId) || (tabId ?? -1) < 0 || sender.frameId !== 0) return null;
  let urlOrigin: string | undefined;
  if (sender.url) {
    try { urlOrigin = new URL(sender.url).origin; } catch { return null; }
    if (urlOrigin !== CHATGPT_ORIGIN) return null;
  }
  if (sender.origin !== undefined && sender.origin !== CHATGPT_ORIGIN) return null;
  if (sender.origin !== CHATGPT_ORIGIN && urlOrigin !== CHATGPT_ORIGIN) return null;
  return tabId!;
}

export function createCodexWorkModeMessageHandler(
  session: CodexWorkModeSessionStorageLike,
  extensionId: string,
  notifyTab?: NotifyTab,
): CodexWorkModeMessageHandler {
  return async (message, sender) => {
    const requestType = codexWorkModeRequestType(message);
    const tabId = trustedTabId(sender, extensionId);
    if (!requestType || tabId === null || typeof message !== 'object' || message === null || !('conversationId' in message)) return null;
    const request = message as Record<string, unknown>;
    const conversationId = request.conversationId;
    if (!isConversationId(conversationId)) return null;
    const key = sessionKey(tabId, conversationId);

    if (requestType === CODEX_WORK_MODE_GET) {
      try {
        const stored = await session.get(key);
        if (!(key in stored)) return { ok: true, value: { schemaVersion: 1, enabled: false }, saved: false };
        const validated = validateCodexWorkMode(stored[key]);
        return validated.ok ? { ...validated, saved: true } : validated;
      } catch {
        return { ok: false, reason: 'storage-error' };
      }
    }

    if (requestType !== CODEX_WORK_MODE_SET || typeof request.enabled !== 'boolean') return null;
    const value: CodexWorkModeValue = { schemaVersion: 1, enabled: request.enabled };
    try {
      await session.set({ [key]: value });
    } catch {
      return { ok: false, reason: 'storage-error' };
    }
    const updated: CodexWorkModeReadResult = { ok: true, value, saved: true };
    try {
      void Promise.resolve(notifyTab?.(tabId, { type: CODEX_WORK_MODE_UPDATED, conversationId, result: updated })).catch(() => undefined);
    } catch {
      // A missing content-script receiver does not undo a completed session write.
    }
    return { ok: true, value };
  };
}

export async function removeCodexWorkModeEntriesForTab(
  session: CodexWorkModeSessionStorageLike,
  tabId: number,
): Promise<void> {
  try {
    const entries = await session.get(null);
    const prefix = `${CODEX_WORK_MODE_SESSION_KEY_PREFIX}${tabId}.`;
    const keys = Object.keys(entries).filter((key) => key.startsWith(prefix));
    if (keys.length) await session.remove(keys);
  } catch {
    // Tab closure is best-effort cleanup; session storage still expires with the browser session.
  }
}
