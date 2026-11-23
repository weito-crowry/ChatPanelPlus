import assert from 'node:assert/strict';
import test from 'node:test';
import { CODEX_BRIDGE_AUTO_WATCH_ALARM, CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY } from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeTarget, CodexBridgeThread, CodexBridgeThreadPage, CodexBridgeThreadStatus } from '../src/shared/codexbridge-mcp-protocol.ts';
import { CodexBridgeAutoThreadRegistration } from '../src/background/thread-monitor-auto-registration.ts';
import { CodexBridgeThreadMonitor } from '../src/background/thread-monitor.ts';

class FakeStorage {
  readonly values: Record<string, unknown> = {};
  async get(keys: string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.filter((key) => key in this.values)
      .map((key) => [key, structuredClone(this.values[key])]));
  }
  async set(items: Record<string, unknown>): Promise<void> { Object.assign(this.values, structuredClone(items)); }
}

class FakeAlarms {
  readonly names = new Set<string>();
  lastInfo: { delayInMinutes: number; periodInMinutes: number } | null = null;
  async get(name: string): Promise<unknown> { return this.names.has(name) ? { name } : undefined; }
  create(name: string, info: { delayInMinutes: number; periodInMinutes: number }): void { this.names.add(name); this.lastInfo = info; }
  async clear(name: string): Promise<boolean> { return this.names.delete(name); }
}

const ownerA = { ownerTabId: 4, ownerConversationId: 'conversation-A', ownerMuted: false, ownerMuteRevision: 0 } as const;
const target: CodexBridgeTarget = { id: 'target-1', name: 'Workstation', kind: 'local', available: true };

function liveThread(id: string, turnId: string): CodexBridgeThread {
  return {
    targetId: target.id, id, title: id, preview: null, cwd: null, updatedAt: null,
    currentExecution: { turnId, state: 'in_progress', evidence: 'live', reason: null, observedAt: null, needsAttention: false },
    lastTurn: { turnId: 'older-turn', status: 'completed', category: null, evidence: 'live', reason: null, observedAt: null, needsAttention: false },
    needsAttention: false,
  };
}

function harness(initialThreads: readonly CodexBridgeThread[] = []) {
  const storage = new FakeStorage();
  const alarms = new FakeAlarms();
  let now = Date.parse('2026-11-23T00:00:00.000Z');
  let threads = [...initialThreads];
  let connectionId = 'connection-A';
  let scanCalls = 0;
  const scanTargets: string[] = [];
  let statusOverride: CodexBridgeThreadStatus | null = null;
  let targets: readonly CodexBridgeTarget[] = [target];
  let scanFailure: Error | null = null;
  let mute: { ok: true; muted: boolean; revision: number } | { ok: false } = { ok: true, muted: false, revision: 0 };
  let ownerTabValid = true;
  let scanBarrier: Promise<void> | null = null;
  const resolveAccess = async () => ({
    connectionId,
    readStatus: async (targetId: string, threadId: string) => statusOverride ?? ({
      targetId, threadId, state: 'in_progress', currentExecution: null,
      lastTurn: { turnId: 'active-turn', status: 'in_progress' as const, category: null,
        evidence: 'live', reason: null, observedAt: null, needsAttention: false }, needsAttention: false,
    }),
    readTargets: async () => targets,
    readRunningThreads: async (targetId: string): Promise<CodexBridgeThreadPage> => {
      scanCalls += 1;
      scanTargets.push(targetId);
      if (scanBarrier) await scanBarrier;
      if (scanFailure) throw scanFailure;
      return { threads, nextCursor: null };
    },
  });
  let watchId = 0;
  const monitor = new CodexBridgeThreadMonitor(storage, alarms, resolveAccess, {
    now: () => now, createWatchId: () => `watch-${++watchId}`,
  });
  const auto = new CodexBridgeAutoThreadRegistration(
    storage, alarms, monitor, resolveAccess,
    async () => mute,
    async () => ownerTabValid,
    { now: () => now },
  );
  return {
    storage, alarms, monitor, auto,
    get scanCalls() { return scanCalls; },
    get scanTargets() { return [...scanTargets]; },
    get currentThreads() { return [...threads]; },
    set connectionId(value: string) { connectionId = value; },
    set statusOverride(value: typeof statusOverride) { statusOverride = value; },
    set threads(value: readonly CodexBridgeThread[]) { threads = [...value]; },
    set targets(value: readonly CodexBridgeTarget[]) { targets = value; },
    set scanFailure(value: Error | null) { scanFailure = value; },
    set mute(value: typeof mute) { mute = value; },
    set ownerTabValid(value: boolean) { ownerTabValid = value; },
    set scanBarrier(value: Promise<void> | null) { scanBarrier = value; },
    now: () => now,
    advance(milliseconds: number) { now += milliseconds; },
  };
}

