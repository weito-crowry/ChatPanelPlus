import {
  DEFAULT_COMPLETION_SOUND_ID,
  DEFAULT_CODEX_BRIDGE_TERMINAL_SOUND_ID,
} from '../../src/shared/answer-completion-sound-definitions.ts';
import type { ExtensionSettings } from '../../src/shared/settings.ts';
import type { SettingsRepository } from '../../src/shared/settings-repository.ts';

export type PrepareSoundDeletionResult =
  | { readonly ok: true; readonly base: ExtensionSettings; readonly resetSelections: Readonly<{
    answerCompletionSoundId: boolean; codexBridgeTerminalSoundId: boolean;
  }> }
  | { readonly ok: false; readonly reason: 'settings-load-failed' | 'settings-save-failed' };

export async function prepareSoundAssetDeletion(
  repository: SettingsRepository,
  soundId: string,
): Promise<PrepareSoundDeletionResult> {
  const loaded = await repository.loadSettings();
  if (!loaded.ok) return { ok: false, reason: 'settings-load-failed' };
  const resetSelections = {
    answerCompletionSoundId: loaded.settings.answerCompletionSoundId === soundId,
    codexBridgeTerminalSoundId: loaded.settings.codexBridgeTerminalSoundId === soundId,
  };
  if (!resetSelections.answerCompletionSoundId && !resetSelections.codexBridgeTerminalSoundId) {
    return { ok: true, base: loaded.settings, resetSelections };
  }
  const saved = await repository.saveSettings(loaded.settings, {
    ...loaded.settings,
    ...(resetSelections.answerCompletionSoundId ? { answerCompletionSoundId: DEFAULT_COMPLETION_SOUND_ID } : {}),
    ...(resetSelections.codexBridgeTerminalSoundId
      ? { codexBridgeTerminalSoundId: DEFAULT_CODEX_BRIDGE_TERMINAL_SOUND_ID } : {}),
  });
  return saved.ok
    ? { ok: true, base: saved.settings, resetSelections }
    : { ok: false, reason: 'settings-save-failed' };
}
