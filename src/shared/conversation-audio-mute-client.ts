import { isConversationId } from './conversation-route.ts';
import {
  GET_CONVERSATION_AUDIO_MUTE,
  SET_CONVERSATION_AUDIO_MUTE,
  validateConversationAudioMuteValue,
  type ConversationAudioMuteValue,
} from './conversation-audio-mute-protocol.ts';

export interface ConversationAudioMuteRuntimeLike {
  sendMessage(message: unknown): Promise<unknown>;
}

export type ConversationAudioMuteLoadResult =
  | { readonly ok: true; readonly value: ConversationAudioMuteValue; readonly saved: boolean }
  | { readonly ok: false; readonly reason: 'storage-error' | 'sender-unverified' | 'invalid-response' | 'runtime-unavailable' };

export type ConversationAudioMuteSaveResult =
  | { readonly ok: true; readonly value: ConversationAudioMuteValue }
  | { readonly ok: false; readonly reason: 'storage-error' | 'sender-unverified' | 'invalid-response' | 'runtime-unavailable' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failureReason(value: unknown): 'storage-error' | 'sender-unverified' | 'invalid-response' {
  if (isRecord(value) && value.ok === false && value.reason === 'sender-unverified') return 'sender-unverified';
  if (isRecord(value) && value.ok === false && value.reason === 'storage-error') return 'storage-error';
  return 'invalid-response';
}

export class ConversationAudioMuteClient {
  private readonly runtime: ConversationAudioMuteRuntimeLike;

  constructor(runtime: ConversationAudioMuteRuntimeLike) { this.runtime = runtime; }

  async load(conversationId: string | null): Promise<ConversationAudioMuteLoadResult> {
    if (!isConversationId(conversationId)) return { ok: false, reason: 'storage-error' };
    try {
      const response: unknown = await this.runtime.sendMessage({ type: GET_CONVERSATION_AUDIO_MUTE, conversationId });
      if (!isRecord(response) || response.ok !== true || typeof response.saved !== 'boolean') {
        return { ok: false, reason: failureReason(response) };
      }
      const value = validateConversationAudioMuteValue(response.value);
      return value ? { ok: true, value, saved: response.saved } : { ok: false, reason: 'invalid-response' };
    } catch { return { ok: false, reason: 'runtime-unavailable' }; }
  }

  async setMuted(conversationId: string | null, muted: boolean): Promise<ConversationAudioMuteSaveResult> {
    if (!isConversationId(conversationId)) return { ok: false, reason: 'storage-error' };
    try {
      const response: unknown = await this.runtime.sendMessage({ type: SET_CONVERSATION_AUDIO_MUTE, conversationId, muted });
      if (!isRecord(response) || response.ok !== true) return { ok: false, reason: failureReason(response) };
      const value = validateConversationAudioMuteValue(response.value);
      return value ? { ok: true, value } : { ok: false, reason: 'invalid-response' };
    } catch { return { ok: false, reason: 'runtime-unavailable' }; }
  }
}

export function createChromeConversationAudioMuteClient(): ConversationAudioMuteClient {
  return new ConversationAudioMuteClient(chrome.runtime);
}