test('初期OFFでは探索せず、ONにした時点のlive実行threadを通常watchへ登録する', async () => {
  const h = harness([liveThread('thread-live', 'turn-live')]);
  const off = await h.auto.getStatus(target.id, ownerA.ownerConversationId);
  assert.equal(off.enabled, false);
  assert.equal(h.scanCalls, 0);
  const enabled = await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true);
  assert.equal(enabled.ok, true);
  const items = await h.monitor.list();
  assert.equal(items.length, 1);
  assert.equal(items[0]?.threadId, 'thread-live');
  assert.equal(items[0]?.ownerConversationId, ownerA.ownerConversationId);
  assert.equal(items[0]?.baselineTurnId, 'turn-live');
  assert.equal(items[0]?.lastTurnStatus, 'in_progress');
  assert.ok(CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY in h.storage.values);
});

test('ON後に新しく実行を開始したlive threadを次回foreground探索で登録する', async () => {
  const h = harness();
  assert.equal((await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true)).ok, true);
  assert.deepEqual(await h.monitor.list(), []);
  h.threads = [liveThread('newly-started', 'turn-new')];
  h.advance(5_000);
  await h.auto.scanForeground(ownerA.ownerConversationId);
  const items = await h.monitor.list();
  assert.equal(items.length, 1);
  assert.equal(items[0]?.threadId, 'newly-started');
  assert.equal(items[0]?.baselineTurnId, 'turn-new');
});

test('estimated・inferred・terminal・unknown・last_turnだけの候補は登録しない', async () => {
  const estimated = { ...liveThread('estimated', 'turn-e'), currentExecution: { ...liveThread('estimated', 'turn-e').currentExecution!, state: 'estimated_running', evidence: 'live' } };
  const inferred = { ...liveThread('inferred', 'turn-i'), currentExecution: { ...liveThread('inferred', 'turn-i').currentExecution!, evidence: 'inferred' } };
  const terminal = { ...liveThread('terminal', 'turn-t'), currentExecution: null };
  const unknown = { ...liveThread('unknown', 'turn-u'), currentExecution: { ...liveThread('unknown', 'turn-u').currentExecution!, state: 'unknown', evidence: 'live' } };
  const lastTurnOnly = { ...liveThread('last-only', 'turn-l'), currentExecution: null };
  const h = harness([estimated, inferred, terminal, unknown, lastTurnOnly]);
  const result = await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true);
  assert.equal(result.ok, true);
  assert.deepEqual(await h.monitor.list(), []);
});

test('同一対象の他会話ONは拒否し、manual/他owner/ownerless watchを自動処理で移管しない', async () => {
  const h = harness([liveThread('thread-live', 'turn-live'), liveThread('manual-other', 'turn-m'), liveThread('legacy', 'turn-l')]);
  await h.monitor.startWatch('target-1', 'manual-other', {
    ownerTabId: 8, ownerConversationId: 'conversation-B', ownerMuted: false, ownerMuteRevision: 0,
  });
  await h.monitor.startWatch('target-1', 'legacy');
  const enabledA = await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true);
  assert.equal(enabledA.ok, true);
  const saved = h.storage.values[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY] as { entries: Array<{ enabled: boolean; ownerConversationId: string }> };
  assert.deepEqual(saved.entries.map(({ enabled, ownerConversationId }) => ({ enabled, ownerConversationId })), [
    { enabled: true, ownerConversationId: ownerA.ownerConversationId },
  ]);
  const enabledB = await h.auto.setEnabled(target.id, 9, 'conversation-B', true);
  assert.deepEqual(enabledB, { ok: false, reason: 'auto-owner-conflict' });
  const items = await h.monitor.list();
  assert.equal(items.find((item) => item.threadId === 'manual-other')?.ownerConversationId, 'conversation-B');
  assert.equal(items.find((item) => item.threadId === 'legacy')?.ownerConversationId, undefined);
  assert.equal(items.find((item) => item.threadId === 'thread-live')?.ownerConversationId, ownerA.ownerConversationId);
});

