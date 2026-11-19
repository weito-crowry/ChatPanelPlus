import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_BRIDGE_THREAD_MONITOR_ALARM,
  CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY,
  createCodexBridgeConnectionId,
  deriveCodexBridgeWatchTurnState,
  type CodexBridgeWatchSnapshot,
} from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import { CodexBridgeThreadMonitor } from '../src/background/thread-monitor.ts';
import type { CodexBridgeLastTurn, CodexBridgeThreadStatus } from '../src/shared/codexbridge-mcp-protocol.ts';

class FakeStorage {
  readonly values: Record<string, unknown> = {};

  async get(keys: string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.filter((key) => key in this.values).map((key) => [key, structuredClone(this.values[key])]));
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
  }
}

class FakeAlarms {
  active = false;
  creates = 0;
  clears = 0;
  lastName = '';
  lastInfo: { delayInMinutes: number; periodInMinutes: number } | null = null;

  async get(name: string): Promise<unknown> {
    return this.active && name === CODEX_BRIDGE_THREAD_MONITOR_ALARM ? { name } : undefined;
  }

  create(name: string, alarmInfo: { delayInMinutes: number; periodInMinutes: number }): void {
    this.active = true;
    this.creates += 1;
    this.lastName = name;
    this.lastInfo = alarmInfo;
  }

  async clear(name: string): Promise<boolean> {
    if (name !== CODEX_BRIDGE_THREAD_MONITOR_ALARM || !this.active) return false;
    this.active = false;
    this.clears += 1;
    return true;
  }
}

function makeStatus(
  targetId: string,
  threadId: string,
  turnId: string | null,
  status: CodexBridgeLastTurn['status'] = 'completed',
  currentExecution: CodexBridgeThreadStatus['currentExecution'] = null,
): CodexBridgeThreadStatus {
  return {
    targetId,
    threadId,
    state: null,
    currentExecution,
    lastTurn: turnId === null ? null : {
      turnId, status, category: null, evidence: 'live', reason: null, observedAt: null, needsAttention: false,
    },
    needsAttention: false,
  };
}

function harness(options: {
  connectionId?: string;
  status?: (targetId: string, threadId: string) => Promise<CodexBridgeThreadStatus>;
  maxPollsPerCycle?: number;
} = {}) {
  const storage = new FakeStorage();
  const alarms = new FakeAlarms();
  let now = Date.parse('2026-11-20T00:00:00.000Z');
  let connectionId = options.connectionId ?? 'connection-A';
  let calls = 0;
  let sequence = 0;
  const monitor = new CodexBridgeThreadMonitor(storage, alarms, async () => ({
    connectionId,
    readStatus: async (targetId, threadId) => {
      calls += 1;
      if (options.status) return options.status(targetId, threadId);
      return makeStatus(targetId, threadId, 'turn-1', 'completed');
    },
  }), {
    now: () => now,
    createWatchId: () => `watch-${++sequence}`,
    maxPollsPerCycle: options.maxPollsPerCycle,
  });
  return {
    monitor,
    storage,
    alarms,
    get calls() { return calls; },
    set connectionId(value: string) { connectionId = value; },
    advance(milliseconds: number) { now += milliseconds; },
    now: () => now,
  };
}

test('watch registration captures baseline once, deduplicates, persists, and clears the alarm after the final unwatch', async () => {
  const h = harness();
  const started = await h.monitor.startWatch('target-1', 'thread-1');
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(started.created, true);
  assert.equal(started.item.baselineCaptured, true);
  assert.equal(started.item.baselineTurnId, 'turn-1');
  assert.equal(started.item.baselineTurnStatus, 'completed');
  assert.equal(started.item.turnChange, 'baseline');
  assert.equal(deriveCodexBridgeWatchTurnState(started.item), 'baseline');
  assert.equal(h.calls, 1);
  assert.equal(h.alarms.active, true);
  assert.equal(h.alarms.lastName, CODEX_BRIDGE_THREAD_MONITOR_ALARM);
  assert.deepEqual(h.alarms.lastInfo, { delayInMinutes: 0.5, periodInMinutes: 0.5 });

  const duplicate = await h.monitor.startWatch('target-1', 'thread-1');
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) return;
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.item.watchId, started.item.watchId);
  assert.equal(h.calls, 1);
  assert.equal((await h.monitor.list()).length, 1);

  assert.equal(await h.monitor.stopWatch('connection-A', 'target-1', 'thread-1'), true);
  assert.deepEqual(await h.monitor.list(), []);
  assert.equal(h.alarms.active, false);
  assert.equal(h.alarms.clears, 1);
  assert.ok(CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY in h.storage.values);
});

