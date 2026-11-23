import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_BRIDGE_THREAD_MONITOR_ALARM,
  CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY,
  deriveCodexBridgeWatchTurnState,
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

test('failed status fetch preserves the watch and labels the live terminal state as notification hold', async () => {
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

  let [item] = await monitor.list();
  assert.equal((await monitor.listEvents()).length, 0);
  assert.equal(item?.fetchOutcome, 'ok');
  assert.equal(item?.turnChange, 'same');
  assert.equal(Date.parse(item!.lastSuccessAt!) - Date.parse(failedSnapshot.lastSuccessAt!), 60_000);
  assert.equal(deriveCodexBridgeWatchTurnState(item!), 'completed');
  assert.equal(watchTurnStateLabel(item!, true), '完了状態を観測しました。通知判定保留（前回の状態取得に失敗）。監視継続中。');

  now += 30_000;
  await monitor.refreshAlarm();
  [item] = await monitor.list();
  assert.equal((await monitor.listEvents()).length, 0);
  assert.equal((await monitor.list()).length, 1);
  assert.equal(item?.turnChange, 'same');
  assert.equal(item?.terminalHoldReason, 'previous-fetch-failed');
  assert.equal(alarms.active, true);
  const saved = storage.values[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY] as { items: unknown[] };
  assert.equal(saved.items.length, 1);
});

test('terminal status after a 90-second observation gap stays held on repeated polls', async () => {
  const storage = new MemoryStorage();
  const alarms = new MemoryAlarms();
  let now = Date.parse('2026-11-23T05:30:00.000Z');
  let current = status();
  const monitor = new CodexBridgeThreadMonitor(storage, alarms, async () => ({
    connectionId: 'connection-a', async readStatus() { return current; },
  }), { now: () => now, createWatchId: () => 'watch-gap', createEventId: () => 'event-gap' });

  await monitor.startWatch('target-a', 'thread-a');
  current = status(true);
  now += 120_000;
  await monitor.refreshAlarm();
  let [item] = await monitor.list();
  assert.equal(item?.terminalHoldReason, 'observation-gap');
  assert.equal(item?.turnChange, 'same');
  assert.match(watchTurnStateLabel(item!, true), /成功観測の間隔が上限以上/);
  assert.equal((await monitor.listEvents()).length, 0);

  now += 30_000;
  await monitor.refreshAlarm();
  [item] = await monitor.list();
  assert.equal(item?.terminalHoldReason, 'observation-gap');
  assert.equal((await monitor.list()).length, 1);
  assert.equal((await monitor.listEvents()).length, 0);
});
