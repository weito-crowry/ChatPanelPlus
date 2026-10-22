import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONFIG_STORAGE_KEY,
  VIEW_STATE_STORAGE_KEY,
  SettingsRepository,
  type StorageAreaLike,
} from '../src/shared/settings-repository.ts';
import { DEFAULT_SETTINGS, type ExtensionSettings } from '../src/shared/settings.ts';

function storage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  let writes = 0;
  let failWrites = false;
  const area: StorageAreaLike = {
    async get(keys) {
      return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(items) {
      writes += 1;
      if (failWrites) throw new Error('quota');
      Object.assign(data, items);
    },
  };
  return {
    area, data,
    get writes() { return writes; },
    set failWrites(value: boolean) { failWrites = value; },
  };
}

function sharedLocks() {
  let tail = Promise.resolve();
  return {
    names: [] as string[],
    request<T>(name: string, callback: () => Promise<T>): Promise<T> {
      this.names.push(name);
      const result = tail.then(callback);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

test('初回はschema 1既定値を返し、設定とview stateを別keyで保存する', async () => {
  const fake = storage();
  const repository = new SettingsRepository(fake.area);
  assert.deepEqual(await repository.loadSettings(), { ok: true, settings: DEFAULT_SETTINGS });
  assert.deepEqual(await repository.saveViewState({ selectedTabId: 'wall', minimized: true }), { ok: true });
  assert.deepEqual(fake.data[VIEW_STATE_STORAGE_KEY], { selectedTabId: 'wall', minimized: true });
  assert.equal(CONFIG_STORAGE_KEY in fake.data, false);
  assert.deepEqual(await repository.loadViewState(), { ok: true, viewState: { selectedTabId: 'wall', minimized: true } });
});

test('レイアウト保存時だけ別keyのview stateを既定値へ戻す', async () => {
  const fake = storage({
    [CONFIG_STORAGE_KEY]: DEFAULT_SETTINGS,
    [VIEW_STATE_STORAGE_KEY]: { selectedTabId: 'wall', minimized: true },
  });
  const repository = new SettingsRepository(fake.area);
  const result = await repository.saveSettings(DEFAULT_SETTINGS, DEFAULT_SETTINGS, {
    resetViewState: { selectedTabId: 'directive', minimized: false },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(fake.data[VIEW_STATE_STORAGE_KEY], { selectedTabId: 'directive', minimized: false });
});

test('破損・未知schemaの保存値を更新で上書きしない', async () => {
  for (const invalid of [{ schemaVersion: 2 }, { schemaVersion: 1, buttonOverrides: [] }]) {
    const fake = storage({ [CONFIG_STORAGE_KEY]: invalid });
    const repository = new SettingsRepository(fake.area);
    assert.equal((await repository.loadSettings()).ok, false);
    assert.equal((await repository.saveSettings(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, tabOrder: ['wall'] })).ok, false);
    assert.equal(fake.writes, 0);
    assert.deepEqual(fake.data[CONFIG_STORAGE_KEY], invalid);
  }
});

test('保存はdirty fieldだけ最新値へ合成し、同一field競合は書かない', async () => {
  const base = DEFAULT_SETTINGS;
  const draft = { ...base, buttonOverrides: { 'full-btn': { label: '変更名' } } };
  const latest = { ...base, futureOptions: { preserved: true }, buttonOverrides: { 'summary-btn': { visible: false } } };
  const fake = storage({ [CONFIG_STORAGE_KEY]: latest });
  const repository = new SettingsRepository(fake.area);
  assert.equal((await repository.saveSettings(base, draft)).ok, true);
  assert.deepEqual(fake.data[CONFIG_STORAGE_KEY], {
    ...base,
    futureOptions: { preserved: true },
    buttonOverrides: { 'summary-btn': { visible: false }, 'full-btn': { label: '変更名' } },
  });

  const conflictBase = fake.data[CONFIG_STORAGE_KEY] as typeof draft;
  const conflictDraft = { ...conflictBase, buttonOverrides: { ...conflictBase.buttonOverrides, 'full-btn': { label: '自分の変更' } } };
  const external = { ...conflictBase, buttonOverrides: { ...conflictBase.buttonOverrides, 'full-btn': { label: '他の変更' } } };
  const conflictFake = storage({ [CONFIG_STORAGE_KEY]: external });
  const conflictRepository = new SettingsRepository(conflictFake.area);
  const result = await conflictRepository.saveSettings(conflictBase, conflictDraft);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'conflict');
  assert.equal(conflictFake.writes, 0);
});

test('既定値への全置換は古いbaseに対するknown-field外部変更を競合拒否して保持する', async () => {
  const external = {
    ...DEFAULT_SETTINGS,
    buttonOverrides: { 'full-btn': { visible: false, color: '#123456' } },
    tabOrder: ['directive', 'wall', 'control', 'binary', 'quad'],
  };
  const fake = storage({ [CONFIG_STORAGE_KEY]: external });
  const repository = new SettingsRepository(fake.area);

  const result = await repository.saveSettings(DEFAULT_SETTINGS, DEFAULT_SETTINGS, { replaceKnownFields: true });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'conflict');
    assert.deepEqual(result.fields, [
      'buttonOverrides.full-btn.visible',
      'buttonOverrides.full-btn.color',
      'tabOrder',
    ]);
  }
  assert.deepEqual(fake.data[CONFIG_STORAGE_KEY], external);
  assert.equal(fake.writes, 0);
});

test('同時の別Options設定はWeb Lockで直列化され、異なるfield変更を両方保持する', async () => {
  const fake = storage();
  const locks = sharedLocks();
  const left = new SettingsRepository(fake.area, undefined, locks);
  const right = new SettingsRepository(fake.area, undefined, locks);
  const leftDraft = { ...DEFAULT_SETTINGS, buttonOverrides: { 'full-btn': { label: '左' } } };
  const rightDraft = { ...DEFAULT_SETTINGS, buttonOverrides: { 'full-btn': { color: '#123456' } } };
  const results = await Promise.all([
    left.saveSettings(DEFAULT_SETTINGS, leftDraft),
    right.saveSettings(DEFAULT_SETTINGS, rightDraft),
  ]);
  assert.equal(results.every(({ ok }) => ok), true);
  assert.deepEqual(fake.data[CONFIG_STORAGE_KEY], {
    schemaVersion: 1,
    answerCompletionSoundVolumePercent: 60,
    buttonOverrides: { 'full-btn': { label: '左', color: '#123456' } },
  });
  assert.deepEqual(locks.names, ['chatPanelPlus.config.write', 'chatPanelPlus.config.write']);
});

test('回答完了音の設定を保存・再読込し、既定値への全置換で無効化できる', async () => {
  const fake = storage();
  const repository = new SettingsRepository(fake.area, undefined, sharedLocks());
  const enabled = { ...DEFAULT_SETTINGS, answerCompletionSoundEnabled: true };

  assert.equal((await repository.saveSettings(DEFAULT_SETTINGS, enabled)).ok, true);
  const loaded = await repository.loadSettings();
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.settings.answerCompletionSoundEnabled, true);

  assert.equal((await repository.saveSettings(loaded.settings, DEFAULT_SETTINGS, { replaceKnownFields: true })).ok, true);
  const reset = await repository.loadSettings();
  assert.equal(reset.ok, true);
  if (reset.ok) {
    assert.equal(reset.settings.answerCompletionSoundEnabled ?? false, false);
    assert.equal(reset.settings.answerCompletionSoundVolumePercent, 60);
  }
});

