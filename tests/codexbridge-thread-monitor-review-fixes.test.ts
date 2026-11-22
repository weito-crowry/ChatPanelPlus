import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_BRIDGE_THREAD_MONITOR_ALARM,
  CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY,
  deriveCodexBridgeWatchTurnState,
  type CodexBridgeWatchSnapshot,
} from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import { CodexBridgeThreadMonitor } from '../src/background/thread-monitor.ts';
import type { CodexBridgeLastTurn, CodexBridgeObservation, CodexBridgeThreadStatus } from '../src/shared/codexbridge-mcp-protocol.ts';

class MemoryStorage {
  values: Record<string, unknown> = {};

  async get(keys: string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.filter((key) => key in this.values).map((key) => [key, structuredClone(this.values[key])]));
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
  }
}

class MemoryAlarms {
  active = false;

  async get(name: string): Promise<unknown> {
    return this.active && name === CODEX_BRIDGE_THREAD_MONITOR_ALARM ? { name } : undefined;
  }

  create(name: string): void {
    if (name === CODEX_BRIDGE_THREAD_MONITOR_ALARM) this.active = true;
  }

  async clear(name: string): Promise<boolean> {
    if (name !== CODEX_BRIDGE_THREAD_MONITOR_ALARM || !this.active) return false;
    this.active = false;
    return true;
  }
}

function turn(turnId: string, status: CodexBridgeLastTurn['status'] = 'completed'): CodexBridgeLastTurn {
  return { turnId, status, category: null, evidence: 'live', reason: null, observedAt: null, needsAttention: false };
}

function execution(turnId: string, state: string, evidence: string): CodexBridgeObservation {
  return { turnId, state, evidence, reason: null, observedAt: null, needsAttention: false };
}

function status(options: {
  state?: string;
  lastTurn?: CodexBridgeLastTurn | null;
  currentExecution?: CodexBridgeObservation | null;
}): CodexBridgeThreadStatus {
  return {
    targetId: 'target', threadId: 'thread', state: options.state ?? 'idle',
    currentExecution: options.currentExecution ?? null, lastTurn: options.lastTurn ?? null, needsAttention: false,
  };
}

function makeMonitor(storage: MemoryStorage, alarms: MemoryAlarms, readStatus: () => Promise<CodexBridgeThreadStatus>, now: () => number) {
  return new CodexBridgeThreadMonitor(storage, alarms, async () => ({
    connectionId: 'connection',
    readStatus: async () => readStatus(),
  }), { now, createWatchId: () => 'watch' });
}

test('a confirmed no-turn baseline can observe a new turn start and completion', async () => {
  const storage = new MemoryStorage();
  const alarms = new MemoryAlarms();
  let observed = status({ state: 'idle' });
  let now = 1_800_000_000_000;
  const monitor = makeMonitor(storage, alarms, async () => observed, () => now);
  const started = await monitor.startWatch('target', 'thread');
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(started.item.baselineTurnKind, 'none');
  assert.equal(started.item.baselineTurnId, null);
  assert.equal(deriveCodexBridgeWatchTurnState(started.item), 'baseline');

  observed = status({ state: 'running', currentExecution: execution('turn-b', 'running', 'live') });
  now += 30_000;
  await monitor.refreshAlarm();
  const item = (await monitor.list())[0]!;
  assert.equal(deriveCodexBridgeWatchTurnState(item), 'running');

  observed = status({ lastTurn: turn('turn-b') });
  now += 30_000;
  await monitor.refreshAlarm();
  assert.equal((await monitor.listEvents())[0]?.turnId, 'turn-b');
  assert.equal((await monitor.listEvents())[0]?.status, 'completed');
  assert.deepEqual(await monitor.list(), []);
});

test('an unknown first baseline migrates conservatively and does not invent a new completion', async () => {
  const storage = new MemoryStorage();
  const alarms = new MemoryAlarms();
  let observed = status({ state: 'not_loaded' });
  let now = 1_800_000_000_000;
  const monitor = makeMonitor(storage, alarms, async () => observed, () => now);
  const started = await monitor.startWatch('target', 'thread');
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(started.item.baselineTurnKind, 'unknown');

  const stored = storage.values[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY] as { items: Array<Record<string, unknown>>; version: number };
  delete stored.items[0]!.baselineTurnKind;
  await storage.set({ [CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY]: stored });
  assert.equal((await monitor.list())[0]?.baselineTurnKind, 'unknown');

  observed = status({ lastTurn: turn('turn-b') });
  now += 30_000;
  await monitor.refreshAlarm();
  const item = (await monitor.list())[0]!;
  assert.equal(item.turnChange, 'unknown');
  assert.equal(deriveCodexBridgeWatchTurnState(item), 'unknown');
});

test('a distinct live execution outranks an older last-turn completion; inferred and estimated execution stay unknown', async () => {
  const storage = new MemoryStorage();
  const alarms = new MemoryAlarms();
  let observed = status({ lastTurn: turn('turn-a') });
  let now = 1_800_000_000_000;
  const monitor = makeMonitor(storage, alarms, async () => observed, () => now);
  await monitor.startWatch('target', 'thread');

  observed = status({ state: 'running', lastTurn: turn('turn-a'), currentExecution: execution('turn-b', 'running', 'live') });
  now += 30_000;
  await monitor.refreshAlarm();
  const item = (await monitor.list())[0]!;
  assert.equal(item.turnChange, 'same');
  assert.equal(deriveCodexBridgeWatchTurnState(item), 'running');
  assert.equal(deriveCodexBridgeWatchTurnState({ ...item, turnChange: 'gap' }), 'running');

  for (const currentExecution of [
    execution('turn-b', 'running', 'inferred'),
    execution('turn-b', 'estimated_running', 'estimated'),
    execution('turn-b', 'completed', 'live'),
  ]) {
    const snapshot: CodexBridgeWatchSnapshot = { ...item,
      currentExecutionState: currentExecution.state,
      currentExecutionEvidence: currentExecution.evidence,
      currentExecutionTurnId: currentExecution.turnId,
    };
    assert.equal(deriveCodexBridgeWatchTurnState(snapshot), 'unknown');
  }
});

test('restore respects a saved future poll time, polls at expiry, and coalesces repeated restores', async () => {
  const storage = new MemoryStorage();
  const alarms = new MemoryAlarms();
  let now = 1_800_000_000_000;
  const original = makeMonitor(storage, alarms, async () => status({ lastTurn: turn('turn-a') }), () => now);
  await original.startWatch('target', 'thread');

  let reads = 0;
  let release: ((value: CodexBridgeThreadStatus) => void) | undefined;
  let notifyStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
  const restored = makeMonitor(storage, alarms, async () => {
    reads += 1;
    notifyStarted?.();
    return new Promise<CodexBridgeThreadStatus>((resolve) => { release = resolve; });
  }, () => now);

  await restored.restore();
  assert.equal(reads, 0);
  now += 30_000;
  const firstRestore = restored.restore();
  const secondRestore = restored.restore();
  await started;
  assert.equal(reads, 1);
  release?.(status({ lastTurn: turn('turn-b') }));
  await Promise.all([firstRestore, secondRestore]);
  assert.equal(reads, 1);
});
