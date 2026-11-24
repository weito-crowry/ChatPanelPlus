import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_BRIDGE_THREAD_MONITOR_ALARM,
  CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY,
  type CodexBridgeTerminalEvent,
} from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import { CodexBridgeThreadMonitor, type CodexBridgeNotificationHandler } from '../src/background/thread-monitor.ts';
import type { CodexBridgeLastTurn, CodexBridgeThreadStatus } from '../src/shared/codexbridge-mcp-protocol.ts';

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
  create(): void { this.active = true; }
  async clear(): Promise<boolean> { this.active = false; return true; }
}

function status(
  turnId: string | null,
  state: CodexBridgeLastTurn['status'] = null,
  currentExecution: CodexBridgeThreadStatus['currentExecution'] = null,
  evidence: string | null = 'live',
  threadState: string | null = 'idle',
): CodexBridgeThreadStatus {
  return {
    targetId: 'target-1', threadId: 'thread-1', state: threadState, currentExecution, needsAttention: false,
    lastTurn: turnId === null ? null : {
      turnId, status: state, category: null, evidence, reason: null, observedAt: null, needsAttention: false,
    },
  };
}

function harness(initial: CodexBridgeThreadStatus, notification?: CodexBridgeNotificationHandler, area = new MemoryStorage()) {
  const storage = area;
  const alarms = new MemoryAlarms();
  let current = initial;
  let failure: Error | null = null;
  let now = Date.parse('2026-11-20T00:00:00.000Z');
  let sequence = 0;
  let calls = 0;
  const monitor = new CodexBridgeThreadMonitor(storage, alarms, async () => ({
    connectionId: 'connection-A',
    async readStatus() { calls += 1; if (failure) throw failure; return current; },
  }), {
    now: () => now,
    createWatchId: () => `id-${++sequence}`,
    createEventId: () => `event-${++sequence}`,
    notification,
  });
  return {
    monitor, storage, alarms,
    setStatus(value: CodexBridgeThreadStatus) { current = value; },
    setFailure(value: Error | null) { failure = value; },
    advance(milliseconds: number) { now += milliseconds; },
    get calls() { return calls; },
    now: () => now,
  };
}

test('a completed baseline does not create an event or prepare audio', async () => {
  let preparationCalls = 0;
  const notification: CodexBridgeNotificationHandler = {
    async prepare() {
      preparationCalls += 1;
      return { state: 'ready', async play() { return { ok: true }; } };
    },
  };
  const h = harness(status('turn-a', 'completed'), notification);
  const result = await h.monitor.startWatch('target-1', 'thread-1');
  assert.equal(result.ok, true);
  assert.equal((await h.monitor.listEvents()).length, 0);
  assert.equal((await h.monitor.list()).length, 1);
  assert.equal(h.alarms.active, true);
  assert.equal(preparationCalls, 0);
  assert.ok(CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY in h.storage.values);

  h.advance(120_000);
  await h.monitor.refreshAlarm();
  assert.equal((await h.monitor.listEvents()).length, 0);
  assert.equal((await h.monitor.list()).length, 1);
});

test('an actively observed baseline turn and a later new terminal turn notify once', async () => {
  let notificationCalls = 0;
  const storage = new MemoryStorage();
  const notification: CodexBridgeNotificationHandler = {
    async prepare() {
      return { state: 'ready', async play() {
        const saved = storage.values[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY] as { events: Array<{ notificationState: string }> };
        assert.equal(saved.events.at(-1)?.notificationState, 'requested');
        notificationCalls += 1;
        return { ok: true };
      } };
    },
  };
  const h = harness(status('turn-a', 'in_progress'), notification, storage);
  const started = await h.monitor.startWatch('target-1', 'thread-1');
  assert.equal(started.ok, true);
  assert.equal((await h.monitor.listEvents()).length, 0);
  h.setStatus(status('turn-a', 'completed'));
  h.advance(30_000);
  await Promise.all([h.monitor.refreshAlarm(), h.monitor.refreshForeground(), h.monitor.refreshForeground()]);
  const events = await h.monitor.listEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.status, 'completed');
  assert.equal(events[0]?.turnId, 'turn-a');
  assert.equal(events[0]?.notificationState, 'played');
  assert.equal(notificationCalls, 1);
  assert.deepEqual(await h.monitor.list(), []);
  assert.equal(h.alarms.active, false);
});

