import assert from 'node:assert/strict';
import test from 'node:test';
import { moveButtonGroup } from '../options/src/options-state.ts';
import { CONFIG_STORAGE_KEY, SettingsRepository } from '../src/shared/settings-repository.ts';
import { DEFAULT_SETTINGS, validateExtensionSettings, type ExtensionSettings } from '../src/shared/settings.ts';

test('順序省略の有効設定でも移動先タブの外部削除を保存競合として返す', async () => {
  const id = 'custom-tab-123e4567-e89b-42d3-a456-426614174000';
  const base = { ...DEFAULT_SETTINGS, customTabs: { [id]: { label: '移動先', visible: true } } };
  const draft = moveButtonGroup(base, 'full-btn', id);
  assert.equal(validateExtensionSettings(base).ok, true);
  assert.equal(validateExtensionSettings(draft).ok, true);
  let writes = 0;
  const repository = new SettingsRepository({
    async get() { return { [CONFIG_STORAGE_KEY]: DEFAULT_SETTINGS }; },
    async set() { writes += 1; },
  });
  assert.deepEqual(await repository.saveSettings(base, draft), {
    ok: false, reason: 'conflict', fields: [`customTabs.${id}`],
  });
  assert.equal(writes, 0);
});

test('別々の追加タブの編集は最新設定へ合成する', async () => {
  const first = 'custom-tab-123e4567-e89b-42d3-a456-426614174000';
  const second = 'custom-tab-123e4567-e89b-42d3-a456-426614174001';
  const base = { ...DEFAULT_SETTINGS, customTabs: {
    [first]: { label: '一', visible: true }, [second]: { label: '二', visible: true },
  } };
  let stored: ExtensionSettings = { ...base, customTabs: { ...base.customTabs, [second]: { label: '二の外部変更', visible: false } } };
  const repository = new SettingsRepository({
    async get() { return { [CONFIG_STORAGE_KEY]: stored }; },
    async set(items) { stored = items[CONFIG_STORAGE_KEY] as ExtensionSettings; },
  });
  const result = await repository.saveSettings(base, {
    ...base, customTabs: { ...base.customTabs, [first]: { label: '一の変更', visible: true } },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(stored.customTabs, {
    [first]: { label: '一の変更', visible: true }, [second]: { label: '二の外部変更', visible: false },
  });
});

test('削除対象タブへ外部からボタンが追加された場合も競合として保存しない', async () => {
  const id = 'custom-tab-123e4567-e89b-42d3-a456-426614174000';
  const buttonId = 'custom-123e4567-e89b-42d3-a456-426614174010';
  const base = { ...DEFAULT_SETTINGS, customTabs: { [id]: { label: '削除対象', visible: true } } };
  const latest = { ...base, customButtons: {
    [buttonId]: { groupId: id, label: '外部追加', color: '#123', visible: true, kind: 'insert', text: '消さない' },
  } };
  let writes = 0;
  const repository = new SettingsRepository({
    async get() { return { [CONFIG_STORAGE_KEY]: latest }; },
    async set() { writes += 1; },
  });
  assert.deepEqual(await repository.saveSettings(base, DEFAULT_SETTINGS), {
    ok: false, reason: 'conflict', fields: [`customTabs.${id}`],
  });
  assert.equal(writes, 0);
});
