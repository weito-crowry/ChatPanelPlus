import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSoundAssetDeletion } from '../options/src/answer-completion-sound-actions.ts';
import {
  CONFIG_STORAGE_KEY,
  SettingsRepository,
  type StorageAreaLike,
} from '../src/shared/settings-repository.ts';
import { SOUND_ASSETS_STORAGE_KEY } from '../src/shared/answer-completion-sound-assets.ts';
import { DEFAULT_COMPLETION_SOUND_ID } from '../src/shared/answer-completion-sound-definitions.ts';

function settingsStorage(settings: unknown, assets: unknown) {
  const data: Record<string, unknown> = {
    [CONFIG_STORAGE_KEY]: settings,
    [SOUND_ASSETS_STORAGE_KEY]: assets,
  };
  const area: StorageAreaLike = {
    async get(keys) { return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]])); },
    async set(items) { Object.assign(data, items); },
  };
  return { data, repository: new SettingsRepository(area) };
}

test('選択中ユーザー音源の削除前に既定音IDを保存し、別keyの音源データを保持する', async () => {
  const selectedId = 'user-00000000-0000-4000-8000-000000000001';
  const storedAssets = [{ id: selectedId, data: 'AA==' }];
  const fake = settingsStorage({ schemaVersion: 1, answerCompletionSoundEnabled: true, answerCompletionSoundId: selectedId }, storedAssets);

  const result = await prepareSoundAssetDeletion(fake.repository, selectedId);

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.resetSelection, true);
  assert.equal((fake.data[CONFIG_STORAGE_KEY] as Record<string, unknown>).answerCompletionSoundId, DEFAULT_COMPLETION_SOUND_ID);
  assert.deepEqual(fake.data[SOUND_ASSETS_STORAGE_KEY], storedAssets);
});

test('旧JSON相当の既定config更新は独立保存されたユーザー音源を削除しない', async () => {
  const storedAssets = [{ id: 'user-00000000-0000-4000-8000-000000000001', data: 'AA==' }];
  const fake = settingsStorage({ schemaVersion: 1, answerCompletionSoundEnabled: true }, storedAssets);
  const loaded = await fake.repository.loadSettings();
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  await fake.repository.saveSettings(loaded.settings, { schemaVersion: 1, answerCompletionSoundEnabled: false }, { replaceKnownFields: true });
  assert.deepEqual(fake.data[SOUND_ASSETS_STORAGE_KEY], storedAssets);
  assert.equal((fake.data[CONFIG_STORAGE_KEY] as Record<string, unknown>).answerCompletionSoundId, undefined);
});

test('未選択音源はconfigを書き換えず、読込・保存失敗では削除準備を拒否する', async () => {
  const selectedId = 'user-00000000-0000-4000-8000-000000000001';
  const fake = settingsStorage({ schemaVersion: 1, answerCompletionSoundId: 'tone-660' }, []);
  const result = await prepareSoundAssetDeletion(fake.repository, selectedId);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.resetSelection, false);

  const corrupt = settingsStorage({ schemaVersion: 2 }, []);
  assert.deepEqual(await prepareSoundAssetDeletion(corrupt.repository, selectedId), {
    ok: false, reason: 'settings-load-failed',
  });
});
