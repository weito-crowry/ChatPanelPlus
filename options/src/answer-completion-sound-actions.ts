import { DEFAULT_COMPLETION_SOUND_ID } from '../../src/shared/answer-completion-sound-definitions.ts';
import type { ExtensionSettings } from '../../src/shared/settings.ts';
import type { SettingsRepository } from '../../src/shared/settings-repository.ts';

export type PrepareSoundDeletionResult =
  | { readonly ok: true; readonly base: ExtensionSettings; readonly resetSelection: boolean }
  | { readonly ok: false; readonly reason: 'settings-load-failed' | 'settings-save-failed' };

export async function prepareSoundAssetDeletion(
  repository: SettingsRepository,
  soundId: string,
): Promise<PrepareSoundDeletionResult> {
  const loaded = await repository.loadSettings();
  if (!loaded.ok) return { ok: false, reason: 'settings-load-failed' };
  if (loaded.settings.answerCompletionSoundId !== soundId) {
    return { ok: true, base: loaded.settings, resetSelection: false };
  }
  const saved = await repository.saveSettings(loaded.settings, {
    ...loaded.settings,
    answerCompletionSoundId: DEFAULT_COMPLETION_SOUND_ID,
  });
  return saved.ok
    ? { ok: true, base: saved.settings, resetSelection: true }
    : { ok: false, reason: 'settings-save-failed' };
}
