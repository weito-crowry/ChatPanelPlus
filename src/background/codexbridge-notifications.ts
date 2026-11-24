import type { CodexBridgeNotificationHandler, CodexBridgeNotificationPlayResult, CodexBridgeNotificationPreparation } from './thread-monitor.ts';
import type { CodexBridgeTerminalEvent } from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { SettingsRepository } from '../shared/settings-repository.ts';
import type { AnswerCompletionOutputDeviceRepository } from '../shared/answer-completion-output-device.ts';
import type { SoundAsset, SoundAssetRepository } from '../shared/answer-completion-sound-assets.ts';
import {
  DEFAULT_CODEX_BRIDGE_TERMINAL_SOUND_ID,
  isUserCompletionSoundId,
} from '../shared/answer-completion-sound-definitions.ts';
import { DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT } from '../shared/answer-completion-sound-volume.ts';
import { OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND } from '../shared/answer-completion-output-device-protocol.ts';
import type { OffscreenAudioTransport } from './offscreen-audio-transport.ts';

export function createCodexBridgeNotificationHandler(dependencies: Readonly<{
  settings: Pick<SettingsRepository, 'loadSettings'>;
  outputDevice: Pick<AnswerCompletionOutputDeviceRepository, 'load'>;
  assets: Pick<SoundAssetRepository, 'loadAssets'>;
  audio: OffscreenAudioTransport | null;
  loadOwnerMute: (event: CodexBridgeTerminalEvent) => Promise<{ readonly ok: true; readonly muted: boolean | null } | { readonly ok: false }>;
  playWithOwnerMuteGuard: (event: CodexBridgeTerminalEvent, action: () => Promise<CodexBridgeNotificationPlayResult>) =>
    Promise<CodexBridgeNotificationPlayResult>;
}>): CodexBridgeNotificationHandler {
  return {
    async prepare(event): Promise<CodexBridgeNotificationPreparation> {
      if (event.ownerTabId === undefined || event.ownerConversationId === undefined || event.ownerMuted == null
        || event.ownerMuteRevision === undefined) return { state: 'skipped', reason: 'owner-unavailable' };
      const ownerMute = await dependencies.loadOwnerMute(event);
      if (!ownerMute.ok) return { state: 'skipped', reason: 'owner-unavailable' };
      if (ownerMute.muted === null) return { state: 'skipped', reason: 'owner-unavailable' };
      if (ownerMute.muted) return { state: 'skipped', reason: 'muted' };
      const loaded = await dependencies.settings.loadSettings();
      if (!loaded.ok) return { state: 'failed', reason: 'settings-unavailable' };
      if (loaded.settings.codexBridgeTerminalSoundEnabled !== true) return { state: 'skipped', reason: 'disabled' };
      const volumePercent = loaded.settings.codexBridgeTerminalSoundVolumePercent
        ?? DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT;
      if (volumePercent === 0) return { state: 'skipped', reason: 'volume-zero' };

      const output = await dependencies.outputDevice.load();
      if (!output.ok) return { state: 'failed', reason: 'output-device-unavailable' };
      const deviceIds = output.selection.devices.length > 0
        ? output.selection.devices.map(({ deviceId }) => deviceId) : ['default'];
      const selectedSoundId = loaded.settings.codexBridgeTerminalSoundId ?? DEFAULT_CODEX_BRIDGE_TERMINAL_SOUND_ID;
      let asset: SoundAsset | undefined;
      if (isUserCompletionSoundId(selectedSoundId)) {
        const loadedAssets = await dependencies.assets.loadAssets();
        if (loadedAssets.ok) asset = loadedAssets.assets.find((candidate) => candidate.id === selectedSoundId);
      }
      const soundId = isUserCompletionSoundId(selectedSoundId) && !asset ? DEFAULT_CODEX_BRIDGE_TERMINAL_SOUND_ID : selectedSoundId;
      return {
        state: 'ready',
        play: async () => dependencies.playWithOwnerMuteGuard(event, async () => {
          if (!dependencies.audio) return { ok: false, reason: 'playback-failed' };
          const result = await dependencies.audio.play({
            type: OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND, deviceIds,
            soundId, volumePercent, ...(asset && soundId === selectedSoundId ? { asset } : {}),
          });
          if (result.status === 'partial') return { ok: true, reason: 'partial-output' };
          if (result.ok) return { ok: true };
          return { ok: false, reason: result.failures[0] ?? 'playback-failed' };
        }),
      };
    },
  };
}
