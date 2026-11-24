import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY,
  CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY,
} from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeThread, CodexBridgeThreadPage } from '../src/shared/codexbridge-mcp-protocol.ts';
import { readAutoWatchState } from '../src/background/thread-monitor-auto-registration-state.ts';
import type { AutoEntry } from '../src/background/thread-monitor-auto-registration-state.ts';
import { CodexBridgeAutoThreadRegistration } from '../src/background/thread-monitor-auto-registration.ts';
import { CodexBridgeThreadMonitor } from '../src/background/thread-monitor.ts';

const target = { id: 'target-1', name: 'Workstation', kind: 'local', available: true } as const;
type Owner = Readonly<{ ownerTabId: number; ownerConversationId: string }>;
const ownerA: Owner = { ownerTabId: 4, ownerConversationId: 'conversation-A' };
const ownerB: Owner = { ownerTabId: 8, ownerConversationId: 'conversation-B' };
const threadA = 'thread-A';
const threadB = 'thread-B';
const turnA = 'turn-A';
const turnB = 'turn-B';

function liveThread(id: string, turnId: string): CodexBridgeThread {
  const execution = { turnId, state: 'in_progress' as const, evidence: 'live' as const, reason: null,
    observedAt: null, needsAttention: false };
  return { targetId: target.id, id, title: id, preview: null, cwd: null, updatedAt: null,
    currentExecution: execution, lastTurn: { ...execution, status: 'in_progress', category: null }, needsAttention: false };
}

function autoEntry(owner: Owner, enabled: boolean, connectionId = 'connection-A'): AutoEntry {
  return {
    connectionId, targetId: target.id, enabled, ownerTabId: owner.ownerTabId,
    ownerConversationId: owner.ownerConversationId, ownerMuted: false, ownerMuteRevision: 0,
    failure: null, liveThreadCount: null, lastScannedAt: null, nextScanAt: 0, failureCount: 0,
    skippedExecutions: [],
  };
}

class FakeStorage {
  readonly values: Record<string, unknown> = {};
  async get(keys: string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.filter((key) => key in this.values)
      .map((key) => [key, structuredClone(this.values[key])]));
  }
  async set(items: Record<string, unknown>): Promise<void> { Object.assign(this.values, structuredClone(items)); }
}

function harness(initialThreads: readonly CodexBridgeThread[]) {
  const storage = new FakeStorage();
  const owners = new Map<number, string>([[ownerA.ownerTabId, ownerA.ownerConversationId],
    [ownerB.ownerTabId, ownerB.ownerConversationId]]);
  const rebindable = new Map<number, string>();
  const mute = new Map<string, { muted: boolean; revision: number }>();
  let threads = [...initialThreads];
  let connectionId = 'connection-A';
  let fetchBarrier: Promise<void> | null = null;
  let targetBarrier: Promise<void> | null = null;
  let fetchFailure: Error | null = null;
  let runningOnlyCalls = 0;
  let targetCalls = 0;
  let watchIndex = 0;
  const alarms = {
    names: new Set<string>(),
    async get(name: string) { return this.names.has(name) ? { name } : undefined; },
    create(name: string) { this.names.add(name); },
    async clear(name: string) { return this.names.delete(name); },
  };
  const resolveAccess = async () => ({
    connectionId,
    readTargets: async () => {
      targetCalls += 1;
      if (targetBarrier) await targetBarrier;
      return [target];
    },
    readRunningThreads: async (targetId: string): Promise<CodexBridgeThreadPage> => {
      runningOnlyCalls += 1;
      assert.equal(targetId, target.id);
      if (fetchBarrier) await fetchBarrier;
      if (fetchFailure) throw fetchFailure;
      return { threads, nextCursor: null };
    },
  });
  const monitor = new CodexBridgeThreadMonitor(storage, alarms, resolveAccess, {
    now: () => Date.parse('2026-11-24T00:00:00.000Z'), createWatchId: () => `watch-${++watchIndex}`,
  });
  const auto = new CodexBridgeAutoThreadRegistration(
    storage, alarms, monitor, resolveAccess,
    async (tabId, conversationId) => {
      const value = mute.get(`${tabId}\u0000${conversationId}`) ?? { muted: false, revision: 0 };
      return { ok: true, ...value };
    },
    async (tabId, conversationId) => owners.get(tabId) === conversationId,
    async (tabId, conversationId) => rebindable.get(tabId) === conversationId,
  );
  return {
    storage, monitor, auto, owners, rebindable, mute,
    get runningOnlyCalls() { return runningOnlyCalls; },
    get targetCalls() { return targetCalls; },
    set connectionId(value: string) { connectionId = value; },
    set threads(value: readonly CodexBridgeThread[]) { threads = [...value]; },
    set fetchBarrier(value: Promise<void> | null) { fetchBarrier = value; },
    set targetBarrier(value: Promise<void> | null) { targetBarrier = value; },
    set fetchFailure(value: Error | null) { fetchFailure = value; },
  };
}

