import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_WORK_MODE_STORAGE_KEY,
  CodexWorkModeRepository,
  type CodexWorkModeChangesLike,
  type CodexWorkModeStorageAreaLike,
} from '../src/shared/codex-work-mode-repository.ts';

function storage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  const listeners = new Set<(changes: Record<string, { readonly oldValue?: unknown; readonly newValue?: unknown }>, areaName: string) => void>();
  let writes = 0;
  let failReads = false;
  let failWrites = false;
  let adds = 0;
  let removes = 0;
  const area: CodexWorkModeStorageAreaLike = {
    async get(key) {
      if (failReads) throw new Error('read failed');
      return key in data ? { [key]: data[key] } : {};
    },
    async set(items) {
      writes += 1;
      if (failWrites) throw new Error('write failed');
      const changes: Record<string, { readonly oldValue?: unknown; readonly newValue?: unknown }> = {};
      for (const [key, value] of Object.entries(items)) {
        data[key] = value;
        changes[key] = { newValue: value };
      }
      listeners.forEach((listener) => listener(changes, 'local'));
    },
  };
  const changeEvent: CodexWorkModeChangesLike = {
    addListener(listener) { adds += 1; listeners.add(listener); },
    removeListener(listener) { removes += 1; listeners.delete(listener); },
  };
  return {
    area,
    changeEvent,
    data,
    emit(changes: Record<string, { readonly oldValue?: unknown; readonly newValue?: unknown }>, areaName = 'local') {
      listeners.forEach((listener) => listener(changes, areaName));
    },
    get writes() { return writes; },
    get adds() { return adds; },
    get removes() { return removes; },
    set failReads(value: boolean) { failReads = value; },
    set failWrites(value: boolean) { failWrites = value; },
  };
}

test('missing Codex work mode storage resolves OFF without writing', async () => {
  const fake = storage({ 'chatPanelPlus.config': { schemaVersion: 1 }, 'chatPanelPlus.statistics': { schemaVersion: 1 } });
  const repository = new CodexWorkModeRepository(fake.area, fake.changeEvent);

  assert.deepEqual(await repository.load(), {
    ok: true,
    value: { schemaVersion: 1, enabled: false },
    saved: false,
  });
  assert.equal(fake.writes, 0);
  assert.deepEqual(fake.data['chatPanelPlus.config'], { schemaVersion: 1 });
  assert.deepEqual(fake.data['chatPanelPlus.statistics'], { schemaVersion: 1 });
});

test('valid mode saves to its dedicated key and is restored by a new repository', async () => {
  const config = { schemaVersion: 1, answerCompletionSoundEnabled: true };
  const viewState = { minimized: true, selectedTabId: 'wall' };
  const statistics = { schemaVersion: 1, conversations: { conversation: { turns: 5 } } };
  const fake = storage({
    'chatPanelPlus.config': config,
    'chatPanelPlus.viewState': viewState,
    'chatPanelPlus.statistics': statistics,
  });
  const repository = new CodexWorkModeRepository(fake.area, fake.changeEvent);

  assert.deepEqual(await repository.setEnabled(true), {
    ok: true,
    value: { schemaVersion: 1, enabled: true },
  });
  assert.deepEqual(fake.data[CODEX_WORK_MODE_STORAGE_KEY], { schemaVersion: 1, enabled: true });
  assert.deepEqual(fake.data['chatPanelPlus.config'], config);
  assert.deepEqual(fake.data['chatPanelPlus.viewState'], viewState);
  assert.deepEqual(fake.data['chatPanelPlus.statistics'], statistics);
  assert.deepEqual(await new CodexWorkModeRepository(fake.area, fake.changeEvent).load(), {
    ok: true,
    value: { schemaVersion: 1, enabled: true },
    saved: true,
  });
});

test('invalid and future schemas are reported without overwriting stored values', async () => {
  for (const invalid of [null, { schemaVersion: 2, enabled: true }, { schemaVersion: 1, enabled: 'true' }]) {
    const fake = storage({ [CODEX_WORK_MODE_STORAGE_KEY]: invalid });
    const result = await new CodexWorkModeRepository(fake.area, fake.changeEvent).load();
    assert.deepEqual(result, { ok: false, reason: 'invalid-data' });
    assert.equal(fake.writes, 0);
    assert.equal(fake.data[CODEX_WORK_MODE_STORAGE_KEY], invalid);
  }
});

test('storage read and write errors are returned without changing the displayed value contract', async () => {
  const fake = storage();
  const repository = new CodexWorkModeRepository(fake.area, fake.changeEvent);
  fake.failReads = true;
  assert.deepEqual(await repository.load(), { ok: false, reason: 'storage-error' });
  fake.failReads = false;
  fake.failWrites = true;
  assert.deepEqual(await repository.setEnabled(true), { ok: false, reason: 'storage-error' });
  assert.equal(CODEX_WORK_MODE_STORAGE_KEY in fake.data, false);
});

test('subscribes only while needed and emits only local changes to the dedicated key', () => {
  const fake = storage();
  const repository = new CodexWorkModeRepository(fake.area, fake.changeEvent);
  const received: unknown[] = [];
  const first = repository.subscribe((result) => received.push(result));
  const second = repository.subscribe((result) => received.push(result));

  assert.equal(fake.adds, 1);
  fake.emit({ 'chatPanelPlus.config': { newValue: { schemaVersion: 1 } } });
  fake.emit({ [CODEX_WORK_MODE_STORAGE_KEY]: { newValue: { schemaVersion: 1, enabled: true } } }, 'sync');
  assert.equal(received.length, 0);
  fake.emit({ [CODEX_WORK_MODE_STORAGE_KEY]: { newValue: { schemaVersion: 1, enabled: true } } });
  assert.deepEqual(received, [
    { ok: true, value: { schemaVersion: 1, enabled: true }, saved: true },
    { ok: true, value: { schemaVersion: 1, enabled: true }, saved: true },
  ]);

  first();
  assert.equal(fake.removes, 0);
  second();
  assert.equal(fake.removes, 1);
});

test('storage removal becomes OFF and invalid external data becomes an error', () => {
  const fake = storage();
  const repository = new CodexWorkModeRepository(fake.area, fake.changeEvent);
  const received: unknown[] = [];
  const unsubscribe = repository.subscribe((result) => received.push(result));

  fake.emit({ [CODEX_WORK_MODE_STORAGE_KEY]: { oldValue: { schemaVersion: 1, enabled: true } } });
  fake.emit({ [CODEX_WORK_MODE_STORAGE_KEY]: { newValue: { schemaVersion: 3, enabled: false } } });
  assert.deepEqual(received, [
    { ok: true, value: { schemaVersion: 1, enabled: false }, saved: false },
    { ok: false, reason: 'invalid-data' },
  ]);
  unsubscribe();
});
