import type { CodexBridgeNotificationHandler, CodexBridgeNotificationPreparation } from './thread-monitor.ts';
import type { SettingsRepository } from '../shared/settings-repository.ts';
import type { AnswerCompletionOutputDeviceRepository } from '../shared/answer-completion-output-device.ts';
import type { SoundAsset, SoundAssetRepository } from '../shared/answer-completion-sound-assets.ts';
import { DEFAULT_COMPLETION_SOUND_ID, isUserCompletionSoundId } from '../shared/answer-completion-sound-definitions.ts';
import { DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT } from '../shared/answer-completion-sound-volume.ts';
import { OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND } from '../shared/answer-completion-output-device-protocol.ts';
import type { OffscreenAudioTransport } from './offscreen-audio-transport.ts';

export function createCodexBridgeNotificationHandler(dependencies: Readonly<{
  settings: Pick<SettingsRepository, 'loadSettings'>;
  outputDevice: Pick<AnswerCompletionOutputDeviceRepository, 'load'>;
  assets: Pick<SoundAssetRepository, 'loadAssets'>;
  audio: OffscreenAudioTransport | null;
}>): CodexBridgeNotificationHandler {
  return {
    async prepare(): Promise<CodexBridgeNotificationPreparation> {
      const loaded = await dependencies.settings.loadSettings();
      if (!loaded.ok) return { state: 'failed', reason: 'settings-unavailable' };
      if (loaded.settings.answerCompletionSoundEnabled !== true) return { state: 'skipped', reason: 'disabled' };
      const volumePercent = loaded.settings.answerCompletionSoundVolumePercent
        ?? DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT;
      if (volumePercent === 0) return { state: 'skipped', reason: 'volume-zero' };

      const output = await dependencies.outputDevice.load();
      if (!output.ok) return { state: 'failed', reason: 'output-device-unavailable' };
      const selectedSoundId = loaded.settings.answerCompletionSoundId ?? DEFAULT_COMPLETION_SOUND_ID;
      let asset: SoundAsset | undefined;
      if (isUserCompletionSoundId(selectedSoundId)) {
        const loadedAssets = await dependencies.assets.loadAssets();
        if (loadedAssets.ok) asset = loadedAssets.assets.find((candidate) => candidate.id === selectedSoundId);
      }
      const soundId = isUserCompletionSoundId(selectedSoundId) && !asset ? DEFAULT_COMPLETION_SOUND_ID : selectedSoundId;
      return {
        state: 'ready',
        play: async () => {
          if (!dependencies.audio) return { ok: false, reason: 'playback-failed' };
          const result = await dependencies.audio.play({
            type: OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND, deviceId: output.device.deviceId,
            soundId, volumePercent, ...(asset && soundId === selectedSoundId ? { asset } : {}),
          });
          return result.ok ? { ok: true } : { ok: false, reason: result.reason ?? 'playback-failed' };
        },
      };
    },
  };
}