test('connection IDs keep same target/thread watches separate and a fresh worker restores storage and reconciles', async () => {
  const h = harness();
  const first = await h.monitor.startWatch('target-1', 'thread-1');
  assert.equal(first.ok, true);
  h.connectionId = 'connection-B';
  const second = await h.monitor.startWatch('target-1', 'thread-1');
  assert.equal(second.ok, true);
  assert.equal((await h.monitor.list()).length, 2);

  let reconciled = 0;
  const restarted = new CodexBridgeThreadMonitor(h.storage, h.alarms, async () => ({
    connectionId: 'connection-B',
    readStatus: async (targetId, threadId) => {
      reconciled += 1;
      return makeStatus(targetId, threadId, 'turn-2', 'in_progress');
    },
  }), { now: () => h.now() + 45_000, createWatchId: () => 'unused' });
  await restarted.restore();
  const items = await restarted.list();
  assert.equal(reconciled, 1);
  assert.equal(items.length, 2);
  assert.equal(items.find((item) => item.connectionId === 'connection-A')?.lastObservedTurnId, 'turn-1');
  assert.equal(items.find((item) => item.connectionId === 'connection-B')?.lastObservedTurnId, 'turn-2');
  assert.equal(h.alarms.creates, 1);
});

test('background waits about 30 seconds while foreground refresh runs at about 15 seconds', async () => {
  const h = harness();
  await h.monitor.startWatch('target-1', 'thread-1');
  h.advance(29_999);
  await h.monitor.refreshAlarm();
  assert.equal(h.calls, 1);
  h.advance(1);
  await h.monitor.refreshAlarm();
  assert.equal(h.calls, 2);

  const foreground = harness();
  await foreground.monitor.startWatch('target-1', 'thread-1');
  foreground.advance(14_999);
  await foreground.monitor.refreshForeground();
  assert.equal(foreground.calls, 1);
  foreground.advance(1);
  await foreground.monitor.refreshForeground();
  assert.equal(foreground.calls, 2);
  foreground.advance(15_000);
  await foreground.monitor.refreshAlarm();
  assert.equal(foreground.calls, 3);
});

test('foreground tabs and an alarm coalesce one watch request and serialize requests for the same target', async () => {
  const deferred: { release?: (value: CodexBridgeThreadStatus) => void; notifyStarted?: () => void } = {};
  let hold = false;
  const started = new Promise<void>((resolve) => { deferred.notifyStarted = resolve; });
  const h = harness({ status: async (targetId, threadId) => {
    if (hold) {
      deferred.notifyStarted?.();
      return new Promise((resolve) => { deferred.release = resolve; });
    }
    return makeStatus(targetId, threadId, 'turn-1');
  } });
  await h.monitor.startWatch('target-1', 'thread-1');
  await h.monitor.startWatch('target-1', 'thread-2');
  hold = true;
  h.advance(30_000);
  const foregroundA = h.monitor.refreshForeground();
  const foregroundB = h.monitor.refreshForeground();
  const alarm = h.monitor.refreshAlarm();
  await started;
  assert.equal(h.calls, 3);
  hold = false;
  deferred.release?.(makeStatus('target-1', 'thread-1', 'turn-2'));
  await Promise.all([foregroundA, foregroundB, alarm]);
  assert.equal(h.calls, 4);
});

test('polling bounds simultaneous MCP requests across different targets', async () => {
  const pending: Array<(status: CodexBridgeThreadStatus) => void> = [];
  let holding = false;
  let active = 0;
  let maximum = 0;
  const h = harness({ status: async (targetId, threadId) => {
    if (!holding) return makeStatus(targetId, threadId, 'turn-1');
    active += 1;
    maximum = Math.max(maximum, active);
    return new Promise((resolve) => pending.push((status) => {
      active -= 1;
      resolve(status);
    }));
  } });
  for (let index = 0; index < 6; index += 1) await h.monitor.startWatch(`target-${index}`, 'thread-1');
  holding = true;
  h.advance(30_000);
  const polling = h.monitor.refreshAlarm();
  while (pending.length < 3) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(active, 3);
  assert.equal(maximum, 3);
  pending.splice(0).forEach((resolve, index) => resolve(makeStatus(`target-${index}`, 'thread-1', 'turn-2')));
  while (pending.length < 3) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(maximum, 3);
  pending.splice(0).forEach((resolve, index) => resolve(makeStatus(`target-${index + 3}`, 'thread-1', 'turn-2')));
  await polling;
  assert.equal(active, 0);
});