test('選択音を保存して再読込し、同じ項目の競合は外部値を保持する', async () => {
  const fake = storage();
  const repository = new SettingsRepository(fake.area);
  const selected = { ...DEFAULT_SETTINGS, answerCompletionSoundId: 'soft-chime' };
  assert.equal((await repository.saveSettings(DEFAULT_SETTINGS, selected)).ok, true);
  const loaded = await repository.loadSettings();
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.settings.answerCompletionSoundId, 'soft-chime');

  const external = { ...loaded.settings, answerCompletionSoundId: 'two-tone' };
  fake.data[CONFIG_STORAGE_KEY] = external;
  const conflict = await repository.saveSettings(loaded.settings, { ...loaded.settings, answerCompletionSoundId: 'tone-660' });
  assert.deepEqual(conflict, { ok: false, reason: 'conflict', fields: ['answerCompletionSoundId'] });
  assert.deepEqual(fake.data[CONFIG_STORAGE_KEY], external);
});

test('音量を保存・再読込し、同じ音量fieldの競合は外部値を保持する', async () => {
  const fake = storage();
  const repository = new SettingsRepository(fake.area);
  const selected = { ...DEFAULT_SETTINGS, answerCompletionSoundVolumePercent: 42 };
  assert.equal((await repository.saveSettings(DEFAULT_SETTINGS, selected)).ok, true);
  const loaded = await repository.loadSettings();
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.settings.answerCompletionSoundVolumePercent, 42);

  const external = { ...loaded.settings, answerCompletionSoundVolumePercent: 81 };
  fake.data[CONFIG_STORAGE_KEY] = external;
  const conflict = await repository.saveSettings(loaded.settings, { ...loaded.settings, answerCompletionSoundVolumePercent: 19 });
  assert.deepEqual(conflict, { ok: false, reason: 'conflict', fields: ['answerCompletionSoundVolumePercent'] });
  assert.deepEqual(fake.data[CONFIG_STORAGE_KEY], external);
});

