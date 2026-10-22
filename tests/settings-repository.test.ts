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
    buttonOverrides: { 'full-btn': { label: '左', color: '#123456' } },
  });
  assert.deepEqual(locks.names, ['chatPanelPlus.config.write', 'chatPanelPlus.config.write']);
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