function setEnabled(h: ReturnType<typeof harness>, owner: Owner, enabled = true) {
  return h.auto.setEnabled(target.id, owner.ownerTabId, owner.ownerConversationId, enabled);
}

function register(h: ReturnType<typeof harness>, owner: Owner, threadIds: readonly string[],
  connectionId = 'connection-A', name: string = owner.ownerConversationId) {
  return h.auto.registerCompletedAnswer(target.id, connectionId, owner.ownerTabId, owner.ownerConversationId,
    `turn-${name}`, `assistant-${name}`, threadIds);
}

function entries(h: ReturnType<typeof harness>) {
  return (h.storage.values[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY] as {
    version: number; entries: readonly AutoEntry[];
  }).entries;
}

test('v1保存状態は会話別entryを保持し、同一の接続・target・会話の重複だけ拒否する', () => {
  const legacyA = autoEntry(ownerA, false);
  const currentB = autoEntry(ownerB, true);
  assert.deepEqual(readAutoWatchState({ version: 1, entries: [legacyA, currentB] }), {
    version: 1, entries: [legacyA, currentB],
  });
  assert.equal(readAutoWatchState({ version: 1, entries: [legacyA, { ...legacyA }] }), null);
});

test('同一Bridge・targetで異なる会話を同時に有効化し、別threadを各ownerへ登録する', async () => {
  const h = harness([liveThread(threadA, turnA), liveThread(threadB, turnB)]);
  assert.equal((await setEnabled(h, ownerA)).ok, true);
  const idleStatus = await h.auto.getStatus(target.id, ownerB.ownerConversationId, ownerB.ownerTabId);
  assert.equal(idleStatus.state, 'off');
  assert.equal(idleStatus.failure, null);
  const results = await Promise.all([setEnabled(h, ownerB), setEnabled(h, ownerA)]);
  assert.deepEqual(results.map((result) => result.ok), [true, true]);
  assert.equal(entries(h).length, 2);
  assert.equal(await register(h, ownerA, [threadA]), 1);
  assert.equal(await register(h, ownerB, [threadB]), 1);
  assert.deepEqual((await h.monitor.list()).map(({ threadId, ownerConversationId }) => [threadId, ownerConversationId]), [
    [threadA, ownerA.ownerConversationId], [threadB, ownerB.ownerConversationId],
  ]);
  assert.equal((await h.auto.getStatus(target.id, ownerA.ownerConversationId, ownerA.ownerTabId)).failure, null);
  assert.equal((await h.auto.getStatus(target.id, ownerB.ownerConversationId, ownerB.ownerTabId)).failure, null);
});

test('有効な会話の設定を別会話の完了に流用せず、Bridge候補も照会しない', async () => {
  const h = harness([liveThread(threadA, turnA)]);
  await setEnabled(h, ownerA);
  assert.equal(await register(h, ownerB, [threadA]), 0);
  assert.equal(h.runningOnlyCalls, 0);
  assert.deepEqual(await h.monitor.list(), []);
});