test('terminal states are turn-specific; estimated execution and an older completion do not imply the current turn is done', () => {
  const base: CodexBridgeWatchSnapshot = {
    watchId: 'watch', connectionId: 'connection-A', targetId: 'target-1', threadId: 'thread-1', enabled: true,
    baselineCaptured: true, baselineTurnId: 'turn-0', baselineTurnStatus: 'in_progress',
    lastObservedTurnId: 'turn-1', statusState: 'idle', lastTurnStatus: 'completed', lastTurnEvidence: 'live',
    currentExecutionState: null, currentExecutionEvidence: null, currentExecutionTurnId: null,
    needsAttention: false, turnChange: 'advanced', observedAt: null, lastSuccessAt: null,
    fetchOutcome: 'ok', nextPollAt: 0, failureCount: 0,
  };
  assert.equal(deriveCodexBridgeWatchTurnState({ ...base, lastTurnStatus: 'completed' }), 'completed');
  assert.equal(deriveCodexBridgeWatchTurnState({ ...base, lastTurnStatus: 'failed' }), 'failed');
  assert.equal(deriveCodexBridgeWatchTurnState({ ...base, lastTurnStatus: 'interrupted' }), 'interrupted');
  assert.equal(deriveCodexBridgeWatchTurnState({ ...base, lastTurnStatus: 'unknown' }), 'unknown');
  assert.equal(deriveCodexBridgeWatchTurnState({ ...base, statusState: 'not_loaded' }), 'unknown');
  assert.equal(deriveCodexBridgeWatchTurnState({ ...base, currentExecutionState: 'estimated_running' }), 'unknown');
  assert.equal(deriveCodexBridgeWatchTurnState({ ...base, currentExecutionState: 'running', currentExecutionEvidence: 'inferred' }), 'unknown');
  assert.equal(deriveCodexBridgeWatchTurnState({
    ...base, currentExecutionState: 'running', currentExecutionEvidence: 'live', currentExecutionTurnId: 'turn-2',
  }), 'running');
  assert.equal(deriveCodexBridgeWatchTurnState({ ...base, turnChange: 'gap' }), 'gap');
  assert.equal(deriveCodexBridgeWatchTurnState({
    ...base, baselineTurnId: null, lastObservedTurnId: 'turn-1',
  }), 'unknown');
  assert.equal(deriveCodexBridgeWatchTurnState({
    ...base, baselineTurnId: 'turn-1', baselineTurnStatus: 'completed', lastObservedTurnId: 'turn-1', turnChange: 'baseline',
  }), 'baseline');
});

test('a long offline interval followed by a changed turn is recorded as a gap without inventing intermediate turns', async () => {
  let observed = makeStatus('target-1', 'thread-1', 'turn-1', 'in_progress');
  const h = harness({ status: async () => observed });
  await h.monitor.startWatch('target-1', 'thread-1');
  h.advance(120_000);
  observed = makeStatus('target-1', 'thread-1', 'turn-4', 'completed');
  await h.monitor.refreshAlarm();
  const item = (await h.monitor.list())[0]!;
  assert.equal(item.baselineTurnId, 'turn-1');
  assert.equal(item.lastObservedTurnId, 'turn-4');
  assert.equal(item.turnChange, 'gap');
  assert.equal(deriveCodexBridgeWatchTurnState(item), 'gap');
});

test('a baseline turn completing later is recognized, but an already-completed baseline remains baseline', async () => {
  let status = makeStatus('target-1', 'thread-1', 'turn-1', 'in_progress');
  const h = harness({ status: async () => status });
  const started = await h.monitor.startWatch('target-1', 'thread-1');
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(started.item.baselineTurnStatus, 'in_progress');
  status = makeStatus('target-1', 'thread-1', 'turn-1', 'completed');
  h.advance(30_000);
  await h.monitor.refreshAlarm();
  const item = (await h.monitor.list())[0]!;
  assert.equal(item.turnChange, 'same');
  assert.equal(deriveCodexBridgeWatchTurnState(item), 'completed');
});

test('authentication and network failures preserve observations and never classify unknown access as terminal', async () => {
  let failure: Error & { code?: string } | null = null;
  const h = harness({ status: async (targetId, threadId) => {
    if (failure) throw failure;
    return makeStatus(targetId, threadId, 'turn-1', 'completed');
  } });
  await h.monitor.startWatch('target-1', 'thread-1');
  const original = (await h.monitor.list())[0]!;
  h.advance(30_000);
  failure = Object.assign(new Error('secret detail'), { code: 'authentication-required' });
  await h.monitor.refreshAlarm();
  let item = (await h.monitor.list())[0]!;
  assert.equal(item.fetchOutcome, '401');
  assert.equal(item.lastSuccessAt, original.lastSuccessAt);
  assert.equal(item.lastTurnStatus, 'completed');
  assert.equal(deriveCodexBridgeWatchTurnState(item), 'unknown');

  h.advance(120_000);
  failure = Object.assign(new Error('private network detail'), { code: 'disconnected' });
  await h.monitor.refreshAlarm();
  item = (await h.monitor.list())[0]!;
  assert.equal(item.fetchOutcome, 'disconnected');
  assert.equal(item.lastSuccessAt, original.lastSuccessAt);
  assert.equal(JSON.stringify(item).includes('secret detail'), false);
  assert.equal(JSON.stringify(item).includes('private network detail'), false);
});