test('終端後の再登録は新しいwatchになり、過去eventとowner別権限を維持する', async () => {
  const h = harness(status('turn-a', 'in_progress'));
  const ownerA = { ownerTabId: 4, ownerConversationId: 'conversation-A', ownerMuted: false, ownerMuteRevision: 0 } as const;
  const sameConversationOtherTab = { ...ownerA, ownerTabId: 9, ownerMuted: true, ownerMuteRevision: 3 } as const;
  const ownerB = { ownerTabId: 10, ownerConversationId: 'conversation-B', ownerMuted: false, ownerMuteRevision: 0 } as const;
  const first = await h.monitor.startWatch('target-1', 'thread-1', ownerA);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual({ tabId: first.item.ownerTabId, conversationId: first.item.ownerConversationId, muted: first.item.ownerMuted },
    { tabId: 4, conversationId: 'conversation-A', muted: false });
  const duplicate = await h.monitor.startWatch('target-1', 'thread-1', sameConversationOtherTab);
  assert.equal(duplicate.ok && duplicate.created, false);
  if (duplicate.ok) assert.equal(duplicate.item.ownerTabId, 4);

  h.setStatus(status('turn-a', 'completed'));
  h.advance(30_000);
  await h.monitor.refreshAlarm();
  const beforeTransfer = (await h.monitor.listEvents())[0]!;
  assert.equal((await h.monitor.listEvents())[0]?.ownerConversationId, 'conversation-A');
  const previousEvent = (await h.monitor.listEvents())[0]!;
  assert.equal(await h.monitor.clearEvents('conversation-B', [previousEvent.eventId]), false);
  assert.equal(await h.monitor.stopWatch('connection-A', 'target-1', 'thread-1', 'conversation-A'), false);
  assert.equal(await h.monitor.updateOwnerMute(4, 'conversation-A', true, 1), undefined);

  const nextWatch = await h.monitor.startWatch('target-1', 'thread-1', ownerB);
  assert.equal(nextWatch.ok, true);
  if (!nextWatch.ok) return;
  assert.equal(nextWatch.created, true);
  assert.equal(nextWatch.transferred, false);
  assert.notEqual(nextWatch.item.watchId, first.item.watchId);
  assert.equal(nextWatch.item.lastObservedTurnId, 'turn-a');
  assert.equal(nextWatch.item.ownerConversationId, 'conversation-B');
  assert.equal(nextWatch.item.ownerMuted, false);

  assert.equal(await h.monitor.updateOwnerMute(10, 'conversation-B', true, 2), undefined);
  assert.equal((await h.monitor.read('connection-A', 'target-1', 'thread-1'))?.ownerMuted, true);
  const sameOwnerAgain = await h.monitor.startWatch('target-1', 'thread-1', { ...ownerB, ownerTabId: 12, ownerMuted: false });
  assert.equal(sameOwnerAgain.ok && sameOwnerAgain.transferred, false);
  if (sameOwnerAgain.ok) assert.deepEqual([sameOwnerAgain.item.ownerTabId, sameOwnerAgain.item.ownerMuted], [10, true]);

  assert.equal(await h.monitor.stopWatch('connection-A', 'target-1', 'thread-1', 'conversation-B'), true);
  const reassigned = await h.monitor.startWatch('target-1', 'thread-1', { ...ownerB, ownerMuted: true, ownerMuteRevision: 2 });
  assert.equal(reassigned.ok, true);
  if (reassigned.ok) assert.equal(reassigned.item.lastObservedTurnId, 'turn-a');

  h.setStatus(status('turn-b', 'in_progress'));
  h.advance(30_000);
  await h.monitor.refreshAlarm();
  h.setStatus(status('turn-b', 'failed'));
  h.advance(30_000);
  await h.monitor.refreshAlarm();
  const events = await h.monitor.listEvents();
  assert.equal(events.find((event) => event.turnId === 'turn-a')?.ownerConversationId, 'conversation-A');
  assert.equal(events.find((event) => event.turnId === 'turn-b')?.ownerConversationId, 'conversation-B');
  assert.equal(events.find((event) => event.turnId === 'turn-b')?.ownerMuted, true);
  assert.equal(await h.monitor.clearEvents('conversation-A', [previousEvent.eventId]), true);
  assert.deepEqual((await h.monitor.listEvents()).map((event) => event.turnId), ['turn-b']);
  assert.equal(beforeTransfer.ownerConversationId, 'conversation-A');
  assert.deepEqual(await h.monitor.list(), []);
  assert.equal((await h.monitor.listEvents()).length, 1);
});

