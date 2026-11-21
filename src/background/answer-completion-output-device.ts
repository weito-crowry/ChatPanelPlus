import { DEFAULT_COMPLETION_SOUND_ID } from '../shared/answer-completion-sound-definitions.ts';
import type { SoundAsset, SoundAssetsLoadResult } from '../shared/answer-completion-sound-assets.ts';
import { isUserCompletionSoundId } from '../shared/answer-completion-sound-definitions.ts';
import type { OutputDeviceLoadResult } from '../shared/answer-completion-output-device.ts';
import { conversationIdFromPath } from '../shared/conversation-route.ts';
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
  readonly loadConversationMute?: (sender: PlaybackMessageSender, conversationId: string) => Promise<{ readonly ok: true; readonly muted: boolean } | { readonly ok: false }>;
  readonly playOffscreenWithMuteGuard?: (sender: PlaybackMessageSender, conversationId: string,
    request: OffscreenAnswerCompletionSoundRequest) => Promise<
      | { readonly ok: true; readonly result: OffscreenPlaybackResult }
      | { readonly ok: false; readonly reason: 'muted' | 'mute-unavailable' }
    >;
}

export interface PlaybackMessageSender {
  readonly id?: string;
  readonly origin?: string;
  readonly url?: string;
  readonly frameId?: number;
  readonly tab?: { readonly id?: number; readonly url?: string };
}

function validSoundRequestSender(message: unknown, sender: PlaybackMessageSender, extensionId: string): boolean {
  if (sender.id !== extensionId || !isAnswerCompletionSoundRequest(message)) return false;
  if (message.type === ANSWER_COMPLETION_SOUND_ROUTE) {
    try {
      if (!sender.tab?.url || new URL(sender.tab.url).origin !== 'https://chatgpt.com') return false;
      if (message.conversationId === undefined) return true;
      return sender.frameId === 0 && sender.url !== undefined
        && new URL(sender.url).origin === 'https://chatgpt.com'
        && conversationIdFromPath(new URL(sender.url).pathname) === message.conversationId
        && conversationIdFromPath(new URL(sender.tab.url).pathname) === message.conversationId
        && (sender.origin === undefined || sender.origin === 'https://chatgpt.com');
    } catch { return false; }
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
    const muteState = async (): Promise<'allowed' | 'muted' | 'unavailable'> => {
      if (message.type !== ANSWER_COMPLETION_SOUND_ROUTE || message.conversationId === undefined) return 'allowed';
      if (!dependencies.loadConversationMute) return 'unavailable';
      try {
        const result = await dependencies.loadConversationMute(sender, message.conversationId);
        return result.ok ? result.muted ? 'muted' : 'allowed' : 'unavailable';
      } catch { return 'unavailable'; }
    };
    const firstMuteState = await muteState();
    if (firstMuteState !== 'allowed') return { ok: true, route: 'skipped', reason: firstMuteState === 'muted' ? 'muted' : 'mute-unavailable' };
    const selected = await dependencies.loadOutputDevice();
    if (!selected.ok) return { ok: false, reason: selected.reason };
    if (selected.device.deviceId === 'default') {
      const latestMuteState = await muteState();
      return latestMuteState === 'allowed'
        ? { ok: true, route: 'default' }
        : { ok: true, route: 'skipped', reason: latestMuteState === 'muted' ? 'muted' : 'mute-unavailable' };
    }

    const customSoundId = isUserCompletionSoundId(message.soundId);
    const assetResult = customSoundId ? await dependencies.loadAssets() : { ok: true as const, assets: [] };
    const asset = customSoundId ? selectedAsset(assetResult, message.soundId) : undefined;
    const resolvedSoundId = customSoundId && !asset ? DEFAULT_COMPLETION_SOUND_ID : message.soundId;
    const offscreenRequest: OffscreenAnswerCompletionSoundRequest = {
      type: OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND,
      deviceId: selected.device.deviceId,
      soundId: resolvedSoundId,
      volumePercent: message.volumePercent,
      ...(asset ? { asset } : {}),
    };
    if (message.type === ANSWER_COMPLETION_SOUND_ROUTE && message.conversationId !== undefined && dependencies.playOffscreenWithMuteGuard) {
      const guarded = await dependencies.playOffscreenWithMuteGuard(sender, message.conversationId, offscreenRequest);
      if (!guarded.ok) return { ok: true, route: 'skipped', reason: guarded.reason };
      const result = guarded.result;
      return result.ok ? { ok: true, route: 'device' } : playbackFailure(result);
    }
    const latestMuteState = await muteState();
    if (latestMuteState !== 'allowed') return { ok: true, route: 'skipped', reason: latestMuteState === 'muted' ? 'muted' : 'mute-unavailable' };
    const result = await dependencies.playOffscreen(offscreenRequest);
    return result.ok ? { ok: true, route: 'device' } : playbackFailure(result);
  };
}
