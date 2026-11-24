import assert from 'node:assert/strict';
import test from 'node:test';
import { CODEX_BRIDGE_THREAD_MONITOR_ALARM } from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeThreadStatus } from '../src/shared/codexbridge-mcp-protocol.ts';
import { CodexBridgeThreadMonitor } from '../src/background/thread-monitor.ts';

class Storage {
  values: Record<string, unknown> = {};
  async get(keys: string[]) { return Object.fromEntries(keys.filter((key) => key in this.values).map((key) => [key, this.values[key]])); }
  async set(items: Record<string, unknown>) { Object.assign(this.values, items); }
}

class Alarms {
  active = false;
  async get(name: string) { return this.active && name === CODEX_BRIDGE_THREAD_MONITOR_ALARM ? { name } : undefined; }
  create() { this.active = true; }
  async clear() { const wasActive = this.active; this.active = false; return wasActive; }
}

function inProgress(targetId: string, threadId: string): CodexBridgeThreadStatus {
  return { targetId, threadId, state: 'running', currentExecution: null,
    lastTurn: { turnId: 'turn-1', status: 'in_progress', category: null, evidence: 'live', reason: null,
      observedAt: null, needsAttention: false }, needsAttention: false };
}

test('freshな完全snapshotからの不在はurgent status確認を行い、status確定までwatchを保持する', async () => {
  const storage = new Storage();
  const alarms = new Alarms();
  let now = Date.parse('2026-11-20T00:00:00.000Z');
  let snapshotReads = 0;
  const priorities: string[] = [];
  const monitor = new CodexBridgeThreadMonitor(storage, alarms, async () => ({
    connectionId: 'connection-A', readsScheduled: true,
    readStatus: async (targetId: string, threadId: string, priority = 'background') => {
      priorities.push(priority);
      return inProgress(targetId, threadId);
    },
    readRunningSnapshot: async () => {
      snapshotReads += 1;
      return { ok: true as const, connectionId: 'connection-A', generation: 1,
        page: { threads: [], nextCursor: null }, freshness: 'fresh' as const,
        observedAt: new Date(now).toISOString(), ageMs: 0, failureReason: null };
    },
  }), { now: () => now, createWatchId: () => 'watch-absent' });
  await monitor.startWatch('target-1', 'thread-1');
  priorities.length = 0;
  now += 30_000;
  await monitor.refreshAlarm();
  assert.equal(snapshotReads, 1);
  assert.ok(priorities.includes('urgent'));
  assert.equal((await monitor.list()).length, 1);
});

test('running_only失敗時も個別status pollは続き、不確実なsnapshotからwatchを解除しない', async () => {
  const storage = new Storage();
  const alarms = new Alarms();
  let now = Date.parse('2026-11-20T00:00:00.000Z');
  let statusReads = 0;
  let snapshotReads = 0;
  const monitor = new CodexBridgeThreadMonitor(storage, alarms, async () => ({
    connectionId: 'connection-A', readsScheduled: true,
    readStatus: async (targetId: string, threadId: string) => {
      statusReads += 1;
      return inProgress(targetId, threadId);
    },
    readRunningSnapshot: async () => {
      snapshotReads += 1;
      return { ok: false as const, connectionId: 'connection-A', generation: 1,
        freshness: 'error' as const, observedAt: null, ageMs: null, reason: 'running-only-unsupported' as const };
    },
  }), { now: () => now, createWatchId: () => 'watch-fallback' });
  await monitor.startWatch('target-1', 'thread-1');
  const before = statusReads;
  now += 30_000;
  await monitor.refreshAlarm();
  assert.equal(statusReads, before + 1);
  assert.equal(snapshotReads, 1);
  assert.equal((await monitor.list()).length, 1);
});

test('同じconnectionIdでも認証generationが変わった自動登録はwatchを作らない', async () => {
  const storage = new Storage();
  const alarms = new Alarms();
  const monitor = new CodexBridgeThreadMonitor(storage, alarms, async () => ({
    connectionId: 'connection-A', generation: 4, isCurrent: () => true,
  }));
  const result = await monitor.startWatch('target-1', 'thread-1', undefined, {
    expectedConnectionId: 'connection-A', expectedGeneration: 3,
  });
  assert.deepEqual(result, { ok: false, reason: 'connection-changed' });
  assert.equal((await monitor.list()).length, 0);
});
