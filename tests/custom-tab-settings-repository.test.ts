import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONFIG_STORAGE_KEY,
  VIEW_STATE_STORAGE_KEY,
  SettingsRepository,
  type StorageAreaLike,
} from '../src/shared/settings-repository.ts';
import { DEFAULT_SETTINGS, type ExtensionSettings } from '../src/shared/settings.ts';
import { CUSTOM_TAB_ID, customTabSettings } from './fixtures/custom-tabs.ts';

function storage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  let writes = 0;
  const area: StorageAreaLike = {
    async get(keys) { return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]])); },
    async set(items) { writes += 1; Object.assign(data, items); },
  };
  return { area, data, get writes() { return writes; } };
}

test('custom tab読込はread-onlyで、view stateはvalid custom IDを受け入れる', async () => {
  const fake = storage({
    [CONFIG_STORAGE_KEY]: customTabSettings(),
    [VIEW_STATE_STORAGE_KEY]: { selectedTabId: CUSTOM_TAB_ID, minimized: false },
  });
  const repository = new SettingsRepository(fake.area);
  assert.equal((await repository.loadSettings()).ok, true);
  assert.equal(fake.writes, 0);
  assert.deepEqual(await repository.loadViewState(), {
    ok: true, viewState: { selectedTabId: CUSTOM_TAB_ID, minimized: false },
  });
  assert.deepEqual(await repository.saveViewState({ selectedTabId: CUSTOM_TAB_ID, minimized: true }), { ok: true });
});

test('malformed custom view-state IDは拒否し、保存値を変更しない', async () => {
  const invalid = { selectedTabId: 'custom-tab-not-a-uuid', minimized: false };
  const fake = storage({ [VIEW_STATE_STORAGE_KEY]: invalid });
  const repository = new SettingsRepository(fake.area);
  assert.deepEqual(await repository.loadViewState(), { ok: false, reason: 'corrupt-view-state' });
  assert.deepEqual(await repository.saveViewState(invalid as never), { ok: false, reason: 'invalid-view-state' });
  assert.equal(fake.writes, 0);
  assert.deepEqual(fake.data[VIEW_STATE_STORAGE_KEY], invalid);
});

test('custom tab単位の変更とcustom group順序は競合し、別fieldはmergeする', async () => {
  const base = customTabSettings();
  const changedTab = {
    ...base,
    customTabs: { ...base.customTabs, [CUSTOM_TAB_ID]: { ...base.customTabs![CUSTOM_TAB_ID]!, label: 'Draft tab' } },
  };
  const latestTab = {
    ...base,
    customTabs: { ...base.customTabs, [CUSTOM_TAB_ID]: { ...base.customTabs![CUSTOM_TAB_ID]!, label: 'Other tab' } },
  };
  const conflictFake = storage({ [CONFIG_STORAGE_KEY]: latestTab });
  assert.deepEqual(await new SettingsRepository(conflictFake.area).saveSettings(base, changedTab), {
    ok: false, reason: 'conflict', fields: [`customTabs.${CUSTOM_TAB_ID}`],
  });
  assert.equal(conflictFake.writes, 0);

  const standardLatest = { ...base, codexBridgeMcpUrl: 'https://example.invalid/mcp' };
  const standardFake = storage({ [CONFIG_STORAGE_KEY]: standardLatest });
  assert.equal((await new SettingsRepository(standardFake.area).saveSettings(base, changedTab)).ok, true);
  const merged = standardFake.data[CONFIG_STORAGE_KEY] as ExtensionSettings;
  assert.equal(merged.codexBridgeMcpUrl, standardLatest.codexBridgeMcpUrl);
  assert.deepEqual(merged.customTabs?.[CUSTOM_TAB_ID], changedTab.customTabs?.[CUSTOM_TAB_ID]);

  const changedOrder = { ...base, buttonOrder: { ...base.buttonOrder, [CUSTOM_TAB_ID]: [...base.buttonOrder![CUSTOM_TAB_ID]!].reverse() } };
  const orderFake = storage({ [CONFIG_STORAGE_KEY]: changedOrder });
  const orderConflict = await new SettingsRepository(orderFake.area).saveSettings(base, changedOrder);
  assert.equal(orderConflict.ok, false);
  if (!orderConflict.ok) assert.deepEqual(orderConflict.fields, [`buttonOrder.${CUSTOM_TAB_ID}`]);
  assert.equal(orderFake.writes, 0);
});

test('known-field replaceはcustom tab・buttons・orderを残す', async () => {
  const settings = customTabSettings();
  const fake = storage({ [CONFIG_STORAGE_KEY]: settings });
  assert.equal((await new SettingsRepository(fake.area).saveSettings(settings, settings, { replaceKnownFields: true })).ok, true);
  const stored = fake.data[CONFIG_STORAGE_KEY] as ExtensionSettings;
  assert.deepEqual(stored.customTabs, settings.customTabs);
  assert.deepEqual(stored.customButtons, settings.customButtons);
  assert.deepEqual(stored.buttonOrder?.[CUSTOM_TAB_ID], settings.buttonOrder?.[CUSTOM_TAB_ID]);
  assert.ok(stored.tabOrder?.includes(CUSTOM_TAB_ID));
  assert.equal(stored.tabOverrides?.[CUSTOM_TAB_ID]?.futureFlag, true);
});

test('sound・MCP URLだけの更新も既存custom tabデータと順序を保持する', async () => {
  const base = customTabSettings();
  const fake = storage({ [CONFIG_STORAGE_KEY]: base });
  const draft = { ...base, answerCompletionSoundEnabled: true, codexBridgeMcpUrl: 'https://example.invalid/mcp' };
  assert.equal((await new SettingsRepository(fake.area).saveSettings(base, draft)).ok, true);
  const stored = fake.data[CONFIG_STORAGE_KEY] as ExtensionSettings;
  assert.deepEqual(stored.customTabs, base.customTabs);
  assert.deepEqual(stored.customButtons, base.customButtons);
  assert.deepEqual(stored.buttonOrder?.[CUSTOM_TAB_ID], base.buttonOrder?.[CUSTOM_TAB_ID]);
  assert.equal(stored.answerCompletionSoundEnabled, true);
  assert.equal(stored.codexBridgeMcpUrl, draft.codexBridgeMcpUrl);
});

test('stale writerによるcustom tab削除は後からの更新と競合する', async () => {
  const base = customTabSettings();
  const latest = {
    ...base,
    customTabs: { ...base.customTabs, [CUSTOM_TAB_ID]: { ...base.customTabs![CUSTOM_TAB_ID]!, label: 'Changed elsewhere' } },
  };
  const fake = storage({ [CONFIG_STORAGE_KEY]: latest });
  const result = await new SettingsRepository(fake.area).saveSettings(base, DEFAULT_SETTINGS);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'conflict');
    assert.ok(result.fields?.includes(`customTabs.${CUSTOM_TAB_ID}`));
  }
  assert.equal(fake.writes, 0);
  assert.deepEqual(fake.data[CONFIG_STORAGE_KEY], latest);
});