test('同一会話の同時ON/OFFは最後の操作を反映し、別会話の設定とwatchを保持する', async () => {
  const h = harness([liveThread(threadA, turnA), liveThread(threadB, turnB)]);
  await setEnabled(h, ownerA);
  await setEnabled(h, ownerB);
  await register(h, ownerA, [threadA]);
  await register(h, ownerB, [threadB]);
  let release!: () => void;
  h.targetBarrier = new Promise<void>((resolve) => { release = resolve; });
  const before = h.targetCalls;
  const enableAgain = setEnabled(h, ownerA);
  while (h.targetCalls === before) await new Promise((resolve) => setImmediate(resolve));
  const disableLast = setEnabled(h, ownerA, false);
  release();
  await Promise.all([enableAgain, disableLast]);
  assert.equal(entries(h).find((entry) => entry.ownerConversationId === ownerA.ownerConversationId)?.enabled, false);
  assert.equal(entries(h).find((entry) => entry.ownerConversationId === ownerB.ownerConversationId)?.enabled, true);
  assert.equal((await h.monitor.list()).length, 2);
});

test('同じthreadへの並行登録はwatchの原子的所有権を保ち、移管しない', async () => {
  const h = harness([liveThread(threadA, turnA)]);
  await Promise.all([setEnabled(h, ownerA), setEnabled(h, ownerB)]);
  let release!: () => void;
  h.fetchBarrier = new Promise<void>((resolve) => { release = resolve; });
  const requests = [register(h, ownerA, [threadA]), register(h, ownerB, [threadA])];
  while (h.runningOnlyCalls === 0) await new Promise((resolve) => setImmediate(resolve));
  release();
  const results = await Promise.all(requests);
  assert.equal(results.reduce((sum, value) => sum + value, 0), 1);
  const watches = await h.monitor.list();
  assert.equal(watches.length, 1);
  assert.ok([ownerA.ownerConversationId, ownerB.ownerConversationId].includes(watches[0]!.ownerConversationId!));
  const winner = watches[0]!.ownerConversationId!;
  const loser = winner === ownerA.ownerConversationId ? ownerB : ownerA;
  assert.equal((await h.auto.getStatus(target.id, winner, winner === ownerA.ownerConversationId ? ownerA.ownerTabId : ownerB.ownerTabId)).failure, null);
  assert.equal((await h.auto.getStatus(target.id, loser.ownerConversationId, loser.ownerTabId)).failure, 'owner-conflict');
});

test('同一会話の登録中に行った停止は登録後のwatchを解除してskipを残す', async () => {
  const h = harness([liveThread(threadA, turnA)]);
  await setEnabled(h, ownerA);
  let release!: () => void;
  h.fetchBarrier = new Promise<void>((resolve) => { release = resolve; });
  const registering = register(h, ownerA, [threadA]);
  while (h.runningOnlyCalls === 0) await new Promise((resolve) => setImmediate(resolve));
  const stopping = h.auto.stopWatch('connection-A', target.id, threadA, ownerA.ownerConversationId);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  assert.equal(await registering, 1);
  assert.equal(await stopping, true);
  assert.deepEqual(await h.monitor.list(), []);
  assert.deepEqual(entries(h).find((entry) => entry.ownerConversationId === ownerA.ownerConversationId)?.skippedExecutions,
    [{ threadId: threadA, turnId: turnA }]);
});

