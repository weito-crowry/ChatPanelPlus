import assert from 'node:assert/strict';
import test from 'node:test';
import { CODEX_BRIDGE_THREAD_MONITOR_ALARM } from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import { CodexBridgeThreadMonitor, type CodexBridgeNotificationHandler } from '../src/background/thread-monitor.ts';
import type { CodexBridgeThreadStatus } from '../src/shared/codexbridge-mcp-protocol.ts';

class MemoryStorage {
  readonly values: Record<string, unknown> = {};
  failWrites = 0;
  async get(keys: string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.filter((key) => key in this.values).map((key) => [key, structuredClone(this.values[key])]));
  }
  async set(items: Record<string, unknown>): Promise<void> {
    if (this.failWrites > 0) { this.failWrites -= 1; throw new Error('storage write failed'); }
    Object.assign(this.values, structuredClone(items));
  }
}

class MemoryAlarms {
  active = false;
  failClear = 0;
  clearCalls = 0;
  async get(name: string): Promise<unknown> { return this.active && name === CODEX_BRIDGE_THREAD_MONITOR_ALARM ? { name } : undefined; }
  create(): void { this.active = true; }
  async clear(): Promise<boolean> {
    this.clearCalls += 1;
    if (this.failClear > 0) { this.failClear -= 1; throw new Error('alarm clear failed'); }
    this.active = false;
    return true;
  }
}

function status(threadId: string, turnId: string, turnStatus: 'completed' | 'failed' | 'interrupted' | 'in_progress'): CodexBridgeThreadStatus {
  return {
    targetId: 'target-1', threadId, state: turnStatus === 'in_progress' ? 'running' : 'idle',
    currentExecution: null, needsAttention: false,
    lastTurn: { turnId, status: turnStatus, category: null, evidence: 'live', reason: null, observedAt: null, needsAttention: false },
  };
}

function harness(notification?: CodexBridgeNotificationHandler) {
  const storage = new MemoryStorage();
  const alarms = new MemoryAlarms();
  const statuses = new Map<string, CodexBridgeThreadStatus>();
  let now = Date.parse('2026-11-23T00:00:00.000Z');
  let sequence = 0;
  const monitor = new CodexBridgeThreadMonitor(storage, alarms, async () => ({
    connectionId: 'connection-A',
    async readStatus(targetId, threadId) {
      const current = statuses.get(threadId) ?? status(threadId, 'turn-a', 'in_progress');
      return { ...current, targetId, threadId };
    },
  }), {
    now: () => now,
    createWatchId: () => `watch-${++sequence}`,
    createEventId: () => `event-${++sequence}`,
    notification,
  });
  return {
    monitor, storage, alarms,
    setStatus(threadId: string, value: CodexBridgeThreadStatus) { statuses.set(threadId, value); },
    advance(milliseconds: number) { now += milliseconds; },
  };
}

test('terminal mutation preserves event owner and removes only the matching watch while another watch keeps the alarm', async () => {
  const h = harness();
  const owner = { ownerTabId: 4, ownerConversationId: 'conversation-A', ownerMuted: true, ownerMuteRevision: 7 } as const;
  const first = await h.monitor.startWatch('target-1', 'thread-1', owner);
  const second = await h.monitor.startWatch('target-1', 'thread-2', { ...owner, ownerTabId: 5 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  h.setStatus('thread-1', status('thread-1', 'turn-a', 'completed'));
  h.advance(30_000);
  await h.monitor.refreshAlarm();

  assert.deepEqual((await h.monitor.list()).map((item) => item.threadId), ['thread-2']);
  const [event] = await h.monitor.listEvents();
  assert.deepEqual([event?.ownerTabId, event?.ownerConversationId, event?.ownerMuted, event?.ownerMuteRevision],
    [4, 'conversation-A', true, 7]);
  assert.equal(event?.watchId, first.ok ? first.item.watchId : '');
  assert.equal(h.alarms.active, true);
});

test('event write failure retains the watch and retries from the last persisted observation', async () => {
  const h = harness();
  await h.monitor.startWatch('target-1', 'thread-1');
  h.setStatus('thread-1', status('thread-1', 'turn-a', 'completed'));
  h.advance(30_000);
  h.storage.failWrites = 1;
  await h.monitor.refreshAlarm();
  assert.equal((await h.monitor.list()).length, 1);
  assert.equal((await h.monitor.list())[0]?.fetchOutcome, 'ok');
  assert.equal((await h.monitor.listEvents()).length, 0);

  await h.monitor.refreshAlarm();
  assert.deepEqual(await h.monitor.list(), []);
  assert.equal((await h.monitor.listEvents()).length, 1);
  assert.equal(h.alarms.active, false);
});

test('playback and alarm-clear failures leave the saved event and do not restore the watch', async () => {
  let playbackCalls = 0;
  const notification: CodexBridgeNotificationHandler = {
    async prepare() {
      return { state: 'ready', async play() { playbackCalls += 1; return { ok: false, reason: 'playback-failed' }; } };
    },
  };
  const h = harness(notification);
  await h.monitor.startWatch('target-1', 'thread-1');
  h.alarms.failClear = 1;
  h.setStatus('thread-1', status('thread-1', 'turn-a', 'completed'));
  h.advance(30_000);
  await h.monitor.refreshAlarm();
  assert.deepEqual(await h.monitor.list(), []);
  assert.equal((await h.monitor.listEvents())[0]?.notificationState, 'failed');
  assert.equal(playbackCalls, 1);
  assert.equal(h.alarms.clearCalls, 1);
  assert.equal(h.alarms.active, true);

  await h.monitor.restore();
  assert.equal(h.alarms.active, false);
});
