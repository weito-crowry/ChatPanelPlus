import { conversationIdFromPath, isConversationId } from '../shared/conversation-route.ts';
import {
  conversationAudioMuteRequestType,
  GET_CONVERSATION_AUDIO_MUTE,
  SET_CONVERSATION_AUDIO_MUTE,
  validateConversationAudioMuteValue,
  type ConversationAudioMuteValue,
} from '../shared/conversation-audio-mute-protocol.ts';

export const CONVERSATION_AUDIO_MUTE_SESSION_KEY_PREFIX = 'chatPanelPlus.answerCompletionMute.session.v1:';
const CHATGPT_ORIGIN = 'https://chatgpt.com';

export interface ConversationAudioMuteSessionLike {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface ConversationAudioMuteSenderLike {
  readonly id?: string;
  readonly origin?: string;
  readonly url?: string;
  readonly frameId?: number;
  readonly tab?: { readonly id?: number; readonly url?: string };
}

interface ReadResult {
  readonly ok: true;
  readonly value: ConversationAudioMuteValue;
  readonly saved: boolean;
}

interface ErrorResult { readonly ok: false; readonly reason: 'invalid-data' | 'storage-error' }

function trustedIdentity(sender: ConversationAudioMuteSenderLike, extensionId: string, requestedId: unknown): { tabId: number; conversationId: string } | null {
  const tabId = sender.tab?.id;
  if (sender.id !== extensionId || sender.frameId !== 0 || !Number.isSafeInteger(tabId) || (tabId ?? -1) < 0
    || !isConversationId(requestedId) || !sender.url || !sender.tab?.url) return null;
  try {
    const frameUrl = new URL(sender.url);
    const tabUrl = new URL(sender.tab.url);
    if (frameUrl.origin !== CHATGPT_ORIGIN || tabUrl.origin !== CHATGPT_ORIGIN
      || conversationIdFromPath(frameUrl.pathname) !== requestedId
      || conversationIdFromPath(tabUrl.pathname) !== requestedId
      || (sender.origin !== undefined && sender.origin !== CHATGPT_ORIGIN)) return null;
  } catch { return null; }
  return { tabId: tabId!, conversationId: requestedId };
}

function sessionKey(tabId: number, conversationId: string): string {
  return `${CONVERSATION_AUDIO_MUTE_SESSION_KEY_PREFIX}${tabId}.${conversationId}`;
}

export class ConversationAudioMuteStore {
  private readonly session: ConversationAudioMuteSessionLike;
  private readonly queues = new Map<string, Promise<void>>();

  constructor(session: ConversationAudioMuteSessionLike) { this.session = session; }

  load(tabId: number, conversationId: string): Promise<ReadResult | ErrorResult> {
    const key = sessionKey(tabId, conversationId);
    return this.serial(key, async () => {
      try {
        const stored = await this.session.get(key);
        if (!(key in stored)) return { ok: true, value: { schemaVersion: 1, muted: false, revision: 0 }, saved: false };
        const value = validateConversationAudioMuteValue(stored[key]);
        return value ? { ok: true, value, saved: true } : { ok: false, reason: 'invalid-data' };
      } catch { return { ok: false, reason: 'storage-error' }; }
    });
  }

  set(tabId: number, conversationId: string, muted: boolean): Promise<ReadResult | ErrorResult> {
    const key = sessionKey(tabId, conversationId);
    return this.serial(key, async () => {
      try {
        const stored = await this.session.get(key);
        const previous = key in stored ? validateConversationAudioMuteValue(stored[key]) : { schemaVersion: 1 as const, muted: false, revision: 0 };
        if (!previous) return { ok: false, reason: 'invalid-data' };
        if (previous.muted === muted) return { ok: true, value: previous, saved: true };
        if (previous.revision >= Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'invalid-data' };
        const value: ConversationAudioMuteValue = { schemaVersion: 1, muted, revision: previous.revision + 1 };
        await this.session.set({ [key]: value });
        return { ok: true, value, saved: true };
      } catch { return { ok: false, reason: 'storage-error' }; }
    });
  }

  runIfUnmuted<T>(tabId: number, conversationId: string, action: () => Promise<T>): Promise<
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly reason: 'muted' | 'unavailable' }
  > {
    const key = sessionKey(tabId, conversationId);
    return this.serial(key, async () => {
      try {
        const stored = await this.session.get(key);
        const value = key in stored ? validateConversationAudioMuteValue(stored[key]) : { schemaVersion: 1 as const, muted: false, revision: 0 };
        if (!value) return { ok: false, reason: 'unavailable' };
        if (value.muted) return { ok: false, reason: 'muted' };
        return { ok: true, value: await action() };
      } catch { return { ok: false, reason: 'unavailable' }; }
    });
  }

  private async serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.queues.set(key, current);
    await previous;
    try { return await action(); }
    finally {
      release();
      if (this.queues.get(key) === current) this.queues.delete(key);
    }
  }
}

export function createConversationAudioMuteMessageHandler(store: ConversationAudioMuteStore, extensionId: string) {
  return async (message: unknown, sender: ConversationAudioMuteSenderLike): Promise<ReadResult | ErrorResult | null> => {
    const type = conversationAudioMuteRequestType(message);
    if (!type || typeof message !== 'object' || message === null || !('conversationId' in message)) return null;
    const request = message as Record<string, unknown>;
    const identity = trustedIdentity(sender, extensionId, request.conversationId);
    if (!identity) return null;
    if (type === GET_CONVERSATION_AUDIO_MUTE) return store.load(identity.tabId, identity.conversationId);
    if (type !== SET_CONVERSATION_AUDIO_MUTE || typeof request.muted !== 'boolean') return null;
    return store.set(identity.tabId, identity.conversationId, request.muted);
  };
}

export async function removeConversationAudioMuteEntriesForTab(session: ConversationAudioMuteSessionLike, tabId: number): Promise<void> {
  const entries = await session.get(null);
  const prefix = `${CONVERSATION_AUDIO_MUTE_SESSION_KEY_PREFIX}${tabId}.`;
  const keys = Object.keys(entries).filter((key) => key.startsWith(prefix));
  if (keys.length) await session.remove(keys);
}