test('同時に同一fieldを異なる値へ変更した場合は一件を競合拒否する', async () => {
  const fake = storage();
  const locks = sharedLocks();
  const left = new SettingsRepository(fake.area, undefined, locks);
  const right = new SettingsRepository(fake.area, undefined, locks);
  const first = { ...DEFAULT_SETTINGS, buttonOverrides: { 'full-btn': { label: '左' } } };
  const second = { ...DEFAULT_SETTINGS, buttonOverrides: { 'full-btn': { label: '右' } } };
  const results = await Promise.all([
    left.saveSettings(DEFAULT_SETTINGS, first),
    right.saveSettings(DEFAULT_SETTINGS, second),
  ]);
  assert.equal(results.filter(({ ok }) => ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.reason === 'conflict').length, 1);
  assert.ok(['左', '右'].includes((fake.data[CONFIG_STORAGE_KEY] as ExtensionSettings).buttonOverrides?.['full-btn']?.label ?? ''));
});

test('Web Locksが使えない場合も逐次保存は最新値へfield単位で合成する', async () => {
  const fake = storage();
  const repository = new SettingsRepository(fake.area);
  const first = { ...DEFAULT_SETTINGS, buttonOverrides: { 'full-btn': { label: '左' } } };
  const second = { ...DEFAULT_SETTINGS, buttonOverrides: { 'full-btn': { color: '#123456' } } };

  assert.equal((await repository.saveSettings(DEFAULT_SETTINGS, first)).ok, true);
  assert.equal((await repository.saveSettings(DEFAULT_SETTINGS, second)).ok, true);
  assert.deepEqual(fake.data[CONFIG_STORAGE_KEY], {
    schemaVersion: 1,
    answerCompletionSoundVolumePercent: 60,
    buttonOverrides: { 'full-btn': { label: '左', color: '#123456' } },
  });
});

test('Web Locksなしの同時read-merge-writeにはCASがなく別field更新を失い得る', async () => {
  const data: Record<string, unknown> = {};
  let reads = 0;
  let releaseReads!: () => void;
  const bothReads = new Promise<void>((resolve) => { releaseReads = resolve; });
  const area: StorageAreaLike = {
    async get(keys) {
      const snapshot = Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]));
      reads += 1;
      if (reads === 2) releaseReads();
      await bothReads;
      return snapshot;
    },
    async set(items) { Object.assign(data, items); },
  };
  const first = new SettingsRepository(area);
  const second = new SettingsRepository(area);
  const left = { ...DEFAULT_SETTINGS, buttonOverrides: { 'full-btn': { label: '左' } } };
  const right = { ...DEFAULT_SETTINGS, buttonOverrides: { 'full-btn': { color: '#123456' } } };

  const results = await Promise.all([
    first.saveSettings(DEFAULT_SETTINGS, left),
    second.saveSettings(DEFAULT_SETTINGS, right),
  ]);
  assert.equal(results.every(({ ok }) => ok), true);
  const stored = data[CONFIG_STORAGE_KEY] as ExtensionSettings;
  const saved = stored.buttonOverrides?.['full-btn'];
  assert.ok(saved?.label === '左' || saved?.color === '#123456');
  assert.equal(saved?.label === '左' && saved?.color === '#123456', false);
});

