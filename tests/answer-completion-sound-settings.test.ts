import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSoundAssetDeletion } from '../options/src/answer-completion-sound-actions.ts';
import {
  CONFIG_STORAGE_KEY,
  SettingsRepository,
  type StorageAreaLike,
} from '../src/shared/settings-repository.ts';
import { SOUND_ASSETS_STORAGE_KEY } from '../src/shared/answer-completion-sound-assets.ts';
import {
  DEFAULT_COMPLETION_SOUND_ID,
  DEFAULT_CODEX_BRIDGE_TERMINAL_SOUND_ID,
} from '../src/shared/answer-completion-sound-definitions.ts';

function settingsStorage(settings: unknown, assets: unknown, failWrites = false) {
  const data: Record<string, unknown> = {
    [CONFIG_STORAGE_KEY]: settings,
    [SOUND_ASSETS_STORAGE_KEY]: assets,
  };
  const area: StorageAreaLike = {
    async get(keys) { return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]])); },
    async set(items) { if (failWrites) throw new Error('storage write failed'); Object.assign(data, items); },
  };
  return { data, repository: new SettingsRepository(area) };
}

test('選択中ユーザー音源の削除前に既定音IDを保存し、別keyの音源データを保持する', async () => {
  const selectedId = 'user-00000000-0000-4000-8000-000000000001';
  const storedAssets = [{ id: selectedId, data: 'AA==' }];
  const fake = settingsStorage({ schemaVersion: 1, answerCompletionSoundEnabled: true, answerCompletionSoundId: selectedId }, storedAssets);

  const result = await prepareSoundAssetDeletion(fake.repository, selectedId);

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.resetSelections, { answerCompletionSoundId: true, codexBridgeTerminalSoundId: true });
  assert.equal((fake.data[CONFIG_STORAGE_KEY] as Record<string, unknown>).answerCompletionSoundId, DEFAULT_COMPLETION_SOUND_ID);
  assert.equal((fake.data[CONFIG_STORAGE_KEY] as Record<string, unknown>).codexBridgeTerminalSoundId, DEFAULT_CODEX_BRIDGE_TERMINAL_SOUND_ID);
  assert.deepEqual(fake.data[SOUND_ASSETS_STORAGE_KEY], storedAssets);
});

test('共有カスタム音源を両通知が選択中なら両設定だけ既定音へ保存する', async () => {
  const selectedId = 'user-00000000-0000-4000-8000-000000000001';
  const fake = settingsStorage({
    schemaVersion: 1, answerCompletionSoundId: selectedId,
    codexBridgeTerminalSoundId: selectedId, codexBridgeTerminalSoundEnabled: true,
  }, []);
  const result = await prepareSoundAssetDeletion(fake.repository, selectedId);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.resetSelections, { answerCompletionSoundId: true, codexBridgeTerminalSoundId: true });
    assert.equal(result.base.answerCompletionSoundId, DEFAULT_COMPLETION_SOUND_ID);
    assert.equal(result.base.codexBridgeTerminalSoundId, DEFAULT_CODEX_BRIDGE_TERMINAL_SOUND_ID);
  }
  assert.equal((fake.data[CONFIG_STORAGE_KEY] as Record<string, unknown>).answerCompletionSoundId, DEFAULT_COMPLETION_SOUND_ID);
  assert.equal((fake.data[CONFIG_STORAGE_KEY] as Record<string, unknown>).codexBridgeTerminalSoundId, DEFAULT_CODEX_BRIDGE_TERMINAL_SOUND_ID);
});

test('保存済み片側参照だけを更新し、draft側の別選択は保持できる結果を返す', async () => {
  const selectedId = 'user-00000000-0000-4000-8000-000000000001';
  const fake = settingsStorage({
    schemaVersion: 1, answerCompletionSoundId: 'tone-660',
    codexBridgeTerminalSoundId: selectedId,
  }, []);
  const result = await prepareSoundAssetDeletion(fake.repository, selectedId);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.resetSelections, { answerCompletionSoundId: false, codexBridgeTerminalSoundId: true });
    assert.equal(result.base.answerCompletionSoundId, 'tone-660');
    assert.equal(result.base.codexBridgeTerminalSoundId, DEFAULT_CODEX_BRIDGE_TERMINAL_SOUND_ID);
  }
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
  if (result.ok) assert.deepEqual(result.resetSelections, { answerCompletionSoundId: false, codexBridgeTerminalSoundId: false });

  const corrupt = settingsStorage({ schemaVersion: 2 }, []);
  assert.deepEqual(await prepareSoundAssetDeletion(corrupt.repository, selectedId), {
    ok: false, reason: 'settings-load-failed',
  });
});

test('設定保存失敗や競合ではカスタム音源の削除準備を拒否する', async () => {
  const selectedId = 'user-00000000-0000-4000-8000-000000000001';
  const legacy = { schemaVersion: 1, answerCompletionSoundId: selectedId };
  const failedWrite = settingsStorage(legacy, [{ id: selectedId }], true);
  assert.deepEqual(await prepareSoundAssetDeletion(failedWrite.repository, selectedId), {
    ok: false, reason: 'settings-save-failed',
  });
  assert.deepEqual(failedWrite.data[CONFIG_STORAGE_KEY], legacy);
  assert.deepEqual(failedWrite.data[SOUND_ASSETS_STORAGE_KEY], [{ id: selectedId }]);

  const latest = { schemaVersion: 1, answerCompletionSoundId: 'soft-chime' };
  let reads = 0;
  let writes = 0;
  const area: StorageAreaLike = {
    async get(keys) {
      reads += 1;
      const value = reads === 1 ? legacy : latest;
      return Object.fromEntries(keys.filter((key) => key === CONFIG_STORAGE_KEY).map((key) => [key, value]));
    },
    async set() { writes += 1; },
  };
  const conflict = await prepareSoundAssetDeletion(new SettingsRepository(area), selectedId);
  assert.deepEqual(conflict, { ok: false, reason: 'settings-save-failed' });
  assert.equal(writes, 0);
});
