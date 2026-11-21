export const GET_CONVERSATION_AUDIO_MUTE = 'GET_CONVERSATION_AUDIO_MUTE';
export const SET_CONVERSATION_AUDIO_MUTE = 'SET_CONVERSATION_AUDIO_MUTE';

export type ConversationAudioMuteGetMessage = Readonly<{
  type: typeof GET_CONVERSATION_AUDIO_MUTE;
  conversationId: string;
}>;

export type ConversationAudioMuteSetMessage = Readonly<{
  type: typeof SET_CONVERSATION_AUDIO_MUTE;
  conversationId: string;
  muted: boolean;
}>;

export type ConversationAudioMuteRequest = ConversationAudioMuteGetMessage | ConversationAudioMuteSetMessage;

export interface ConversationAudioMuteValue {
  readonly schemaVersion: 1;
  readonly muted: boolean;
  readonly revision: number;
}

export function conversationAudioMuteRequestType(message: unknown): typeof GET_CONVERSATION_AUDIO_MUTE | typeof SET_CONVERSATION_AUDIO_MUTE | null {
  if (typeof message !== 'object' || message === null || !('type' in message)) return null;
  return message.type === GET_CONVERSATION_AUDIO_MUTE || message.type === SET_CONVERSATION_AUDIO_MUTE ? message.type : null;
}

export function validateConversationAudioMuteValue(value: unknown): ConversationAudioMuteValue | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 || typeof candidate.muted !== 'boolean'
    || !Number.isSafeInteger(candidate.revision) || (candidate.revision as number) < 0) return null;
  return { schemaVersion: 1, muted: candidate.muted, revision: candidate.revision as number };
}