test('config保存とminimized/view-state保存が重なっても別keyの値を保持する', async () => {
  let releaseRead!: () => void;
  let markReadStarted!: () => void;
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
  const data: Record<string, unknown> = {};
  const area: StorageAreaLike = {
    async get(keys) {
      markReadStarted();
      await readGate;
      return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(items) { Object.assign(data, items); },
  };
  const repository = new SettingsRepository(area);
  const draft = { ...DEFAULT_SETTINGS, tabOrder: ['wall'] };

  const configSave = repository.saveSettings(DEFAULT_SETTINGS, draft);
  await readStarted;
  assert.deepEqual(await repository.saveViewState({ selectedTabId: 'wall', minimized: true }), { ok: true });
  releaseRead();
  assert.equal((await configSave).ok, true);
  assert.deepEqual(data[CONFIG_STORAGE_KEY], { ...DEFAULT_SETTINGS, tabOrder: ['wall', 'directive', 'control', 'binary', 'quad'] });
  assert.deepEqual(data[VIEW_STATE_STORAGE_KEY], { selectedTabId: 'wall', minimized: true });
});

test('resetViewState付きconfig保存と並行view-state保存は同じkeyの後勝ちになる', async () => {
  let releaseRead!: () => void;
  let markReadStarted!: () => void;
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
  const data: Record<string, unknown> = {
    [CONFIG_STORAGE_KEY]: DEFAULT_SETTINGS,
    [VIEW_STATE_STORAGE_KEY]: { selectedTabId: 'wall', minimized: true },
  };
  const area: StorageAreaLike = {
    async get(keys) {
      markReadStarted();
      await readGate;
      return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(items) { Object.assign(data, items); },
  };
  const repository = new SettingsRepository(area);
  const resetSave = repository.saveSettings(DEFAULT_SETTINGS, DEFAULT_SETTINGS, {
    resetViewState: { selectedTabId: 'directive', minimized: false },
  });

  await readStarted;
  assert.deepEqual(await repository.saveViewState({ selectedTabId: 'wall', minimized: true }), { ok: true });
  releaseRead();
  assert.equal((await resetSave).ok, true);
  assert.deepEqual(data[VIEW_STATE_STORAGE_KEY], { selectedTabId: 'directive', minimized: false });
});

test('保存前のstorage read失敗をstorage-failedとして返す', async () => {
  const area: StorageAreaLike = {
    async get() { throw new Error('unavailable'); },
    async set() { assert.fail('read failure must prevent writes'); },
  };
  const repository = new SettingsRepository(area);
  assert.deepEqual(await repository.saveSettings(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, tabOrder: ['wall'] }), {
    ok: false,
    reason: 'storage-failed',
  });
});

test('保存失敗はdraftを保持できる失敗結果を返す', async () => {
  const fake = storage();
  fake.failWrites = true;
  const repository = new SettingsRepository(fake.area);
  const result = await repository.saveSettings(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, tabOrder: ['wall'] });
  assert.deepEqual(result, { ok: false, reason: 'storage-failed' });
});

test('custom buttonの別ID変更を統合し同一IDの変更競合では保存値を保持する', async () => {
  const firstId = 'custom-123e4567-e89b-42d3-a456-426614174010';
  const secondId = 'custom-123e4567-e89b-42d3-a456-426614174011';
  const first = { groupId: 'directive', label: '最初', color: '#123', visible: true, kind: 'insert', text: '本文' } as const;
  const second = { groupId: 'always', label: '二つ目', color: '#456', visible: true, kind: 'action', action: 'clear' } as const;
  const base = { ...DEFAULT_SETTINGS, customButtons: { [firstId]: first, [secondId]: second } };
  const draft = { ...base, customButtons: { ...base.customButtons, [firstId]: { ...first, label: '自分' } } };
  const latest = { ...base, customButtons: { ...base.customButtons, [secondId]: { ...second, label: '他タブ' } } };
  const fake = storage({ [CONFIG_STORAGE_KEY]: latest });
  const repository = new SettingsRepository(fake.area);

  const merged = await repository.saveSettings(base, draft);
  assert.equal(merged.ok, true);
  assert.deepEqual(fake.data[CONFIG_STORAGE_KEY], {
    ...base,
    customButtons: { [firstId]: { ...first, label: '自分' }, [secondId]: { ...second, label: '他タブ' } },
  });

  const persisted = fake.data[CONFIG_STORAGE_KEY] as ExtensionSettings;
  const changedDraft = { ...persisted, customButtons: { ...persisted.customButtons, [firstId]: { ...first, label: '別の自分' } } };
  const external = { ...persisted, customButtons: { ...persisted.customButtons, [firstId]: { ...first, label: '外部変更' } } };
  const conflictFake = storage({ [CONFIG_STORAGE_KEY]: external });
  const conflict = await new SettingsRepository(conflictFake.area).saveSettings(persisted, changedDraft);
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.reason, 'conflict');
  assert.equal(conflictFake.writes, 0);
  assert.deepEqual(conflictFake.data[CONFIG_STORAGE_KEY], external);
});

