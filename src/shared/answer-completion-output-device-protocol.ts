import { isBuiltinCompletionSoundId, isUserCompletionSoundId } from './answer-completion-sound-definitions.ts';
import type { SoundAsset } from './answer-completion-sound-assets.ts';

export const ANSWER_COMPLETION_SOUND_ROUTE = 'CPP_ANSWER_COMPLETION_SOUND_ROUTE';
export const ANSWER_COMPLETION_SOUND_PREVIEW = 'CPP_ANSWER_COMPLETION_SOUND_PREVIEW';
export const OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND = 'CPP_OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND';

export interface AnswerCompletionSoundRequest {
  readonly type: typeof ANSWER_COMPLETION_SOUND_ROUTE | typeof ANSWER_COMPLETION_SOUND_PREVIEW;
  readonly soundId: string;
  readonly volumePercent: number;
}

export interface OffscreenAnswerCompletionSoundRequest {
  readonly type: typeof OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND;
  readonly deviceId: string;
  readonly soundId: string;
  readonly volumePercent: number;
  readonly asset?: SoundAsset;
}

export type AnswerCompletionSoundRouteResult =
  | { readonly ok: true; readonly route: 'default' | 'device' }
  | { readonly ok: false; readonly reason: 'invalid-request' | 'storage-failed' | 'corrupt-selection'
    | 'device-unavailable' | 'permission-denied' | 'sink-failed' | 'offscreen-failed' };

export interface OffscreenPlaybackResult {
  readonly ok: boolean;
  readonly reason?: 'device-unavailable' | 'permission-denied' | 'sink-failed' | 'playback-failed';
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAnswerCompletionSoundRequest(value: unknown): value is AnswerCompletionSoundRequest {
  if (!record(value) || Object.keys(value).some((key) => !['type', 'soundId', 'volumePercent'].includes(key))) return false;
  return (value.type === ANSWER_COMPLETION_SOUND_ROUTE || value.type === ANSWER_COMPLETION_SOUND_PREVIEW)
    && typeof value.soundId === 'string'
    && (isBuiltinCompletionSoundId(value.soundId) || isUserCompletionSoundId(value.soundId))
    && Number.isInteger(value.volumePercent) && (value.volumePercent as number) >= 0 && (value.volumePercent as number) <= 100;
}

export function isOffscreenAnswerCompletionSoundRequest(value: unknown): value is OffscreenAnswerCompletionSoundRequest {
  if (!record(value) || Object.keys(value).some((key) => !['type', 'deviceId', 'soundId', 'volumePercent', 'asset'].includes(key))) return false;
  return value.type === OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND
    && typeof value.deviceId === 'string' && value.deviceId.length > 0 && value.deviceId.length <= 512
    && /^[A-Za-z\d+/_=-]+$/.test(value.deviceId)
    && typeof value.soundId === 'string'
    && (isBuiltinCompletionSoundId(value.soundId) || isUserCompletionSoundId(value.soundId))
    && Number.isInteger(value.volumePercent) && (value.volumePercent as number) >= 0 && (value.volumePercent as number) <= 100
    && (value.asset === undefined || (record(value.asset) && value.asset.id === value.soundId));
}
