import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CodexWorkModeController,
  type CodexWorkModeControllerState,
} from '../src/content/codex-work-mode-controller.ts';
import type { CodexWorkModeRouteSource } from '../src/content/codex-work-mode-route.ts';
import type {
  CodexWorkModeChange,
  CodexWorkModeReadResult,
  CodexWorkModeRepositoryLike,
} from '../src/shared/codex-work-mode-repository.ts';

function routeSource(initial: string | null): {
  readonly source: CodexWorkModeRouteSource;
  navigate(conversationId: string | null): void;
  changePathWithoutEvent(conversationId: string | null): void;
} {
  let current = initial;
  const listeners = new Set<(conversationId: string | null) => void>();
  return {
    source: {
      currentConversationId() { return current; },
      subscribe(listener) {
        listeners.add(listener);
        listener(current);
        return () => listeners.delete(listener);
      },
    },
    navigate(conversationId) {
      current = conversationId;
      listeners.forEach((listener) => listener(conversationId));
    },
    changePathWithoutEvent(conversationId) { current = conversationId; },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function repository(initial: Record<string, boolean> = {}) {
  const values = new Map(Object.entries(initial));
  const changes = new Set<(change: CodexWorkModeChange) => void>();
  const reads: string[] = [];
  const writes: { conversationId: string; enabled: boolean }[] = [];
  const delayedReads = new Map<string, ReturnType<typeof deferred<CodexWorkModeReadResult>>>();
  let pendingWrite: ReturnType<typeof deferred<void>> | null = null;
  const api: CodexWorkModeRepositoryLike = {
    load(conversationId) {
      reads.push(conversationId);
      const delayed = delayedReads.get(conversationId);
      if (delayed) return delayed.promise;
      return Promise.resolve({ ok: true, value: { schemaVersion: 1, enabled: values.get(conversationId) ?? false }, saved: values.has(conversationId) });
    },
    async setEnabled(conversationId, enabled) {
      writes.push({ conversationId, enabled });
      if (pendingWrite) await pendingWrite.promise;
      values.set(conversationId, enabled);
      const result = { ok: true as const, value: { schemaVersion: 1 as const, enabled } };
      const change: CodexWorkModeChange = {
        conversationId,
        result: { ok: true, value: result.value, saved: true },
      };
      changes.forEach((listener) => listener(change));
      return result;
    },
    subscribe(listener) {
      changes.add(listener);
      return () => changes.delete(listener);
    },
  };
  return {
    api,
    reads,
    writes,
    values,
    delayRead(conversationId: string) {
      const request = deferred<CodexWorkModeReadResult>();
      delayedReads.set(conversationId, request);
      return request;
    },
    delayWrites() {
      pendingWrite = deferred<void>();
      return () => pendingWrite?.resolve();
    },
  };
}

async function flush(): Promise<void> { await new Promise<void>((resolve) => setImmediate(resolve)); }

function latest(states: CodexWorkModeControllerState[]) { return states.at(-1); }

test('unconfirmed new chat is unavailable, and late reads cannot overwrite a navigated conversation', async () => {
  const route = routeSource(null);
  const fake = repository();
  const oldRead = fake.delayRead('conversation-one');
  const controller = new CodexWorkModeController(fake.api, route.source);
  const states: CodexWorkModeControllerState[] = [];
  controller.subscribe((state) => states.push(state));
  controller.start();
  assert.deepEqual(controller.state, { status: 'unavailable' });
  await controller.toggle();
  await controller.initializeOff();
  assert.deepEqual(fake.writes, []);

  route.navigate('conversation-one');
  route.navigate('conversation-two');
  await flush();
  assert.deepEqual(controller.state, { status: 'ready', enabled: false, saving: false });
  oldRead.resolve({ ok: true, value: { schemaVersion: 1, enabled: true }, saved: true });
  await flush();

  assert.deepEqual(latest(states), { status: 'ready', enabled: false, saving: false });
  assert.deepEqual(fake.reads, ['conversation-one', 'conversation-two']);
  controller.dispose();
});

test('a route change detected only by pathname is checked before an old read can publish', async () => {
  const route = routeSource('conversation-one');
  const fake = repository();
  const oldRead = fake.delayRead('conversation-one');
  const controller = new CodexWorkModeController(fake.api, route.source);
  controller.start();

  route.changePathWithoutEvent('conversation-two');
  oldRead.resolve({ ok: true, value: { schemaVersion: 1, enabled: true }, saved: true });
  await flush();

  assert.deepEqual(controller.state, { status: 'ready', enabled: false, saving: false });
  assert.deepEqual(fake.reads, ['conversation-one', 'conversation-two']);
  controller.dispose();
});

test('a conversation restores its own value after same-tab route changes and controller remount', async () => {
  const fake = repository({ 'conversation-one': true });
  const firstRoute = routeSource('conversation-one');
  const first = new CodexWorkModeController(fake.api, firstRoute.source);
  first.start();
  await flush();
  assert.deepEqual(first.state, { status: 'ready', enabled: true, saving: false });
  firstRoute.navigate('conversation-two');
  await flush();
  assert.deepEqual(first.state, { status: 'ready', enabled: false, saving: false });
  firstRoute.navigate('conversation-one');
  await flush();
  assert.deepEqual(first.state, { status: 'ready', enabled: true, saving: false });
  first.dispose();

  const reloaded = new CodexWorkModeController(fake.api, routeSource('conversation-one').source);
  reloaded.start();
  await flush();
  assert.deepEqual(reloaded.state, { status: 'ready', enabled: true, saving: false });
  reloaded.dispose();
  assert.deepEqual(fake.reads, ['conversation-one', 'conversation-two', 'conversation-one', 'conversation-one']);
});

test('a save finishing after navigation stays scoped to its old conversation and rapid clicks write once', async () => {
  const route = routeSource('conversation-one');
  const fake = repository();
  const releaseWrite = fake.delayWrites();
  const controller = new CodexWorkModeController(fake.api, route.source);
  controller.start();
  await flush();

  const saving = controller.toggle();
  await controller.toggle();
  assert.deepEqual(fake.writes, [{ conversationId: 'conversation-one', enabled: true }]);
  route.navigate('conversation-two');
  await flush();
  releaseWrite();
  await saving;

  assert.deepEqual(controller.state, { status: 'ready', enabled: false, saving: false });
  assert.equal(fake.values.get('conversation-one'), true);
  assert.equal(fake.values.get('conversation-two'), undefined);
  controller.dispose();
});

test('invalid data is preserved until explicit OFF initialization, and failed writes stay visible', async () => {
  const route = routeSource('conversation-one');
  const fake = repository();
  let failNext = false;
  const base = fake.api;
  const wrapped: CodexWorkModeRepositoryLike = {
    ...base,
    load: async () => ({ ok: false, reason: 'invalid-data' }),
    async setEnabled(conversationId, enabled) {
      if (failNext) return { ok: false, reason: 'storage-error' };
      return base.setEnabled(conversationId, enabled);
    },
  };
  const controller = new CodexWorkModeController(wrapped, route.source);
  controller.start();
  await flush();
  assert.deepEqual(controller.state, { status: 'unknown', reason: 'invalid-data', saving: false });
  assert.deepEqual(fake.writes, []);
  failNext = true;
  await controller.initializeOff();
  assert.deepEqual(controller.state, { status: 'unknown', reason: 'invalid-data', saving: false, actionFailed: true });
  assert.equal(fake.writes.length, 0);
  controller.dispose();
});

test('unknown data is overwritten with OFF only after an explicit initialization action', async () => {
  const route = routeSource('conversation-one');
  const fake = repository();
  const controller = new CodexWorkModeController({
    ...fake.api,
    async load() { return { ok: false, reason: 'invalid-data' }; },
  }, route.source);
  controller.start();
  await flush();
  assert.deepEqual(controller.state, { status: 'unknown', reason: 'invalid-data', saving: false });
  assert.deepEqual(fake.writes, []);

  await controller.toggle();
  assert.deepEqual(fake.writes, []);
  await controller.initializeOff();
  assert.deepEqual(fake.writes, [{ conversationId: 'conversation-one', enabled: false }]);
  assert.deepEqual(controller.state, { status: 'ready', enabled: false, saving: false });
  controller.dispose();
});