test('custom button追加衝突、更新中の削除、削除中の更新を検出する', async () => {
  const id = 'custom-123e4567-e89b-42d3-a456-426614174012';
  const definition = { groupId: 'directive', label: '項目', color: '#123', visible: true, kind: 'insert', text: '' } as const;

  const duplicateFake = storage({ [CONFIG_STORAGE_KEY]: { ...DEFAULT_SETTINGS, customButtons: { [id]: definition } } });
  const duplicate = await new SettingsRepository(duplicateFake.area).saveSettings(DEFAULT_SETTINGS, {
    ...DEFAULT_SETTINGS, customButtons: { [id]: definition }, buttonOrder: { directive: [id] },
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.reason, 'conflict');
  assert.equal(duplicateFake.writes, 0);

  const base = { ...DEFAULT_SETTINGS, customButtons: { [id]: definition }, buttonOrder: { directive: [id] } };
  const updateFake = storage({ [CONFIG_STORAGE_KEY]: { ...base, customButtons: {}, buttonOrder: {} } });
  const update = await new SettingsRepository(updateFake.area).saveSettings(base, {
    ...base, customButtons: { [id]: { ...definition, label: '更新' } },
  });
  assert.equal(update.ok, false);
  if (!update.ok) assert.equal(update.reason, 'conflict');
  assert.equal(updateFake.writes, 0);

  const deleteFake = storage({ [CONFIG_STORAGE_KEY]: { ...base, customButtons: { [id]: { ...definition, label: '外部' } } } });
  const deletion = await new SettingsRepository(deleteFake.area).saveSettings(base, { ...DEFAULT_SETTINGS });
  assert.equal(deletion.ok, false);
  if (!deletion.ok) assert.equal(deletion.reason, 'conflict');
  assert.equal(deleteFake.writes, 0);
});

test('custom buttonの同一グループ順序競合は最新順序を保護する', async () => {
  const firstId = 'custom-123e4567-e89b-42d3-a456-426614174013';
  const secondId = 'custom-123e4567-e89b-42d3-a456-426614174014';
  const first = { groupId: 'directive', label: '一', color: '#123', visible: true, kind: 'insert', text: '' } as const;
  const second = { groupId: 'directive', label: '二', color: '#456', visible: true, kind: 'insert', text: '' } as const;
  const base = { ...DEFAULT_SETTINGS, customButtons: { [firstId]: first, [secondId]: second }, buttonOrder: { directive: [firstId, secondId] } };
  const draft = { ...base, buttonOrder: { directive: [secondId, firstId] } };
  const latest = { ...base, buttonOrder: { directive: [secondId, firstId] } };
  const fake = storage({ [CONFIG_STORAGE_KEY]: latest });

  const result = await new SettingsRepository(fake.area).saveSettings(base, draft);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'conflict');
  assert.deepEqual(fake.data[CONFIG_STORAGE_KEY], latest);
  assert.equal(fake.writes, 0);
});

test('ローカルconfig変更だけを通知し、不正値はパネル更新に流さない', () => {
  const handlers: Array<(changes: Record<string, { newValue?: unknown }>, areaName: string) => void> = [];
  const repository = new SettingsRepository(storage().area, {
    addListener(listener) { handlers.push(listener); },
    removeListener(listener) { const index = handlers.indexOf(listener); if (index >= 0) handlers.splice(index, 1); },
  });
  const received: unknown[] = [];
  const receivedView: unknown[] = [];
  const unsubscribe = repository.subscribeSettings((settings) => received.push(settings));
  const unsubscribeView = repository.subscribeViewState((viewState) => receivedView.push(viewState));
  for (const handler of handlers) handler({ [CONFIG_STORAGE_KEY]: { newValue: { schemaVersion: 1, tabOrder: ['wall'] } } }, 'local');
  for (const handler of handlers) handler({ [CONFIG_STORAGE_KEY]: { newValue: { schemaVersion: 2 } } }, 'local');
  for (const handler of handlers) handler({ [CONFIG_STORAGE_KEY]: { newValue: { schemaVersion: 1 } } }, 'sync');
  for (const handler of handlers) handler({ [VIEW_STATE_STORAGE_KEY]: { newValue: { selectedTabId: 'wall', minimized: true } } }, 'local');
  assert.equal(received.length, 1);
  assert.deepEqual(receivedView, [{ selectedTabId: 'wall', minimized: true }]);
  assert.deepEqual(received[0], { schemaVersion: 1, tabOrder: ['wall', 'directive', 'control', 'binary', 'quad'] });
  unsubscribe();
  unsubscribeView();
  assert.equal(handlers.length, 0);
});