test('手動解除したexecutionはworker再生成後も抑止し、新しいturnだけ再登録する', async () => {
  const h = harness([liveThread('thread-live', 'turn-one')]);
  assert.equal((await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true)).ok, true);
  assert.equal(await h.auto.stopWatch('connection-A', target.id, 'thread-live', ownerA.ownerConversationId), true);
  const restarted = new CodexBridgeAutoThreadRegistration(h.storage, h.alarms, h.monitor,
    async () => ({ connectionId: 'connection-A', readTargets: async () => [target],
      readRunningThreads: async () => ({ threads: h.currentThreads, nextCursor: null }) }),
    async () => ({ ok: true, muted: false, revision: 0 }), async () => true, { now: h.now });
  await restarted.scanForeground(ownerA.ownerConversationId);
  assert.deepEqual(await h.monitor.list(), []);
  h.threads = [liveThread('thread-live', 'turn-two')];
  h.advance(5_000);
  await restarted.scanForeground(ownerA.ownerConversationId);
  assert.equal((await h.monitor.list()).length, 1);
  assert.equal((await h.monitor.list())[0]?.baselineTurnId, 'turn-two');
});

test('自動登録でも手動解除のowner認可を守り、turn idが不明なら同threadのlive継続中は抑止する', async () => {
  const candidate = { ...liveThread('thread-live', 'turn-one'),
    currentExecution: { ...liveThread('thread-live', 'turn-one').currentExecution!, turnId: null } };
  const h = harness([candidate]);
  assert.equal((await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true)).ok, true);
  assert.equal(await h.auto.stopWatch('connection-A', target.id, 'thread-live', 'conversation-B'), false);
  assert.equal((await h.monitor.list()).length, 1);
  assert.equal(await h.auto.stopWatch('connection-A', target.id, 'thread-live', ownerA.ownerConversationId), true);
  h.advance(5_000);
  h.threads = [liveThread('thread-live', 'turn-two')];
  await h.auto.scanForeground(ownerA.ownerConversationId);
  assert.deepEqual(await h.monitor.list(), []);
  h.advance(5_000);
  h.threads = [];
  await h.auto.scanForeground(ownerA.ownerConversationId);
  h.advance(5_000);
  h.threads = [liveThread('thread-live', 'turn-three')];
  await h.auto.scanForeground(ownerA.ownerConversationId);
  assert.equal((await h.monitor.list())[0]?.baselineTurnId, 'turn-three');
});

test('live executionにturn idがなければwatchは登録するが、古いterminal turnをbaselineに流用しない', async () => {
  const candidate = { ...liveThread('thread-live', 'turn-one'),
    currentExecution: { ...liveThread('thread-live', 'turn-one').currentExecution!, turnId: null } };
  const h = harness([candidate]);
  assert.equal((await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true)).ok, true);
  const [item] = await h.monitor.list();
  assert.ok(item);
  assert.equal(item.baselineTurnKind, 'unknown');
  assert.equal(item.baselineTurnId, null);
  assert.equal(item.baselineTurnStatus, 'in_progress');
});

test('OFFは既存watchを残し、Bridge探索失敗は0件でなくbackoff付きerrorとして保存する', async () => {
  const h = harness([liveThread('thread-live', 'turn-live')]);
  assert.equal((await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true)).ok, true);
  const watchId = (await h.monitor.list())[0]?.watchId;
  assert.equal((await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, false)).ok, true);
  assert.equal((await h.monitor.list())[0]?.watchId, watchId);
  h.scanFailure = Object.assign(new Error('unsupported'), { code: 'running-only-unsupported' });
  assert.equal((await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true)).ok, true);
  const failed = await h.auto.getStatus(target.id, ownerA.ownerConversationId);
  assert.equal(failed.enabled, true);
  assert.equal(failed.state, 'error');
  assert.equal(failed.liveThreadCount, null);
  assert.equal(failed.failure, 'running-only-unsupported');
  const requests = h.scanCalls;
  await h.auto.scanForeground(ownerA.ownerConversationId);
  assert.equal(h.scanCalls, requests);
});

test('別targetは独立し、owner tab muteが不明なら新規watchもmute不明で登録する', async () => {
  const h = harness([liveThread('thread-live', 'turn-live')]);
  h.mute = { ok: false };
  assert.equal((await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true)).ok, true);
  const item = (await h.monitor.list())[0];
  assert.equal(item?.ownerMuted, null);
  const independent = await h.auto.getStatus('target-2', ownerA.ownerConversationId);
  assert.equal(independent.enabled, false);
});

