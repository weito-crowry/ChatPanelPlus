import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexWorkModeController, type CodexWorkModeControllerState } from '../src/content/codex-work-mode-controller.ts';
import {
  CODEX_WORK_MODE_STORAGE_KEY,
  CodexWorkModeRepository,
  type CodexWorkModeChangesLike,
  type CodexWorkModeStorageAreaLike,
} from '../src/shared/codex-work-mode-repository.ts';

function createStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  const listeners = new Set<(changes: Record<string, { readonly oldValue?: unknown; readonly newValue?: unknown }>, areaName: string) => void>();
  let writes = 0;
  let failReads = false;
  let failWrites = false;
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
        changes[key] = { oldValue: data[key], newValue: value };
        data[key] = value;
      }
      listeners.forEach((listener) => listener(changes, 'local'));
    },
  };
  const changeEvent: CodexWorkModeChangesLike = {
    addListener(listener) { listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
  };
  return {
    area,
    changeEvent,
    data,
    emit(changes: Record<string, { readonly oldValue?: unknown; readonly newValue?: unknown }>, areaName = 'local') {
      listeners.forEach((listener) => listener(changes, areaName));
    },
    get listenerCount() { return listeners.size; },
    get writes() { return writes; },
    set failReads(value: boolean) { failReads = value; },
    set failWrites(value: boolean) { failWrites = value; },
  };
}

function createController(fake: ReturnType<typeof createStorage>) {
  return new CodexWorkModeController(new CodexWorkModeRepository(fake.area, fake.changeEvent));
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function latest(states: CodexWorkModeControllerState[]) {
  return states[states.length - 1];
}

test('subscribes before initial load and keeps a newer storage event over the stale read', async () => {
  let releaseRead!: (value: Record<string, unknown>) => void;
  const delayedGet = new Promise<Record<string, unknown>>((resolve) => { releaseRead = resolve; });
  const fake = createStorage();
  const area: CodexWorkModeStorageAreaLike = {
    get: async () => delayedGet,
    set: fake.area.set,
  };
  const controller = new CodexWorkModeController(new CodexWorkModeRepository(area, fake.changeEvent));
  const states: CodexWorkModeControllerState[] = [];
  controller.subscribe((state) => states.push(state));
  controller.start();
  fake.emit({ [CODEX_WORK_MODE_STORAGE_KEY]: { newValue: { schemaVersion: 1, enabled: true } } });
  releaseRead({ [CODEX_WORK_MODE_STORAGE_KEY]: { schemaVersion: 1, enabled: false } });
  await flush();

  assert.deepEqual(latest(states), { status: 'ready', enabled: true, saving: false });
  controller.dispose();
});

test('toggle retains the current value and reports storage write failure', async () => {
  const fake = createStorage();
  const controller = createController(fake);
  const states: CodexWorkModeControllerState[] = [];
  controller.subscribe((state) => states.push(state));
  controller.start();
  await flush();
  fake.failWrites = true;
  await controller.toggle();

  assert.deepEqual(latest(states), { status: 'ready', enabled: false, saving: false, notice: 'write-failed' });
  assert.equal(fake.writes, 1);
  controller.dispose();
});

test('rapid repeat clicks do not start a second write while the first is pending', async () => {
  const fake = createStorage();
  let releaseWrite!: () => void;
  const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
  let writeRequests = 0;
  const delayedArea: CodexWorkModeStorageAreaLike = {
    get: fake.area.get,
    async set(items) {
      writeRequests += 1;
      await writeGate;
      await fake.area.set(items);
    },
  };
  const controller = new CodexWorkModeController(new CodexWorkModeRepository(delayedArea, fake.changeEvent));
  controller.start();
  await flush();

  const first = controller.toggle();
  await controller.toggle();
  assert.equal(writeRequests, 1);
  assert.deepEqual(controller.state, { status: 'ready', enabled: false, saving: true });
  releaseWrite();
  await first;
  assert.deepEqual(controller.state, { status: 'ready', enabled: true, saving: false });
  controller.dispose();
});

test('multiple controllers reflect local storage changes and clean up listeners on dispose', async () => {
  const fake = createStorage();
  const left = createController(fake);
  const right = createController(fake);
  const leftStates: CodexWorkModeControllerState[] = [];
  const rightStates: CodexWorkModeControllerState[] = [];
  left.subscribe((state) => leftStates.push(state));
  right.subscribe((state) => rightStates.push(state));
  left.start();
  right.start();
  await flush();

  await left.toggle();
  assert.deepEqual(latest(leftStates), { status: 'ready', enabled: true, saving: false });
  assert.deepEqual(latest(rightStates), { status: 'ready', enabled: true, saving: false });
  left.dispose();
  right.dispose();
  assert.equal(fake.listenerCount, 0);
});

test('unknown data can be retried or explicitly initialized OFF without an automatic write', async () => {
  const original = { schemaVersion: 9, enabled: true };
  const fake = createStorage({ [CODEX_WORK_MODE_STORAGE_KEY]: original });
  const controller = createController(fake);
  const states: CodexWorkModeControllerState[] = [];
  controller.subscribe((state) => states.push(state));
  controller.start();
  await flush();

  assert.deepEqual(latest(states), { status: 'unknown', reason: 'invalid-data', saving: false });
  assert.equal(fake.writes, 0);
  await controller.retry();
  assert.deepEqual(latest(states), { status: 'unknown', reason: 'invalid-data', saving: false });
  assert.equal(fake.writes, 0);
  await controller.initializeOff();
  assert.deepEqual(fake.data[CODEX_WORK_MODE_STORAGE_KEY], { schemaVersion: 1, enabled: false });
  assert.deepEqual(latest(states), { status: 'ready', enabled: false, saving: false });
  controller.dispose();
});

test('storage read error can be retried without writing an OFF value', async () => {
  const fake = createStorage();
  fake.failReads = true;
  const controller = createController(fake);
  controller.start();
  await flush();
  assert.deepEqual(controller.state, { status: 'unknown', reason: 'storage-error', saving: false });
  fake.failReads = false;
  await controller.retry();
  assert.deepEqual(controller.state, { status: 'ready', enabled: false, saving: false });
  assert.equal(fake.writes, 0);
  controller.dispose();
});