test('event ACK is owner-scoped and idempotent while a concurrent new event remains unconfirmed', async () => {
  const h = harness(status('turn-a', 'in_progress'));
  const owner = { ownerTabId: 4, ownerConversationId: 'conversation-A', ownerMuted: false, ownerMuteRevision: 0 } as const;
  await h.monitor.startWatch('target-1', 'thread-1', owner);
  h.setStatus(status('turn-a', 'completed'));
  h.advance(30_000);
  await h.monitor.refreshAlarm();
  const first = (await h.monitor.listEvents())[0]!;
  assert.equal(await h.monitor.acknowledgeEvents('conversation-B', [first.eventId], '2026-11-21T00:00:00.000Z'), false);
  assert.equal(await h.monitor.acknowledgeEvents('conversation-A', [first.eventId], '2026-11-21T00:00:00.000Z'), true);
  assert.equal(await h.monitor.acknowledgeEvents('conversation-A', [first.eventId], '2026-11-21T00:01:00.000Z'), true);
  await h.monitor.startWatch('target-1', 'thread-1', owner);
  h.setStatus(status('turn-b', 'in_progress'));
  h.advance(30_000);
  await h.monitor.refreshAlarm();
  h.setStatus(status('turn-b', 'failed'));
  h.advance(30_000);
  await h.monitor.refreshAlarm();
  const events = await h.monitor.listEvents();
  assert.equal(events.find((event) => event.eventId === first.eventId)?.acknowledgedAt, '2026-11-21T00:00:00.000Z');
  assert.equal(events.filter((event) => !event.acknowledgedAt).length, 1);
});

test('通知clearはowner eventだけを削除しwatch解除後も新着・他owner eventを保持する', async () => {
  const h = harness(status('turn-a', 'in_progress'));
  const owner = { ownerTabId: 4, ownerConversationId: 'conversation-A', ownerMuted: false, ownerMuteRevision: 0 } as const;
  await h.monitor.startWatch('target-1', 'thread-1', owner);
  h.setStatus(status('turn-a', 'completed'));
  h.advance(30_000);
  await h.monitor.refreshAlarm();
  const original = (await h.monitor.listEvents())[0]!;
  assert.equal(await h.monitor.clearEvents('conversation-B', [original.eventId]), false);
  assert.equal((await h.monitor.listEvents()).length, 1);

  const foreign: CodexBridgeTerminalEvent = {
    ...original, eventId: 'foreign-event', turnId: 'turn-foreign', ownerTabId: 9, ownerConversationId: 'conversation-B',
  };
  const concurrent: CodexBridgeTerminalEvent = { ...original, eventId: 'new-event', turnId: 'turn-new' };
  const saved = h.storage.values[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY] as { version: number; items: unknown[]; events: CodexBridgeTerminalEvent[] };
  await h.storage.set({ [CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY]: { ...saved, events: [...saved.events, foreign, concurrent] } });

  assert.equal(await h.monitor.clearEvents('conversation-A', [original.eventId]), true);
  assert.deepEqual((await h.monitor.listEvents()).map((event) => event.eventId).sort(), ['foreign-event', 'new-event']);
  assert.deepEqual(await h.monitor.list(), []);
  h.advance(30_000);
  await h.monitor.refreshAlarm();
  assert.deepEqual((await h.monitor.listEvents()).map((event) => event.eventId).sort(), ['foreign-event', 'new-event']);
});

