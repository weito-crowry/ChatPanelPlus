import assert from 'node:assert/strict';
import test from 'node:test';
import { McpTransportError } from '../src/background/mcp-transport.ts';
import { CodexBridgeReadService, type CodexBridgeReadClient } from '../src/background/codexbridge-read-service.ts';
import type { CodexBridgeThreadPage, CodexBridgeThreadStatus } from '../src/shared/codexbridge-mcp-protocol.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';

function page(title: string): CodexBridgeThreadPage {
  return { threads: title ? [{ targetId: 'target', id: title, title, preview: null, cwd: null, updatedAt: null,
    currentExecution: null, lastTurn: null, needsAttention: null }] : [], nextCursor: null };
}

function status(threadId: string): CodexBridgeThreadStatus {
  return { targetId: 'target', threadId, state: 'running', currentExecution: null, lastTurn: null, needsAttention: null };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(options: {
  clientFactory?: (endpoint: string, token: string) => CodexBridgeReadClient;
  maxConcurrentReads?: number;
  maxQueuedReads?: number;
} = {}) {
  let token = 'token-a';
  let endpoint = 'http://127.0.0.1:18000/mcp';
  let now = 1_800_000_000_000;
  let permitted = true;
  let clientCount = 0;
  const service = new CodexBridgeReadService({
    sessionStorage: { async get() { return { 'chatPanelPlus.codexBridgeMcpToken': token }; } },
    permissions: { async contains() { return permitted; } },
    settings: { async loadSettings() { return { ok: true as const, settings: { ...DEFAULT_SETTINGS, codexBridgeMcpUrl: endpoint } }; } },
    connectionIdFactory: async (url) => `connection:${url}`,
    now: () => now,
    maxConcurrentReads: options.maxConcurrentReads,
    maxQueuedReads: options.maxQueuedReads,
    clientFactory: (url, secret) => {
      clientCount += 1;
      return options.clientFactory?.(url, secret) ?? {
        async readTargets() { return []; },
        async readThreads(targetId, cursor, runningOnly) {
          if (runningOnly) return page(`${targetId}-${clientCount}`);
          return { ...page(`${targetId}-${cursor ?? 'first'}`), nextCursor: cursor ? null : 'next' };
        },
        async readStatus(_targetId, threadId) { return status(threadId); },
        async readFinalAnswer() { return { status: 'unavailable', reason: 'no_confirmed_final_answer' }; },
      };
    },
  });
  return {
    service,
    get clientCount() { return clientCount; },
    set token(value: string) { token = value; },
    set endpoint(value: string) { endpoint = value; },
    set permitted(value: boolean) { permitted = value; },
    advance(milliseconds: number) { now += milliseconds; },
  };
}

test('同一generation/targetの同時running_only要求はsingle-flightし、fresh TTL内で共有する', async () => {
  let calls = 0;
  const started = deferred<void>();
  const release = deferred<CodexBridgeThreadPage>();
  const h = harness({ clientFactory: () => ({
    async readTargets() { return []; },
    async readThreads() { calls += 1; started.resolve(); return release.promise; },
    async readStatus(_targetId, threadId) { return status(threadId); },
    async readFinalAnswer() { return { status: 'unavailable', reason: 'no_confirmed_final_answer' }; },
  }) });
  const first = h.service.readRunningSnapshot('target', { priority: 'foreground' });
  await started.promise;
  const second = h.service.readRunningSnapshot('target', { priority: 'foreground' });
  release.resolve(page('live'));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(calls, 1);
  h.advance(4_999);
  assert.equal((await h.service.readRunningSnapshot('target', { priority: 'foreground' })).ok, true);
  assert.equal(calls, 1);
});

test('target別cache、5秒/30秒TTL、手動forceは独立して動く', async () => {
  let calls = 0;
  const h = harness({ clientFactory: () => ({
    async readTargets() { return []; },
    async readThreads(targetId, _cursor, runningOnly) { calls += 1; return page(`${targetId}-${runningOnly}-${calls}`); },
    async readStatus(_targetId, threadId) { return status(threadId); },
    async readFinalAnswer() { return { status: 'unavailable', reason: 'no_confirmed_final_answer' }; },
  }) });
  await h.service.readRunningSnapshot('target-a', { priority: 'foreground' });
  await h.service.readRunningSnapshot('target-b', { priority: 'foreground' });
  assert.equal(calls, 2);
  h.advance(10_000);
  await h.service.readRunningSnapshot('target-a', { priority: 'background' });
  assert.equal(calls, 2);
  await h.service.readRunningSnapshot('target-a', { priority: 'foreground' });
  assert.equal(calls, 3);
  await h.service.readRunningSnapshot('target-a', { priority: 'manual', force: true });
  assert.equal(calls, 4);
});

test('failed refresh exposes stale data and backoff; manual refresh may retry', async () => {
  let calls = 0;
  let fail = false;
  const h = harness({ clientFactory: () => ({
    async readTargets() { return []; },
    async readThreads(_targetId, _cursor, runningOnly) {
      assert.equal(runningOnly, true);
      calls += 1;
      if (fail) throw new McpTransportError('timeout');
      return page('last-good');
    },
    async readStatus(_targetId, threadId) { return status(threadId); },
    async readFinalAnswer() { return { status: 'unavailable', reason: 'no_confirmed_final_answer' }; },
  }) });
  const first = await h.service.readRunningSnapshot('target', { priority: 'foreground' });
  assert.equal(first.ok, true);
  fail = true;
  h.advance(5_001);
  const stale = await h.service.readRunningSnapshot('target', { priority: 'foreground' });
  assert.equal(stale.ok, true);
  if (!stale.ok) return;
  assert.equal(stale.freshness, 'stale');
  assert.equal(stale.failureReason, 'timeout');
  assert.equal(stale.page.threads[0]?.id, 'last-good');
  await h.service.readRunningSnapshot('target', { priority: 'foreground' });
  assert.equal(calls, 2);
  fail = false;
  const forced = await h.service.readRunningSnapshot('target', { priority: 'manual', force: true });
  assert.equal(forced.ok, true);
  assert.equal(calls, 3);
});

test('認証generation切替後に遅れて完了した旧応答は返さずcacheへも残さない', async () => {
  const oldStarted = deferred<void>();
  const oldRelease = deferred<CodexBridgeThreadPage>();
  let calls = 0;
  const h = harness({ clientFactory: (_endpoint, token) => ({
    async readTargets() { return []; },
    async readThreads() {
      calls += 1;
      if (token === 'token-a') { oldStarted.resolve(); return oldRelease.promise; }
      return page('new-token');
    },
    async readStatus(_targetId, threadId) { return status(threadId); },
    async readFinalAnswer() { return { status: 'unavailable', reason: 'no_confirmed_final_answer' }; },
  }) });
  const oldRead = h.service.readRunningSnapshot('target', { priority: 'foreground', force: true });
  await oldStarted.promise;
  h.token = 'token-b';
  h.service.invalidate();
  const current = await h.service.readRunningSnapshot('target', { priority: 'foreground', force: true });
  assert.equal(current.ok, true);
  if (current.ok) assert.equal(current.page.threads[0]?.id, 'new-token');
  oldRelease.resolve(page('old-token'));
  const old = await oldRead;
  assert.equal(old.ok, false);
  if (!old.ok) assert.equal(old.reason, 'connection-changed');
  assert.equal(calls, 2);
  const cached = await h.service.readRunningSnapshot('target', { priority: 'foreground' });
  assert.equal(cached.ok, true);
  if (cached.ok) assert.equal(cached.page.threads[0]?.id, 'new-token');
  assert.equal(calls, 2);
});

test('一致するhost permission削除はclient/snapshot世代を無効化する', async () => {
  const h = harness();
  const previous = await h.service.resolveAccess();
  assert.equal(previous.isCurrent?.(), true);
  h.service.invalidatePermissionRemoval(['https://example.test/*']);
  assert.equal(previous.isCurrent?.(), true);
  h.service.invalidatePermissionRemoval(['http://127.0.0.1/*']);
  assert.equal(previous.isCurrent?.(), false);
  const next = await h.service.resolveAccess();
  assert.equal(next.isCurrent?.(), true);
  assert.notEqual(next.generation, previous.generation);
  assert.equal(h.clientCount, 2);
});

test('共通queueはmanual/foregroundを優先し、実行枠と待機上限を守る', async () => {
  const firstStarted = deferred<void>();
  const firstRelease = deferred<CodexBridgeThreadStatus>();
  const starts: string[] = [];
  const h = harness({ maxConcurrentReads: 1, maxQueuedReads: 3, clientFactory: () => ({
    async readTargets() { return []; },
    async readThreads() { return page(''); },
    async readStatus(_targetId, threadId) {
      starts.push(threadId);
      if (threadId === 'blocker') { firstStarted.resolve(); return firstRelease.promise; }
      return status(threadId);
    },
    async readFinalAnswer() { return { status: 'unavailable', reason: 'no_confirmed_final_answer' }; },
  }) });
  const blocker = h.service.readStatus('target', 'blocker', 'background');
  await firstStarted.promise;
  const background = h.service.readStatus('target', 'background', 'background');
  const foreground = h.service.readStatus('target', 'foreground', 'foreground');
  const manual = h.service.readStatus('target', 'manual', 'manual');
  await assert.rejects(h.service.readStatus('target', 'overflow', 'background'), /read-queue-full/);
  firstRelease.resolve(status('blocker'));
  await Promise.all([blocker, background, foreground, manual]);
  assert.deepEqual(starts, ['blocker', 'manual', 'foreground', 'background']);
});
