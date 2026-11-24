import { isBuiltinCompletionSoundId, isUserCompletionSoundId } from './answer-completion-sound-definitions.ts';
import type { SoundAsset } from './answer-completion-sound-assets.ts';
import { MAX_ANSWER_COMPLETION_OUTPUT_DEVICES } from './answer-completion-output-device.ts';
import { isConversationId } from './conversation-route.ts';

export const ANSWER_COMPLETION_SOUND_ROUTE = 'CPP_ANSWER_COMPLETION_SOUND_ROUTE';
export const ANSWER_COMPLETION_SOUND_PREVIEW = 'CPP_ANSWER_COMPLETION_SOUND_PREVIEW';
export const OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND = 'CPP_OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND';

export interface AnswerCompletionSoundRequest {
  readonly type: typeof ANSWER_COMPLETION_SOUND_ROUTE | typeof ANSWER_COMPLETION_SOUND_PREVIEW;
  readonly soundId: string;
  readonly volumePercent: number;
  readonly conversationId?: string;
}

export interface OffscreenAnswerCompletionSoundRequest {
  readonly type: typeof OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND;
  readonly deviceIds: readonly string[];
  readonly soundId: string;
  readonly volumePercent: number;
  readonly asset?: SoundAsset;
}

export type AnswerCompletionSoundRouteResult =
  | { readonly ok: true; readonly route: 'default' }
  | { readonly ok: true; readonly route: 'device'; readonly playback: OffscreenPlaybackResult }
  | { readonly ok: true; readonly route: 'partial-device'; readonly playback: OffscreenPlaybackResult }
  | { readonly ok: true; readonly route: 'skipped'; readonly reason: 'muted' | 'mute-unavailable' }
  | { readonly ok: false; readonly reason: 'invalid-request' | 'storage-failed' | 'corrupt-selection'
    | 'device-unavailable' | 'permission-denied' | 'sink-failed' | 'offscreen-failed' | 'mute-unavailable'; readonly playback?: OffscreenPlaybackResult };

export type OffscreenPlaybackFailureReason = 'device-unavailable' | 'permission-denied' | 'sink-failed' | 'playback-failed';
export interface OffscreenPlaybackResult {
  readonly ok: boolean;
  readonly status: 'complete' | 'partial' | 'failed';
  readonly outputCount: number;
  readonly succeededCount: number;
  readonly failures: readonly OffscreenPlaybackFailureReason[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAnswerCompletionSoundRequest(value: unknown): value is AnswerCompletionSoundRequest {
  if (!record(value) || Object.keys(value).some((key) => !['type', 'soundId', 'volumePercent', 'conversationId'].includes(key))) return false;
  return (value.type === ANSWER_COMPLETION_SOUND_ROUTE || value.type === ANSWER_COMPLETION_SOUND_PREVIEW)
    && (value.conversationId === undefined || (value.type === ANSWER_COMPLETION_SOUND_ROUTE && isConversationId(value.conversationId)))
    && typeof value.soundId === 'string'
    && (isBuiltinCompletionSoundId(value.soundId) || isUserCompletionSoundId(value.soundId))
    && Number.isInteger(value.volumePercent) && (value.volumePercent as number) >= 0 && (value.volumePercent as number) <= 100;
}

export function isAnswerCompletionSoundRouteResult(value: unknown): value is AnswerCompletionSoundRouteResult {
  if (!record(value) || typeof value.ok !== 'boolean') return false;
  if (value.ok) {
    if (value.route === 'default') return Object.keys(value).every((key) => ['ok', 'route'].includes(key));
    if (value.route === 'skipped') return Object.keys(value).every((key) => ['ok', 'route', 'reason'].includes(key))
      && (value.reason === 'muted' || value.reason === 'mute-unavailable');
    if (value.route !== 'device' && value.route !== 'partial-device') return false;
    if (Object.keys(value).some((key) => !['ok', 'route', 'playback'].includes(key))
      || !isOffscreenPlaybackResult(value.playback)) return false;
    return value.route === 'device' ? value.playback.status === 'complete' : value.playback.status === 'partial';
  }
  const reasons = ['invalid-request', 'storage-failed', 'corrupt-selection', 'device-unavailable',
    'permission-denied', 'sink-failed', 'offscreen-failed', 'mute-unavailable'];
  return Object.keys(value).every((key) => ['ok', 'reason', 'playback'].includes(key))
    && reasons.includes(String(value.reason))
    && (value.playback === undefined || (isOffscreenPlaybackResult(value.playback) && value.playback.status === 'failed'));
}

export function isOffscreenAnswerCompletionSoundRequest(value: unknown): value is OffscreenAnswerCompletionSoundRequest {
  if (!record(value) || Object.keys(value).some((key) => !['type', 'deviceIds', 'soundId', 'volumePercent', 'asset'].includes(key))) return false;
  if (value.type !== OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND || !Array.isArray(value.deviceIds)
    || value.deviceIds.length === 0 || value.deviceIds.length > MAX_ANSWER_COMPLETION_OUTPUT_DEVICES) return false;
  const deviceIds = value.deviceIds;
  if (deviceIds.some((deviceId) => typeof deviceId !== 'string' || deviceId.length === 0 || deviceId.length > 512
      || !/^[A-Za-z\d+/_=-]+$/.test(deviceId))
    || new Set(deviceIds).size !== deviceIds.length
    || (deviceIds.includes('default') && deviceIds.length !== 1)) return false;
  return typeof value.soundId === 'string'
    && (isBuiltinCompletionSoundId(value.soundId) || isUserCompletionSoundId(value.soundId))
    && Number.isInteger(value.volumePercent) && (value.volumePercent as number) >= 0 && (value.volumePercent as number) <= 100
    && (value.asset === undefined || (record(value.asset) && value.asset.id === value.soundId));
}

export function isOffscreenPlaybackResult(value: unknown): value is OffscreenPlaybackResult {
  if (!record(value) || Object.keys(value).some((key) => !['ok', 'status', 'outputCount', 'succeededCount', 'failures'].includes(key))) return false;
  if (typeof value.ok !== 'boolean' || !['complete', 'partial', 'failed'].includes(String(value.status))
    || !Number.isSafeInteger(value.outputCount) || (value.outputCount as number) < 1
    || (value.outputCount as number) > MAX_ANSWER_COMPLETION_OUTPUT_DEVICES
    || !Number.isSafeInteger(value.succeededCount) || (value.succeededCount as number) < 0
    || (value.succeededCount as number) > (value.outputCount as number) || !Array.isArray(value.failures)) return false;
  const failures = value.failures as unknown[];
  if (failures.length !== (value.outputCount as number) - (value.succeededCount as number)
    || failures.some((reason) => !['device-unavailable', 'permission-denied', 'sink-failed', 'playback-failed'].includes(String(reason)))) return false;
  const status = value.succeededCount === value.outputCount ? 'complete'
    : value.succeededCount === 0 ? 'failed' : 'partial';
  return value.status === status && value.ok === (status !== 'failed');
}