test('live terminal turns complete when current execution is specifically unconfirmed', async () => {
  for (const terminal of ['completed', 'failed', 'interrupted'] as const) {
    let playbackCalls = 0;
    const h = harness(status('turn-a', 'in_progress'), {
      async prepare() {
        return { state: 'ready', async play() { playbackCalls += 1; return { ok: true }; } };
      },
    });
    await h.monitor.startWatch('target-1', 'thread-1');
    h.setStatus(status('turn-a', terminal, {
      turnId: null, state: 'unknown', evidence: 'inferred', reason: 'execution_unconfirmed',
      observedAt: null, needsAttention: false,
    }, 'live', terminal));
    h.advance(120_000);
    await h.monitor.refreshAlarm();
    assert.equal((await h.monitor.listEvents()).length, 1);
    assert.equal((await h.monitor.listEvents())[0]?.status, terminal);
    assert.deepEqual(await h.monitor.list(), []);
    assert.equal(playbackCalls, 1);
  }
});

test('unconfirmed execution with another turn or another reason stays nonterminal', async () => {
  for (const currentExecution of [
    { turnId: null, state: 'unknown', evidence: 'inferred', reason: 'other_reason', observedAt: null, needsAttention: false },
    { turnId: 'turn-b', state: 'unknown', evidence: 'inferred', reason: 'execution_unconfirmed', observedAt: null, needsAttention: false },
  ]) {
    const h = harness(status('turn-a', 'in_progress'));
    await h.monitor.startWatch('target-1', 'thread-1');
    h.setStatus(status('turn-a', 'completed', currentExecution, 'live', 'completed'));
    h.advance(30_000);
    await h.monitor.refreshAlarm();
    assert.equal((await h.monitor.listEvents()).length, 0);
    assert.equal((await h.monitor.list()).length, 1);
  }

  const oldTerminalAndNewExecution = harness(status('turn-a', 'completed'));
  await oldTerminalAndNewExecution.monitor.startWatch('target-1', 'thread-1');
  oldTerminalAndNewExecution.setStatus(status('turn-a', 'completed', {
    turnId: 'turn-b', state: 'running', evidence: 'live', reason: null, observedAt: null, needsAttention: false,
  }, 'live', 'running'));
  oldTerminalAndNewExecution.advance(30_000);
  await oldTerminalAndNewExecution.monitor.refreshAlarm();
  assert.equal((await oldTerminalAndNewExecution.monitor.listEvents()).length, 0);
});

test('version 2 events with the same four-part key normalize and do not replay audio', async () => {
  let prepareCalls = 0;
  const h = harness(status('turn-a', 'in_progress'), {
    async prepare() {
      prepareCalls += 1;
      return { state: 'ready', async play() { return { ok: true }; } };
    },
  });
  await h.monitor.startWatch('target-1', 'thread-1');
  const stored = h.storage.values[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY] as {
    version: number;
    items: unknown[];
    events: Array<Record<string, unknown>>;
  };
  stored.events = [
    {
      eventId: 'event-played', watchId: 'id-1', connectionId: 'connection-A', targetId: 'target-1',
      threadId: 'thread-1', turnId: 'turn-a', status: 'completed', detectedAt: '2026-11-20T00:00:00.000Z',
      notificationState: 'played', notificationReason: null,
    },
    {
      eventId: 'event-pending', watchId: 'id-1', connectionId: 'connection-A', targetId: 'target-1',
      threadId: 'thread-1', turnId: 'turn-a', status: 'failed', detectedAt: '2026-11-20T00:00:01.000Z',
      notificationState: 'pending', notificationReason: null,
    },
  ];
  await h.storage.set({ [CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY]: stored });

  h.setStatus(status('turn-a', 'failed'));
  h.advance(30_000);
  await h.monitor.refreshAlarm();
  const events = await h.monitor.listEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventId, 'event-played');
  assert.equal(events[0]?.status, 'completed');
  assert.equal(events[0]?.notificationState, 'played');
  assert.equal(prepareCalls, 0);
  assert.deepEqual(await h.monitor.list(), []);
  const persisted = h.storage.values[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY] as { events: unknown[] };
  assert.equal(persisted.events.length, 1);
});

test('a fresh worker restores the ledger without repeating its audio request', async () => {
  let notificationCalls = 0;
  const notification: CodexBridgeNotificationHandler = {
    async prepare() { return { state: 'ready', async play() { notificationCalls += 1; return { ok: true }; } }; },
  };
  const h = harness(status('turn-a', 'in_progress'), notification);
  await h.monitor.startWatch('target-1', 'thread-1');
  h.setStatus(status('turn-a', 'completed'));
  h.advance(30_000);
  await h.monitor.refreshAlarm();
  const restarted = new CodexBridgeThreadMonitor(h.storage, h.alarms, async () => ({
    connectionId: 'connection-A', async readStatus() { return status('turn-a', 'completed'); },
  }), { now: () => h.now() + 15_000, notification });
  await restarted.restore();
  assert.equal((await restarted.listEvents()).length, 1);
  assert.equal(notificationCalls, 1);
});