test('a response arriving after unwatch cannot recreate or change the removed watch', async () => {
  const deferred: { release?: (value: CodexBridgeThreadStatus) => void; notifyStarted?: () => void } = {};
  let hold = false;
  const started = new Promise<void>((resolve) => { deferred.notifyStarted = resolve; });
  const h = harness({ status: async (targetId, threadId) => {
    if (hold) {
      deferred.notifyStarted?.();
      return new Promise((resolve) => { deferred.release = resolve; });
    }
    return makeStatus(targetId, threadId, 'turn-1');
  } });
  await h.monitor.startWatch('target-1', 'thread-1');
  hold = true;
  h.advance(30_000);
  const polling = h.monitor.refreshAlarm();
  await started;
  assert.equal(await h.monitor.stopWatch('connection-A', 'target-1', 'thread-1'), true);
  deferred.release?.(makeStatus('target-1', 'thread-1', 'turn-2'));
  await polling;
  assert.deepEqual(await h.monitor.list(), []);
  assert.equal(h.alarms.active, false);
});

test('unwatch then rewatch gets a new baseline and ignores the previous watch response', async () => {
  const deferred: { release?: (value: CodexBridgeThreadStatus) => void; notifyStarted?: () => void } = {};
  let hold = false;
  let latestTurnId = 'turn-1';
  const started = new Promise<void>((resolve) => { deferred.notifyStarted = resolve; });
  const h = harness({ status: async (targetId, threadId) => {
    if (hold) {
      deferred.notifyStarted?.();
      return new Promise((resolve) => { deferred.release = resolve; });
    }
    return makeStatus(targetId, threadId, latestTurnId);
  } });
  const original = await h.monitor.startWatch('target-1', 'thread-1');
  assert.equal(original.ok, true);
  if (!original.ok) return;
  hold = true;
  h.advance(30_000);
  const oldPoll = h.monitor.refreshAlarm();
  await started;
  await h.monitor.stopWatch('connection-A', 'target-1', 'thread-1');
  hold = false;
  latestTurnId = 'turn-3';
  const rewatch = h.monitor.startWatch('target-1', 'thread-1');
  deferred.release?.(makeStatus('target-1', 'thread-1', 'turn-2'));
  await Promise.all([oldPoll, rewatch]);
  const item = (await h.monitor.list())[0]!;
  assert.notEqual(item.watchId, original.item.watchId);
  assert.equal(item.baselineTurnId, 'turn-3');
  assert.equal(item.lastObservedTurnId, 'turn-3');
  assert.equal(item.turnChange, 'baseline');
});

test('repeated failures back off while a missing token or network is not a terminal state', async () => {
  const h = harness({ status: async () => {
    throw Object.assign(new Error('timeout'), { code: 'timeout' });
  } });
  await h.monitor.startWatch('target-1', 'thread-1');
  let item = (await h.monitor.list())[0]!;
  assert.equal(item.fetchOutcome, 'timeout');
  assert.equal(item.failureCount, 1);
  const firstRetry = item.nextPollAt;
  h.advance(15_000);
  await h.monitor.refreshForeground();
  assert.equal(h.calls, 1);
  h.advance(15_000);
  await h.monitor.refreshForeground();
  item = (await h.monitor.list())[0]!;
  assert.equal(h.calls, 2);
  assert.equal(item.failureCount, 2);
  assert.ok(item.nextPollAt - firstRetry >= 60_000);
  assert.equal(deriveCodexBridgeWatchTurnState(item), 'unknown');
});

test('watch list is capped at a reasonable count', async () => {
  const h = harness();
  for (let index = 0; index < 32; index += 1) {
    const result = await h.monitor.startWatch('target-1', `thread-${index}`);
    assert.equal(result.ok, true);
  }
  const overflow = await h.monitor.startWatch('target-1', 'thread-overflow');
  assert.deepEqual(overflow, { ok: false, reason: 'watch-limit' });
  assert.equal((await h.monitor.list()).length, 32);
});

test('endpoint connection ID is normalized, stable, and excludes token-like query parameters', async () => {
  const first = await createCodexBridgeConnectionId('HTTP://Example.COM:80/mcp?z=2&access_token=hidden&a=1');
  const second = await createCodexBridgeConnectionId('http://example.com/mcp?a=1&z=2&access_token=other');
  const otherPath = await createCodexBridgeConnectionId('http://example.com/other?a=1&z=2');
  assert.equal(first, second);
  assert.notEqual(first, otherPath);
  assert.equal(first?.includes('hidden'), false);
});