test('同一threadの所有競合を表示しつつ、同じ回答の別候補は登録する', async () => {
  const h = harness([liveThread(threadA, turnA), liveThread(threadB, turnB)]);
  await setEnabled(h, ownerA);
  await setEnabled(h, ownerB);
  assert.equal(await register(h, ownerA, [threadA]), 1);
  assert.equal(await register(h, ownerB, [threadA, threadB]), 1);
  assert.deepEqual((await h.monitor.list()).map((item) => [item.threadId, item.ownerConversationId]), [
    [threadA, ownerA.ownerConversationId], [threadB, ownerB.ownerConversationId],
  ]);
  assert.equal((await h.auto.getStatus(target.id, ownerA.ownerConversationId, ownerA.ownerTabId)).failure, null);
  assert.equal((await h.auto.getStatus(target.id, ownerB.ownerConversationId, ownerB.ownerTabId)).failure, 'owner-conflict');
});

test('片方のOFF・skip・muteは他会話へ波及せず、OFFでもwatch/eventを保持する', async () => {
  const h = harness([liveThread(threadA, turnA), liveThread(threadB, turnB)]);
  await setEnabled(h, ownerA);
  await setEnabled(h, ownerB);
  await register(h, ownerA, [threadA]);
  await register(h, ownerB, [threadB]);
  h.mute.set(`${ownerA.ownerTabId}\u0000${ownerA.ownerConversationId}`, { muted: true, revision: 2 });
  await h.auto.updateOwnerMute(ownerA.ownerTabId, ownerA.ownerConversationId, true, 2);
  assert.equal(await h.auto.stopWatch('connection-A', target.id, threadB, ownerB.ownerConversationId), true);
  await setEnabled(h, ownerA, false);
  const state = entries(h);
  assert.equal(state.find((entry) => entry.ownerConversationId === ownerA.ownerConversationId)?.enabled, false);
  assert.equal(state.find((entry) => entry.ownerConversationId === ownerA.ownerConversationId)?.ownerMuted, true);
  assert.deepEqual(state.find((entry) => entry.ownerConversationId === ownerA.ownerConversationId)?.skippedExecutions, []);
  assert.equal(state.find((entry) => entry.ownerConversationId === ownerB.ownerConversationId)?.enabled, true);
  assert.equal(state.find((entry) => entry.ownerConversationId === ownerB.ownerConversationId)?.ownerMuted, false);
  assert.deepEqual(state.find((entry) => entry.ownerConversationId === ownerB.ownerConversationId)?.skippedExecutions,
    [{ threadId: threadB, turnId: turnB }]);
  assert.deepEqual((await h.monitor.list()).map((item) => item.threadId), [threadA]);
});

test('接続切替中の古い完了はその接続entryだけに失敗を記録する', async () => {
  const h = harness([liveThread(threadA, turnA)]);
  await setEnabled(h, ownerA);
  h.connectionId = 'connection-B';
  await setEnabled(h, ownerA);
  assert.equal(await register(h, ownerA, [threadA], 'connection-A', 'stale-old-connection'), 0);
  const oldEntry = entries(h).find((entry) => entry.connectionId === 'connection-A')!;
  const currentEntry = entries(h).find((entry) => entry.connectionId === 'connection-B')!;
  assert.equal(oldEntry.failure, 'connection-changed');
  assert.equal(currentEntry.failure, null);
  assert.equal((await h.auto.getStatus(target.id, ownerA.ownerConversationId, ownerA.ownerTabId)).failure, null);
  assert.deepEqual(await h.monitor.list(), []);
});

test('同一会話の閉じたowner tabだけを再bindし、別会話ownerは保持する', async () => {
  const h = harness([liveThread(threadA, turnA)]);
  await setEnabled(h, ownerA);
  await setEnabled(h, ownerB);
  h.owners.delete(ownerA.ownerTabId);
  h.rebindable.set(ownerA.ownerTabId, ownerA.ownerConversationId);
  h.owners.set(9, ownerA.ownerConversationId);
  assert.equal((await h.auto.setEnabled(target.id, 9, ownerA.ownerConversationId, true)).ok, true);
  assert.equal(entries(h).find((entry) => entry.ownerConversationId === ownerA.ownerConversationId)?.ownerTabId, 9);
  assert.equal(entries(h).find((entry) => entry.ownerConversationId === ownerB.ownerConversationId)?.ownerTabId, ownerB.ownerTabId);
  assert.equal((await h.auto.getStatus(target.id, ownerB.ownerConversationId, ownerB.ownerTabId)).state, 'ready');
});