test('disabled sound keeps the event visible and records that audio was skipped', async () => {
  const notification: CodexBridgeNotificationHandler = {
    async prepare() { return { state: 'skipped', reason: 'disabled' }; },
  };
  const h = harness(status('turn-a', 'in_progress'), notification);
  await h.monitor.startWatch('target-1', 'thread-1');
  h.setStatus(status('turn-a', 'completed'));
  h.advance(30_000);
  await h.monitor.refreshAlarm();
  const event = (await h.monitor.listEvents())[0];
  assert.equal(event?.status, 'completed');
  assert.equal(event?.notificationState, 'skipped');
  assert.equal(event?.notificationReason, 'disabled');
  assert.deepEqual(await h.monitor.list(), []);
});

test('部分成功したCodex音声はイベントをplayedとして一度だけ記録し、理由を残す', async () => {
  let playCalls = 0; const h = harness(status('turn-a', 'in_progress'), { async prepare() { return { state: 'ready', async play() { playCalls += 1; return { ok: true, reason: 'partial-output' }; } }; } });
  await h.monitor.startWatch('target-1', 'thread-1'); h.setStatus(status('turn-a', 'completed')); h.advance(30_000); await h.monitor.refreshAlarm();
  const event = (await h.monitor.listEvents())[0]; assert.equal(event?.notificationState, 'played');
  assert.equal(event?.notificationReason, 'partial-output'); assert.equal(playCalls, 1);
});

test('a persisted audio request survives worker interruption without automatic replay', async () => {
  let releasePlay: ((result: { ok: false; reason: 'playback-failed' }) => void) | undefined;
  let playStarted: (() => void) | undefined;
  let replayAttempts = 0;
  const started = new Promise<void>((resolve) => { playStarted = resolve; });
  const storage = new MemoryStorage();
  const notification: CodexBridgeNotificationHandler = {
    async prepare() {
      return { state: 'ready', play: async () => {
        replayAttempts += 1;
        playStarted?.();
        return new Promise((resolve) => { releasePlay = resolve; });
      } };
    },
  };
  const h = harness(status('turn-a', 'in_progress'), notification, storage);
  await h.monitor.startWatch('target-1', 'thread-1');
  h.setStatus(status('turn-a', 'completed'));
  h.advance(30_000);
  const polling = h.monitor.refreshAlarm();
  await started;
  assert.equal((await h.monitor.listEvents())[0]?.notificationState, 'requested');

  const restarted = new CodexBridgeThreadMonitor(h.storage, h.alarms, async () => ({
    connectionId: 'connection-A', async readStatus() { return status('turn-a', 'completed'); },
  }), { now: () => h.now() + 15_000, notification });
  await restarted.restore();
  assert.equal((await restarted.listEvents())[0]?.notificationState, 'requested');
  assert.equal(replayAttempts, 1);
  releasePlay?.({ ok: false, reason: 'playback-failed' });
  await polling;
  assert.equal((await restarted.listEvents())[0]?.notificationState, 'failed');
  assert.equal(replayAttempts, 1);
});

test('new turns ending as failed or interrupted after a confirmed empty baseline are distinct events', async () => {
  for (const terminal of ['failed', 'interrupted'] as const) {
    const h = harness(status(null, null));
    const started = await h.monitor.startWatch('target-1', 'thread-1');
    assert.equal(started.ok, true);
    h.setStatus(status(`turn-${terminal}`, terminal));
    h.advance(30_000);
    await h.monitor.refreshAlarm();
    assert.equal((await h.monitor.listEvents())[0]?.status, terminal);
  }
});

