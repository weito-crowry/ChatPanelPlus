import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_BRIDGE_THREAD_MONITOR_ALARM,
  CODEX_BRIDGE_THREAD_MONITOR_MAX_WATCHES,
  CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY,
} from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeTerminalEvent } from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import { CodexBridgeThreadMonitor } from '../src/background/thread-monitor.ts';
import type { CodexBridgeThreadStatus } from '../src/shared/codexbridge-mcp-protocol.ts';

class Storage {
  values: Record<string, unknown> = {};
  async get(keys: string[]) { return Object.fromEntries(keys.filter((key) => key in this.values).map((key) => [key, structuredClone(this.values[key])])); }
  async set(items: Record<string, unknown>) { Object.assign(this.values, structuredClone(items)); }
}

class Alarms {
  active = false;
  async get(name: string) { return this.active && name === CODEX_BRIDGE_THREAD_MONITOR_ALARM ? { name } : undefined; }
  create() { this.active = true; }
  async clear() { this.active = false; return true; }
}

function makeStatus(turnId: string, state: 'in_progress' | 'completed') : CodexBridgeThreadStatus {
  return {
    targetId: 'target-1', threadId: 'thread-1', state, currentExecution: null, needsAttention: false,
    lastTurn: { turnId, status: state, category: null, evidence: 'live', reason: null, observedAt: null, needsAttention: false },
  };
}

function harness(initial: CodexBridgeThreadStatus, onPrepare: (event: CodexBridgeTerminalEvent) => void = () => {}) {
  const storage = new Storage();
  const alarms = new Alarms();
  let current = initial;
  let now = Date.parse('2026-11-22T00:00:00Z');
  let sequence = 0;
  let readGate: { started: () => void; wait: Promise<void> } | null = null;
  const monitor = new CodexBridgeThreadMonitor(storage, alarms, async () => ({
    connectionId: 'connection-A',
    async readStatus() {
      if (readGate) { const gate = readGate; readGate = null; gate.started(); await gate.wait; }
      return current;
    },
  }), {
    now: () => now,
    createWatchId: () => `watch-${++sequence}`,
    createEventId: () => `event-${++sequence}`,
    notification: { async prepare(event) {
      onPrepare(event);
      return { state: 'skipped', reason: 'muted' };
    } },
  });
  return {
    monitor, storage,
    setStatus(value: CodexBridgeThreadStatus) { current = value; },
    advance() { now += 30_000; },
    gateNextRead() {
      let started!: () => void;
      let release!: () => void;
      const startedPromise = new Promise<void>((resolve) => { started = resolve; });
      const wait = new Promise<void>((resolve) => { release = resolve; });
      readGate = { started, wait };
      return { started: startedPromise, release };
    },
  };
}

const ownerA = { ownerTabId: 4, ownerConversationId: 'conversation-A', ownerMuted: false, ownerMuteRevision: 0 } as const;
const ownerB = { ownerTabId: 9, ownerConversationId: 'conversation-B', ownerMuted: true, ownerMuteRevision: 7 } as const;

test('watch上限到達後も同一identityのowner移管は既存枠で成功する', async () => {
  const h = harness(makeStatus('turn-1', 'in_progress'));
  const created = await h.monitor.startWatch('target-1', 'thread-1', ownerA);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const saved = h.storage.values[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY] as { version: number; items: Array<Record<string, unknown>>; events: unknown[] };
  const fillers = Array.from({ length: CODEX_BRIDGE_THREAD_MONITOR_MAX_WATCHES - 1 }, (_, index) => ({
    ...saved.items[0], watchId: `filler-${index}`, targetId: `fill-target-${index}`, threadId: `fill-thread-${index}`,
  }));
  await h.storage.set({ [CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY]: { ...saved, items: [...saved.items, ...fillers] } });
  const transferred = await h.monitor.startWatch('target-1', 'thread-1', ownerB);
  assert.equal(transferred.ok, true);
  if (!transferred.ok) return;
  assert.equal(transferred.transferred, true);
  assert.equal(transferred.item.watchId, created.item.watchId);
  assert.equal(transferred.item.ownerConversationId, ownerB.ownerConversationId);
  assert.equal((await h.monitor.list()).length, CODEX_BRIDGE_THREAD_MONITOR_MAX_WATCHES);
});

test('同時のowner再登録は後勝ちで単一watchを維持する', async () => {
  const h = harness(makeStatus('turn-1', 'in_progress'));
  const initial = await h.monitor.startWatch('target-1', 'thread-1', ownerA);
  assert.equal(initial.ok, true);
  const ownerC = { ...ownerB, ownerTabId: 10, ownerConversationId: 'conversation-C' };
  const [toB, toC] = await Promise.all([
    h.monitor.startWatch('target-1', 'thread-1', ownerB),
    h.monitor.startWatch('target-1', 'thread-1', ownerC),
  ]);
  assert.equal(toB.ok, true);
  assert.equal(toC.ok, true);
  assert.equal((await h.monitor.list()).length, 1);
  assert.equal((await h.monitor.list())[0]?.ownerConversationId, ownerC.ownerConversationId);
});

test('owner欠損legacy watchは明示移管せずowner情報を推測しない', async () => {
  const h = harness(makeStatus('turn-1', 'in_progress'));
  const legacy = await h.monitor.startWatch('target-1', 'thread-1');
  assert.equal(legacy.ok, true);
  const attempt = await h.monitor.startWatch('target-1', 'thread-1', ownerB);
  assert.deepEqual(attempt, { ok: false, reason: 'owner-unavailable' });
  assert.equal((await h.monitor.list())[0]?.ownerConversationId, undefined);
});

test('owner移管中に完了したpollは新owner eventと音声policyへ一度だけ確定する', async () => {
  const preparedOwners: Array<string | undefined> = [];
  const h = harness(makeStatus('turn-1', 'in_progress'), (event) => preparedOwners.push(event.ownerConversationId));
  const initial = await h.monitor.startWatch('target-1', 'thread-1', ownerA);
  assert.equal(initial.ok, true);
  h.setStatus(makeStatus('turn-1', 'completed'));
  h.advance();
  const gate = h.gateNextRead();
  const polling = h.monitor.refreshAlarm();
  await gate.started;
  const moved = await h.monitor.startWatch('target-1', 'thread-1', ownerB);
  assert.equal(moved.ok, true);
  gate.release();
  await polling;
  const events = await h.monitor.listEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.ownerConversationId, ownerB.ownerConversationId);
  assert.deepEqual(preparedOwners, [ownerB.ownerConversationId]);
});