test('ON検証中にowner tabが別会話へ移動した場合は設定を保存しない', async () => {
  const h = harness([]);
  let release!: () => void;
  h.targetBarrier = new Promise<void>((resolve) => { release = resolve; });
  const before = h.targetCalls;
  const pending = setEnabled(h, ownerA);
  while (h.targetCalls === before) await new Promise((resolve) => setImmediate(resolve));
  h.owners.set(ownerA.ownerTabId, ownerB.ownerConversationId);
  release();
  assert.deepEqual(await pending, { ok: false, reason: 'owner-tab-unavailable' });
  assert.equal(CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY in h.storage.values, false);
});

test('片方のrunning_only失敗は同じ接続の他会話statusへ波及しない', async () => {
  const h = harness([liveThread(threadA, turnA)]);
  await Promise.all([setEnabled(h, ownerA), setEnabled(h, ownerB)]);
  h.fetchFailure = Object.assign(new Error('temporary timeout'), { code: 'timeout' });
  assert.equal(await register(h, ownerA, [threadA]), 0);
  assert.equal((await h.auto.getStatus(target.id, ownerA.ownerConversationId, ownerA.ownerTabId)).failure, 'timeout');
  assert.equal((await h.auto.getStatus(target.id, ownerB.ownerConversationId, ownerB.ownerTabId)).failure, null);
  assert.deepEqual(await h.monitor.list(), []);
});

test('旧v1 entryを書き換えても別会話entryと既存watch/eventを保持する', async () => {
  const h = harness([]);
  const legacy: AutoEntry = { ...autoEntry(ownerA, false),
    skippedExecutions: [{ threadId: threadA, turnId: turnA }] };
  h.storage.values[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY] = { version: 1, entries: [legacy] };
  const watch = { watchId: 'watch-existing', connectionId: 'connection-A', targetId: target.id, threadId: threadA,
    enabled: true, baselineCaptured: false, baselineTurnKind: 'unknown', baselineTurnId: null, baselineTurnStatus: null,
    lastObservedTurnId: null, statusState: null, lastTurnStatus: null, lastTurnEvidence: null,
    currentExecutionState: null, currentExecutionEvidence: null, currentExecutionReason: null, currentExecutionTurnId: null,
    terminalHoldReason: null, needsAttention: null, turnChange: 'unknown', observedAt: null, lastSuccessAt: null,
    fetchOutcome: 'unknown', nextPollAt: 0, failureCount: 0, ownerTabId: ownerA.ownerTabId,
    ownerConversationId: ownerA.ownerConversationId, ownerMuted: false, ownerMuteRevision: 0 };
  const event = { eventId: 'event-existing', watchId: 'watch-existing', connectionId: 'connection-A', targetId: target.id,
    threadId: threadA, turnId: turnA, status: 'completed', detectedAt: '2026-11-24T00:00:00.000Z',
    notificationState: 'played', notificationReason: null, ownerTabId: ownerA.ownerTabId,
    ownerConversationId: ownerA.ownerConversationId, ownerMuted: false, ownerMuteRevision: 0 };
  h.storage.values[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY] = { version: 2, items: [watch], events: [event] };
  assert.equal((await setEnabled(h, ownerB)).ok, true);
  assert.deepEqual(entries(h).find((entry) => entry.ownerConversationId === ownerA.ownerConversationId)?.skippedExecutions,
    [{ threadId: threadA, turnId: turnA }]);
  assert.equal(entries(h).find((entry) => entry.ownerConversationId === ownerB.ownerConversationId)?.enabled, true);
  const monitorState = h.storage.values[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY] as { items: unknown[]; events: unknown[] };
  assert.deepEqual(monitorState.items, [watch]);
  assert.deepEqual(monitorState.events, [event]);
});