test('inferred, unknown, not_loaded, estimated, and live-next-turn evidence never create a guessed event', async () => {
  const uncertain: CodexBridgeThreadStatus[] = [
    status('turn-a', 'completed', null, 'inferred'),
    status('turn-a', 'completed', null, 'live', 'unknown'),
    status('turn-a', 'completed', null, 'live', 'not_loaded'),
    status('turn-a', 'completed', { turnId: 'turn-b', state: 'estimated_running', evidence: 'inferred', reason: null, observedAt: null, needsAttention: false }),
    status('turn-a', 'completed', { turnId: 'turn-b', state: 'running', evidence: 'live', reason: null, observedAt: null, needsAttention: false }, 'live', 'running'),
  ];
  for (const next of uncertain) {
    const h = harness(status('turn-a', 'in_progress'));
    await h.monitor.startWatch('target-1', 'thread-1');
    h.setStatus(next);
    h.advance(30_000);
    await h.monitor.refreshAlarm();
    assert.equal((await h.monitor.listEvents()).length, 0);
    assert.equal((await h.monitor.list()).length, 1);
  }
});

test('unwatch during a delayed status request ignores the old response and its event', async () => {
  let resolveStatus: ((value: CodexBridgeThreadStatus) => void) | undefined;
  let hold = false;
  let now = Date.parse('2026-11-20T00:00:00.000Z');
  const h = harness(status('turn-a', 'in_progress'));
  const delayed = new CodexBridgeThreadMonitor(h.storage, h.alarms, async () => ({
    connectionId: 'connection-A',
    readStatus: async () => hold ? new Promise((resolve) => { resolveStatus = resolve; }) : status('turn-a', 'in_progress'),
  }), { now: () => now });
  await delayed.startWatch('target-1', 'thread-1');
  hold = true;
  now += 30_000;
  const polling = delayed.refreshAlarm();
  while (!resolveStatus) await new Promise((resolve) => setTimeout(resolve, 0));
  await delayed.stopWatch('connection-A', 'target-1', 'thread-1');
  resolveStatus(status('turn-a', 'completed'));
  await polling;
  assert.equal((await delayed.listEvents()).length, 0);
});

test('確認済み履歴のみ128件を保持し、未確認eventを追加しても消さず、pruning後に再通知しない', async () => {
  const h = harness(status(null, null));
  const owner = { ownerTabId: 4, ownerConversationId: 'conversation-A', ownerMuted: false, ownerMuteRevision: 0 } as const;
  await h.monitor.startWatch('target-1', 'thread-1', owner);
  for (let index = 0; index < 130; index += 1) {
    if (index > 0) await h.monitor.startWatch('target-1', 'thread-1', owner);
    h.setStatus(status(`turn-${index}`, 'completed'));
    h.advance(30_000);
    await h.monitor.refreshAlarm();
    const latest = (await h.monitor.listEvents())[0];
    if (latest) await h.monitor.acknowledgeEvents('conversation-A', [latest.eventId], new Date(h.now()).toISOString());
  }
  assert.equal((await h.monitor.listEvents()).length, 128);
  assert.ok((await h.monitor.listEvents()).every((event) => Boolean(event.acknowledgedAt)));
  for (let index = 130; index < 260; index += 1) {
    await h.monitor.startWatch('target-1', 'thread-1', owner);
    h.setStatus(status(`turn-${index}`, 'completed'));
    h.advance(30_000);
    await h.monitor.refreshAlarm();
  }
  const mixed = await h.monitor.listEvents();
  assert.equal(mixed.length, 258);
  assert.equal(mixed.filter((event) => event.acknowledgedAt).length, 128);
  assert.equal(mixed.filter((event) => !event.acknowledgedAt).length, 130);
  h.advance(30_000);
  await h.monitor.refreshAlarm();
  assert.equal((await h.monitor.listEvents()).length, 258);
});

test('未確認イベントは128件を超えても削除せず、件数の誤りを防ぐ', async () => {
  const h = harness(status(null, null));
  await h.monitor.startWatch('target-1', 'thread-1');
  for (let index = 0; index < 130; index += 1) {
    if (index > 0) await h.monitor.startWatch('target-1', 'thread-1');
    h.setStatus(status(`turn-${index}`, 'completed'));
    h.advance(30_000);
    await h.monitor.refreshAlarm();
  }
  const events = await h.monitor.listEvents();
  assert.equal(events.length, 130);
  assert.ok(events.every((event) => !event.acknowledgedAt));
});
