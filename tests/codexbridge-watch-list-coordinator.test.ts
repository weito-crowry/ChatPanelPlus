import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCodexBridgeWatchListResponse } from '../src/content/codexbridge-watch-response.ts';
import {
  sendWatchListRequestWithTimeout,
  WatchListRequestCoordinator,
} from '../src/content/codexbridge-watch-list-coordinator.ts';

function fakeTimers() {
  let nextId = 0;
  const tasks = new Map<number, () => void>();
  return {
    timers: {
      setTimeout(callback: () => void) { const id = ++nextId; tasks.set(id, callback); return id; },
      clearTimeout(id: unknown) { tasks.delete(id as number); },
    },
    fire() { const callback = tasks.values().next().value as (() => void) | undefined; if (callback) callback(); },
    get pending() { return tasks.size; },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test('初回LIST中のforeground/storage更新は初回要求を追い越さない', () => {
  const coordinator = new WatchListRequestCoordinator();
  coordinator.setRoute('conversation-A');
  const initial = coordinator.begin('conversation-A', 'initial');
  assert.ok(initial);
  assert.equal(coordinator.begin('conversation-A', 'foreground'), null);
  assert.equal(coordinator.begin('conversation-A', 'storage'), null);
  assert.equal(coordinator.isCurrent(initial), true);
  assert.equal(coordinator.finish(initial, true), true);
});

test('初回LISTが始まる前に始まった自動要求は初回要求へ置き換わる', () => {
  const coordinator = new WatchListRequestCoordinator();
  const foreground = coordinator.begin('conversation-A', 'foreground');
  assert.ok(foreground);
  const initial = coordinator.begin('conversation-A', 'initial');
  assert.ok(initial);
  assert.equal(coordinator.isCurrent(foreground), false);
  assert.equal(coordinator.isCurrent(initial), true);
  assert.equal(coordinator.finish(foreground, false), false);
  assert.equal(coordinator.finish(initial, true), true);
});

test('foreground要求は1件だけ進行し、失敗後は15秒pollを止め、成功した手動再試行で再開する', () => {
  const coordinator = new WatchListRequestCoordinator();
  const foreground = coordinator.begin('conversation-A', 'foreground');
  assert.ok(foreground);
  for (let i = 0; i < 8; i += 1) assert.equal(coordinator.begin('conversation-A', 'foreground'), null);
  assert.equal(coordinator.finish(foreground, false), true);
  assert.equal(coordinator.begin('conversation-A', 'foreground'), null);

  const retry = coordinator.begin('conversation-A', 'manual');
  assert.ok(retry);
  assert.equal(coordinator.isCurrent(foreground), false);
  assert.equal(coordinator.finish(retry, true), true);
  assert.ok(coordinator.begin('conversation-A', 'foreground'));
});

test('新しい明示再試行は遅延中の旧要求を無効化し、古い失敗は状態を変更しない', () => {
  const coordinator = new WatchListRequestCoordinator();
  const first = coordinator.begin('conversation-A', 'initial');
  assert.ok(first);
  const retry = coordinator.begin('conversation-A', 'manual');
  assert.ok(retry);
  assert.equal(coordinator.isCurrent(first), false);
  assert.equal(coordinator.finish(first, false), false);
  assert.equal(coordinator.isCurrent(retry), true);
  assert.equal(coordinator.finish(retry, true), true);
});

test('SPA route切替で旧会話の遅延応答は現在要求として採用されない', () => {
  const coordinator = new WatchListRequestCoordinator();
  const oldRequest = coordinator.begin('conversation-A', 'initial');
  assert.ok(oldRequest);
  coordinator.setRoute('conversation-B');
  const newRequest = coordinator.begin('conversation-B', 'initial');
  assert.ok(newRequest);
  assert.equal(coordinator.isCurrent(oldRequest), false);
  assert.equal(coordinator.isCurrent(newRequest), true);
});

test('timeoutはUI要求を解放し、遅い応答や拒否を未処理Promiseにしない', async () => {
  const timer = fakeTimers();
  const old = deferred<string>();
  const pending = sendWatchListRequestWithTimeout(() => old.promise, 25, timer.timers);
  await Promise.resolve();
  assert.equal(timer.pending, 1);
  timer.fire();
  assert.deepEqual(await pending, { kind: 'timeout' });
  assert.equal(timer.pending, 0);
  old.reject(new Error('late rejection'));
  await Promise.resolve();

  const rejected = await sendWatchListRequestWithTimeout(() => Promise.reject(new Error('send failed')), 25, timer.timers);
  assert.deepEqual(rejected, { kind: 'send-error' });
  assert.equal(timer.pending, 0);
});

test('timeout後に再試行が成功すれば正常応答へ戻り、真正な空一覧だけが0件になる', async () => {
  const coordinator = new WatchListRequestCoordinator();
  coordinator.setRoute('conversation-A');
  const timer = fakeTimers();
  const first = coordinator.begin('conversation-A', 'initial');
  assert.ok(first);
  const never = deferred<unknown>();
  const timedOut = sendWatchListRequestWithTimeout(() => never.promise, 25, timer.timers);
  await Promise.resolve(); timer.fire();
  assert.deepEqual(await timedOut, { kind: 'timeout' });
  coordinator.finish(first, false);

  const retry = coordinator.begin('conversation-A', 'manual');
  assert.ok(retry);
  const response = await sendWatchListRequestWithTimeout(() => Promise.resolve({
    ok: true, data: { items: [], events: [], currentConnectionId: 'connection-A',
      summary: { watchingCount: 0, unacknowledgedThreadCount: 0 } },
  }), 25, timer.timers);
  assert.equal(response.kind, 'response');
  if (response.kind !== 'response') return;
  const parsed = parseCodexBridgeWatchListResponse(response.response);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.data.summary, { watchingCount: 0, unacknowledgedThreadCount: 0 });
  coordinator.finish(retry, true);
  never.resolve({ ok: true, data: { items: [], events: [], currentConnectionId: null,
    summary: { watchingCount: 0, unacknowledgedThreadCount: 0 } } });
});

test('sender拒否・保存失敗・不正応答は成功した空一覧と区別する', () => {
  assert.deepEqual(parseCodexBridgeWatchListResponse({ ok: false, reason: 'invalid-request' }),
    { ok: false, reason: 'sender-unverified' });
  assert.deepEqual(parseCodexBridgeWatchListResponse({ ok: false, reason: 'storage-error' }),
    { ok: false, reason: 'storage-error' });
  assert.deepEqual(parseCodexBridgeWatchListResponse(null), { ok: false, reason: 'invalid-response' });
});
