import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_BRIDGE_THREAD_MONITOR_ALARM,
  CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY,
} from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import { CodexBridgeThreadMonitor } from '../src/background/thread-monitor.ts';
import { watchTurnStateLabel } from '../src/content/codexbridge-watch-presentation.ts';
import type { CodexBridgeThreadStatus } from '../src/shared/codexbridge-mcp-protocol.ts';

class MemoryStorage {
  readonly values: Record<string, unknown> = {};

  async get(keys: string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.filter((key) => key in this.values).map((key) => [key, structuredClone(this.values[key])]));
  }

  async set(items: Record<string, unknown>): Promise<void> { Object.assign(this.values, structuredClone(items)); }
}

class MemoryAlarms {
  active = false;
  async get(name: string): Promise<unknown> { return this.active && name === CODEX_BRIDGE_THREAD_MONITOR_ALARM ? { name } : undefined; }
  create(name: string): void { if (name === CODEX_BRIDGE_THREAD_MONITOR_ALARM) this.active = true; }
  async clear(name: string): Promise<boolean> {
    if (name !== CODEX_BRIDGE_THREAD_MONITOR_ALARM) return false;
    this.active = false;
    return true;
  }
}

function status(terminal = false): CodexBridgeThreadStatus {
  return {
    targetId: 'target-a', threadId: 'thread-a', state: terminal ? 'completed' : 'in_progress',
    needsAttention: false,
    currentExecution: terminal ? {
      turnId: null, state: 'unknown', evidence: 'inferred', reason: 'execution_unconfirmed',
      observedAt: null, needsAttention: false,
    } : null,
    lastTurn: {
      turnId: 'turn-a', status: terminal ? 'completed' : 'in_progress', category: null,
      evidence: 'live', reason: null, observedAt: null, needsAttention: false,
    },
  };
}

test('a confirmed same-turn terminal state recovers after a failed status fetch', async () => {
  const storage = new MemoryStorage();
  const alarms = new MemoryAlarms();
  let now = Date.parse('2026-11-23T05:30:00.000Z');
  let current = status();
  let failure: Error | null = null;
  const monitor = new CodexBridgeThreadMonitor(storage, alarms, async () => ({
    connectionId: 'connection-a',
    async readStatus() { if (failure) throw failure; return current; },
  }), { now: () => now, createWatchId: () => 'watch-a', createEventId: () => 'event-a' });

  await monitor.startWatch('target-a', 'thread-a');
  failure = Object.assign(new Error('private auth detail'), { code: 'authentication-required' });
  now += 30_000;
  await monitor.refreshAlarm();
  const failedSnapshot = (await monitor.list())[0]!;
  assert.equal(failedSnapshot.fetchOutcome, '401');
  assert.equal(failedSnapshot.baselineTurnStatus, 'in_progress');
  assert.equal(failedSnapshot.lastObservedTurnId, 'turn-a');
  failure = null;
  current = status(true);
  now += 30_000;
  await monitor.refreshAlarm();

  assert.equal((await monitor.listEvents()).length, 1);
  assert.equal((await monitor.listEvents())[0]?.turnId, 'turn-a');
  assert.deepEqual(await monitor.list(), []);
  assert.equal(alarms.active, false);
  const saved = storage.values[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY] as { items: unknown[] };
  assert.equal(saved.items.length, 0);
});

test('a saved legacy watch resumes the confirmed same-turn completion after a 90-second gap', async () => {
  const storage = new MemoryStorage();
  const alarms = new MemoryAlarms();
  const now = Date.parse('2026-11-24T00:03:00.000Z');
  const oldObservation = '2026-11-24T00:00:00.000Z';
  storage.values[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY] = {
    version: 1,
    items: [{
      watchId: 'watch-persisted', connectionId: 'connection-a', targetId: 'target-a', threadId: 'thread-a', enabled: true,
      baselineCaptured: true, baselineTurnId: 'turn-a', baselineTurnStatus: 'in_progress',
      lastObservedTurnId: 'turn-a', statusState: 'completed', lastTurnStatus: 'completed', lastTurnEvidence: 'live',
      currentExecutionState: 'unknown', currentExecutionEvidence: 'inferred',
      currentExecutionReason: 'execution_unconfirmed', currentExecutionTurnId: null,
      needsAttention: false, turnChange: 'same', observedAt: oldObservation, lastSuccessAt: oldObservation,
      fetchOutcome: 'ok', nextPollAt: now - 1, failureCount: 0,
    }],
  };
  alarms.active = true;
  let notificationCalls = 0;
  let reflectedEvents = 0;
  let statusReads = 0;
  const monitor = new CodexBridgeThreadMonitor(storage, alarms, async () => ({
    connectionId: 'connection-a',
    async readStatus() { statusReads += 1; return status(true); },
  }), {
    now: () => now,
    createWatchId: () => 'unused-watch',
    createEventId: () => 'event-recovered',
    notification: { async prepare() {
      return { state: 'ready', async play() { notificationCalls += 1; return { ok: true }; } };
    } },
    onTerminalEventSaved(event) {
      reflectedEvents += 1;
      assert.equal(event.turnId, 'turn-a');
    },
  });

  await monitor.refreshAlarm();
  const events = await monitor.listEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventId, 'event-recovered');
  assert.equal(events[0]?.turnId, 'turn-a');
  assert.deepEqual(await monitor.list(), []);
  assert.equal(alarms.active, false);
  const upgraded = storage.values[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY] as { version: number; items: unknown[]; events: unknown[] };
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.items.length, 0);
  assert.equal(upgraded.events.length, 1);

  // Repeated refreshes cannot re-run a removed watch or replay its event.
  await monitor.refreshAlarm();
  assert.equal(statusReads, 1);
  assert.equal(notificationCalls, 1);
  assert.equal(reflectedEvents, 1);
});

test('unconfirmed execution remains held and a later clear poll recovers the same turn', async () => {
  const storage = new MemoryStorage();
  const alarms = new MemoryAlarms();
  let now = Date.parse('2026-11-23T05:30:00.000Z');
  let current = status();
  const monitor = new CodexBridgeThreadMonitor(storage, alarms, async () => ({
    connectionId: 'connection-a', async readStatus() { return current; },
  }), { now: () => now, createWatchId: () => 'watch-evidence', createEventId: () => 'event-evidence' });

  await monitor.startWatch('target-a', 'thread-a');
  current = {
    ...status(true),
    currentExecution: {
      turnId: null, state: 'unknown', evidence: 'inferred', reason: 'other_reason',
      observedAt: null, needsAttention: false,
    },
  };
  now += 120_000;
  await monitor.refreshAlarm();
  let [item] = await monitor.list();
  assert.equal((await monitor.listEvents()).length, 0);
  assert.equal(item?.terminalHoldReason, 'execution-evidence-unconfirmed');
  assert.equal(item?.baselineTurnStatus, 'in_progress');
  assert.equal(item?.lastObservedTurnId, 'turn-a');
  assert.match(watchTurnStateLabel(item!, true), /current_executionの証拠を確認できない/);

  now += 30_000;
  await monitor.refreshAlarm();
  [item] = await monitor.list();
  assert.equal((await monitor.listEvents()).length, 0);
  assert.equal(item?.terminalHoldReason, 'execution-evidence-unconfirmed');

  current = status(true);
  now += 30_000;
  await monitor.refreshAlarm();
  assert.equal((await monitor.listEvents()).length, 1);
  assert.deepEqual(await monitor.list(), []);
  assert.equal(alarms.active, false);
});