test('複数live threadを同じownerへ登録し、別owner foreground scanは対象外', async () => {
  const h = harness([liveThread('thread-one', 'turn-one'), liveThread('thread-two', 'turn-two')]);
  assert.equal((await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true)).ok, true);
  assert.deepEqual((await h.monitor.list()).map((item) => item.threadId).sort(), ['thread-one', 'thread-two']);
  const calls = h.scanCalls;
  h.advance(5_000);
  await h.auto.scanForeground('conversation-B');
  assert.equal(h.scanCalls, calls);
  await h.auto.scanForeground(ownerA.ownerConversationId);
  assert.equal(h.scanCalls, calls + 1);
});

test('foreground探索は5秒、worker alarmは30秒で再開し、同一targetの重複flightを束ねる', async () => {
  const h = harness([liveThread('thread-live', 'turn-live')]);
  assert.equal((await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true)).ok, true);
  assert.ok(h.alarms.names.has(CODEX_BRIDGE_AUTO_WATCH_ALARM));
  assert.deepEqual(h.alarms.lastInfo, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
  const firstScanCount = h.scanCalls;
  h.advance(4_999);
  await h.auto.scanBackground();
  assert.equal(h.scanCalls, firstScanCount);
  h.advance(1);
  await h.auto.scanForeground(ownerA.ownerConversationId);
  assert.equal(h.scanCalls, firstScanCount + 1);
  h.advance(30_000);
  await h.auto.scanBackground();
  assert.equal(h.scanCalls, firstScanCount + 2);

  let release!: () => void;
  h.scanBarrier = new Promise<void>((resolve) => { release = resolve; });
  h.advance(30_000);
  const before = h.scanCalls;
  const a = h.auto.scanForeground(ownerA.ownerConversationId);
  const b = h.auto.scanForeground(ownerA.ownerConversationId);
  while (h.scanCalls === before) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(h.scanCalls, before + 1);
  release(); h.scanBarrier = null;
  await Promise.all([a, b]);
});

test('owner tab route不一致時、自動登録watchのmuteはnullへ倒す', async () => {
  const h = harness([liveThread('thread-live', 'turn-live')]);
  h.ownerTabValid = false;
  assert.equal((await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true)).ok, true);
  assert.equal((await h.monitor.list())[0]?.ownerMuted, null);
});

test('不正な自動設定データはerrorにし、既存valueを上書きしない', async () => {
  const h = harness([liveThread('thread-live', 'turn-live')]);
  const corrupt = { version: 99, entries: [] };
  h.storage.values[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY] = corrupt;
  const result = await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true);
  assert.deepEqual(result, { ok: false, reason: 'storage-error' });
  assert.deepEqual(h.storage.values[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY], corrupt);
  assert.deepEqual(await h.monitor.list(), []);
});

test('known targetを確認できないON要求は保存せずerrorで拒否する', async () => {
  const h = harness([liveThread('thread-live', 'turn-live')]);
  h.targets = [];
  assert.deepEqual(await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true), {
    ok: false, reason: 'target-unavailable',
  });
  assert.equal(CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY in h.storage.values, false);
  assert.deepEqual(await h.monitor.list(), []);
});

test('targetごとの設定は独立し、接続先変更中も古いON状態をOFFにできる', async () => {
  const secondTarget: CodexBridgeTarget = { id: 'target-2', name: 'Remote', kind: 'remote', available: true };
  const h = harness([liveThread('local-thread', 'turn-local'), { ...liveThread('remote-thread', 'turn-remote'), targetId: secondTarget.id }]);
  h.targets = [target, secondTarget];
  assert.equal((await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true)).ok, true);
  assert.equal((await h.auto.setEnabled(secondTarget.id, ownerA.ownerTabId, ownerA.ownerConversationId, true)).ok, true);
  assert.deepEqual((await h.monitor.list()).map((item) => item.targetId).sort(), ['target-1', 'target-2']);
  h.connectionId = 'connection-B';
  const stale = await h.auto.getStatus(target.id, ownerA.ownerConversationId);
  assert.equal(stale.enabled, true);
  assert.equal(stale.state, 'error');
  assert.equal(stale.failure, 'connection-changed');
  assert.equal((await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, false)).ok, true);
  assert.equal((await h.monitor.list()).length, 2);
});

test('running_onlyのlive baselineからterminal遷移すると既存のC45 event化とauto-unwatchへ渡す', async () => {
  const h = harness([liveThread('thread-live', 'turn-live')]);
  assert.equal((await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true)).ok, true);
  h.statusOverride = {
    targetId: target.id, threadId: 'thread-live', state: 'idle', currentExecution: null,
    lastTurn: { turnId: 'turn-live', status: 'completed', category: null, evidence: 'live', reason: null,
      observedAt: null, needsAttention: false }, needsAttention: false,
  };
  h.advance(5_000);
  await h.monitor.refreshForeground();
  assert.deepEqual(await h.monitor.list(), []);
  const events = await h.monitor.listEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.turnId, 'turn-live');
  assert.equal(events[0]?.ownerConversationId, ownerA.ownerConversationId);
});

