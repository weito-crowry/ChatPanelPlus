import { DEFAULT_COMPLETION_SOUND_ID } from '../shared/answer-completion-sound-definitions.ts';
import type { SoundAsset, SoundAssetsLoadResult } from '../shared/answer-completion-sound-assets.ts';
import { isUserCompletionSoundId } from '../shared/answer-completion-sound-definitions.ts';
import type { OutputDeviceLoadResult } from '../shared/answer-completion-output-device.ts';
import {
  ANSWER_COMPLETION_SOUND_ROUTE,
  OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND,
  isAnswerCompletionSoundRequest,
  type AnswerCompletionSoundRouteResult,
  type OffscreenPlaybackResult,
  type OffscreenAnswerCompletionSoundRequest,
} from '../shared/answer-completion-output-device-protocol.ts';

export interface OutputDevicePlaybackDependencies {
  readonly loadOutputDevice: () => Promise<OutputDeviceLoadResult>;
  readonly loadAssets: () => Promise<SoundAssetsLoadResult>;
  readonly playOffscreen: (request: OffscreenAnswerCompletionSoundRequest) => Promise<OffscreenPlaybackResult>;
}

export interface PlaybackMessageSender {
  readonly id?: string;
  readonly url?: string;
  readonly tab?: { readonly url?: string };
}

function validSoundRequestSender(message: unknown, sender: PlaybackMessageSender, extensionId: string): boolean {
  if (sender.id !== extensionId || !isAnswerCompletionSoundRequest(message)) return false;
  if (message.type === ANSWER_COMPLETION_SOUND_ROUTE) {
    try { return sender.tab?.url ? new URL(sender.tab.url).origin === 'https://chatgpt.com' : false; } catch { return false; }
  }
  return sender.url?.startsWith(`chrome-extension://${extensionId}/`) === true;
}

function selectedAsset(assets: SoundAssetsLoadResult, soundId: string): SoundAsset | undefined {
  if (!assets.ok) return undefined;
  return assets.assets.find((asset) => asset.id === soundId);
}

function playbackFailure(result: OffscreenPlaybackResult): AnswerCompletionSoundRouteResult {
  if (result.reason === 'device-unavailable') return { ok: false, reason: 'device-unavailable' };
  if (result.reason === 'permission-denied') return { ok: false, reason: 'permission-denied' };
  if (result.reason === 'sink-failed') return { ok: false, reason: 'sink-failed' };
  return { ok: false, reason: 'offscreen-failed' };
}

export function createOutputDevicePlaybackMessageHandler(dependencies: OutputDevicePlaybackDependencies) {
  return async (message: unknown, sender: PlaybackMessageSender, extensionId: string): Promise<AnswerCompletionSoundRouteResult | undefined> => {
    if (!isAnswerCompletionSoundRequest(message)) return undefined;
    if (!validSoundRequestSender(message, sender, extensionId)) return undefined;
    const selected = await dependencies.loadOutputDevice();
    if (!selected.ok) return { ok: false, reason: selected.reason };
    if (selected.device.deviceId === 'default') return { ok: true, route: 'default' };

    const customSoundId = isUserCompletionSoundId(message.soundId);
    const assetResult = customSoundId ? await dependencies.loadAssets() : { ok: true as const, assets: [] };
    const asset = customSoundId ? selectedAsset(assetResult, message.soundId) : undefined;
    const resolvedSoundId = customSoundId && !asset ? DEFAULT_COMPLETION_SOUND_ID : message.soundId;
    const result = await dependencies.playOffscreen({
      type: OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND,
      deviceId: selected.device.deviceId,
      soundId: resolvedSoundId,
      volumePercent: message.volumePercent,
      ...(asset ? { asset } : {}),
    });
    return result.ok ? { ok: true, route: 'device' } : playbackFailure(result);
  };
}
