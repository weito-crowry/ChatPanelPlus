import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONFIG_STORAGE_KEY,
  SettingsRepository,
  type StorageAreaLike,
} from '../src/shared/settings-repository.ts';
import { DEFAULT_SETTINGS, type ExtensionSettings } from '../src/shared/settings.ts';

function storage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  const area: StorageAreaLike = {
    async get(keys) {
      return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(items) { Object.assign(data, items); },
  };
  return { area, data };
}

test('Codex専用音設定は保存・競合検出され、ChatGPT側の変更と独立してマージする', async () => {
  const fake = storage();
  const repository = new SettingsRepository(fake.area);
  const dedicated = {
    ...DEFAULT_SETTINGS,
    codexBridgeTerminalSoundEnabled: true,
    codexBridgeTerminalSoundId: 'soft-chime',
    codexBridgeTerminalSoundVolumePercent: 42,
  };
  assert.equal((await repository.saveSettings(DEFAULT_SETTINGS, dedicated)).ok, true);
  const loaded = await repository.loadSettings();
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.settings.codexBridgeTerminalSoundId, 'soft-chime');

  const external = {
    ...loaded.settings, answerCompletionSoundEnabled: true,
    answerCompletionSoundId: 'two-tone', answerCompletionSoundVolumePercent: 81,
  };
  fake.data[CONFIG_STORAGE_KEY] = external;
  const changedCodex = await repository.saveSettings(loaded.settings, {
    ...loaded.settings, codexBridgeTerminalSoundVolumePercent: 23,
  });
  assert.equal(changedCodex.ok, true);
  const after = fake.data[CONFIG_STORAGE_KEY] as ExtensionSettings;
  assert.deepEqual([
    after.answerCompletionSoundEnabled, after.answerCompletionSoundId, after.answerCompletionSoundVolumePercent,
    after.codexBridgeTerminalSoundVolumePercent,
  ], [true, 'two-tone', 81, 23]);

  const base = after;
  fake.data[CONFIG_STORAGE_KEY] = { ...base, codexBridgeTerminalSoundId: 'tone-660' };
  const conflict = await repository.saveSettings(base, { ...base, codexBridgeTerminalSoundId: 'two-tone' });
  assert.deepEqual(conflict, { ok: false, reason: 'conflict', fields: ['codexBridgeTerminalSoundId'] });
});

test('旧回答完了音をCodexへ移行して読み込み、ChatGPT変更後もCodex値を保存する', async () => {
  const legacy = {
    schemaVersion: 1, answerCompletionSoundEnabled: true,
    answerCompletionSoundId: 'soft-chime', answerCompletionSoundVolumePercent: 34,
  };
  const fake = storage({ [CONFIG_STORAGE_KEY]: legacy });
  const repository = new SettingsRepository(fake.area);
  const loaded = await repository.loadSettings();
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.deepEqual([
    loaded.settings.codexBridgeTerminalSoundEnabled,
    loaded.settings.codexBridgeTerminalSoundId,
    loaded.settings.codexBridgeTerminalSoundVolumePercent,
  ], [true, 'soft-chime', 34]);

  const saved = await repository.saveSettings(loaded.settings, {
    ...loaded.settings,
    answerCompletionSoundEnabled: false,
    answerCompletionSoundId: 'tone-660',
    answerCompletionSoundVolumePercent: 90,
  });
  assert.equal(saved.ok, true);
  const stored = fake.data[CONFIG_STORAGE_KEY] as ExtensionSettings;
  assert.deepEqual([
    stored.answerCompletionSoundEnabled, stored.answerCompletionSoundId, stored.answerCompletionSoundVolumePercent,
    stored.codexBridgeTerminalSoundEnabled, stored.codexBridgeTerminalSoundId, stored.codexBridgeTerminalSoundVolumePercent,
  ], [false, 'tone-660', 90, true, 'soft-chime', 34]);
});