test('上限32件では残りwatchを変更せず、自動登録状態にwatch-limitを表示する', async () => {
  const h = harness([liveThread('new-thread', 'turn-new')]);
  for (let index = 0; index < 32; index += 1) {
    const result = await h.monitor.startWatch(target.id, `existing-${index}`, ownerA);
    assert.equal(result.ok, true);
  }
  assert.equal((await h.monitor.list()).length, 32);
  const result = await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.status.failure, 'watch-limit');
  assert.equal((await h.monitor.list()).length, 32);
});

test('ネットワーク失敗はbackoff中に再照会せず、回復後は自動登録を再開する', async () => {
  const h = harness([liveThread('thread-live', 'turn-live')]);
  h.scanFailure = new Error('network unavailable');
  const enabled = await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true);
  assert.equal(enabled.ok, true);
  if (enabled.ok) {
    assert.equal(enabled.status.state, 'error');
    assert.equal(enabled.status.liveThreadCount, null);
  }
  const failedRequests = h.scanCalls;
  h.advance(29_999);
  await h.auto.scanForeground(ownerA.ownerConversationId);
  assert.equal(h.scanCalls, failedRequests);
  h.scanFailure = null;
  h.advance(1);
  await h.auto.scanForeground(ownerA.ownerConversationId);
  assert.equal(h.scanCalls, failedRequests + 1);
  assert.equal((await h.monitor.list())[0]?.threadId, 'thread-live');
});

test('worker restoreは永続ON設定とalarmを復元し、期限到来分だけ探索する', async () => {
  const h = harness([liveThread('thread-live', 'turn-live')]);
  assert.equal((await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true)).ok, true);
  let restartScans = 0;
  const restarted = new CodexBridgeAutoThreadRegistration(h.storage, h.alarms, h.monitor,
    async () => ({ connectionId: 'connection-A', readTargets: async () => [target],
      readRunningThreads: async () => { restartScans += 1; return { threads: h.currentThreads, nextCursor: null }; } }),
    async () => ({ ok: true, muted: false, revision: 0 }), async () => true, { now: h.now });
  h.advance(30_000);
  const saved = h.storage.values[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY] as { entries: Array<{ nextScanAt: number }> };
  assert.ok(saved.entries[0]!.nextScanAt <= h.now());
  await restarted.restore();
  assert.ok(h.alarms.names.has(CODEX_BRIDGE_AUTO_WATCH_ALARM));
  assert.equal(restartScans, 1);
});

test('running_only応答待ちに接続先が変われば、候補を新接続のwatchへ誤登録しない', async () => {
  const h = harness();
  assert.equal((await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true)).ok, true);
  h.threads = [liveThread('raced-thread', 'turn-raced')];
  let release!: () => void;
  h.scanBarrier = new Promise<void>((resolve) => { release = resolve; });
  h.advance(5_000);
  const scans = h.scanCalls;
  const scan = h.auto.scanForeground(ownerA.ownerConversationId);
  while (h.scanCalls === scans) await new Promise((resolve) => setTimeout(resolve, 0));
  h.connectionId = 'connection-B';
  release(); h.scanBarrier = null;
  await scan;
  assert.deepEqual(await h.monitor.list(), []);
  const status = await h.auto.getStatus(target.id, ownerA.ownerConversationId);
  assert.equal(status.failure, 'connection-changed');
});

test('1周期12targetの上限を超えても、古く期限切れのtargetを次周期に先行する', async () => {
  const h = harness();
  const targets = [target, ...Array.from({ length: 12 }, (_, index) => ({
    id: `target-${index + 2}`, name: `Remote ${index + 2}`, kind: 'remote' as const, available: true,
  }))];
  h.targets = targets;
  for (const currentTarget of targets) {
    assert.equal((await h.auto.setEnabled(currentTarget.id, ownerA.ownerTabId, ownerA.ownerConversationId, true)).ok, true);
  }
  const before = h.scanCalls;
  h.advance(30_000);
  await h.auto.scanBackground();
  assert.equal(h.scanCalls, before + 12);
  const afterFirstCycle = h.scanCalls;
  h.advance(30_000);
  await h.auto.scanBackground();
  assert.equal(h.scanCalls, afterFirstCycle + 12);
  assert.equal(h.scanTargets[afterFirstCycle], 'target-13');
});
