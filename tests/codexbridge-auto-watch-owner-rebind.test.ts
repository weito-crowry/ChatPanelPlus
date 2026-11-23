import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY,
  CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY,
  type CodexBridgeTerminalEvent,
  type CodexBridgeWatchSnapshot,
} from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import { CodexBridgeAutoThreadRegistration } from '../src/background/thread-monitor-auto-registration.ts';

const ownerConversationId = 'conversation-A';
const target = { id: 'target-1', name: 'Workstation', kind: 'local', available: true } as const;
const watch: CodexBridgeWatchSnapshot = {
  watchId: 'watch-1', connectionId: 'connection-A', targetId: target.id, threadId: 'thread-1', enabled: true,
  baselineCaptured: true, baselineTurnKind: 'turn', baselineTurnId: 'turn-1', baselineTurnStatus: 'completed',
  lastObservedTurnId: 'turn-1', statusState: 'running', lastTurnStatus: 'in_progress', lastTurnEvidence: 'live',
  currentExecutionState: 'in_progress', currentExecutionEvidence: 'live', currentExecutionTurnId: 'turn-1',
  needsAttention: false, turnChange: 'same', observedAt: '2026-11-23T00:00:00.000Z',
  lastSuccessAt: '2026-11-23T00:00:00.000Z', fetchOutcome: 'ok', nextPollAt: 0, failureCount: 0,
  ownerTabId: 4, ownerConversationId, ownerMuted: false, ownerMuteRevision: 0,
};
const event: CodexBridgeTerminalEvent = {
  eventId: 'event-1', watchId: watch.watchId, connectionId: watch.connectionId, targetId: watch.targetId,
  threadId: watch.threadId, turnId: 'turn-2', status: 'completed', detectedAt: '2026-11-23T00:01:00.000Z',
  notificationState: 'played', notificationReason: null,
  ownerTabId: 4, ownerConversationId, ownerMuted: false, ownerMuteRevision: 0,
};

class FakeStorage {
  readonly values: Record<string, unknown> = {
    [CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY]: { version: 2, items: [watch], events: [event] },
  };
  async get(keys: string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.filter((key) => key in this.values)
      .map((key) => [key, structuredClone(this.values[key])]));
  }
  async set(items: Record<string, unknown>): Promise<void> { Object.assign(this.values, structuredClone(items)); }
}

function harness() {
  const storage = new FakeStorage();
  const matchingTabs = new Set<number>([4]);
  const rebindableTabs = new Set<number>();
  const monitor = {
    async list() { return [watch]; },
    async scheduleTargetRequest<T>(_targetId: string, operation: () => Promise<T>): Promise<T> { return operation(); },
    async updateOwnerMute() {},
  };
  const auto = new CodexBridgeAutoThreadRegistration(
    storage,
    { async clear() { return true; } },
    monitor as never,
    async () => ({ connectionId: 'connection-A', readTargets: async () => [target] }),
    async () => ({ ok: true, muted: false, revision: 0 }),
    async (tabId, conversationId) => matchingTabs.has(tabId) && conversationId === ownerConversationId,
    async (tabId, conversationId) => rebindableTabs.has(tabId) && conversationId === ownerConversationId,
  );
  return {
    storage,
    auto,
    setTabMatches(tabId: number, matches: boolean) {
      if (matches) matchingTabs.add(tabId);
      else matchingTabs.delete(tabId);
    },
    setTabRebindable(tabId: number, rebindable: boolean) {
      if (rebindable) rebindableTabs.add(tabId);
      else rebindableTabs.delete(tabId);
    },
  };
}

test('古いowner設定は現在tabでONと表示せず、明示ONで同一会話だけ付け替える', async () => {
  const h = harness();
  assert.equal((await h.auto.setEnabled(target.id, 4, ownerConversationId, true)).ok, true);
  const autoState = h.storage.values[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY] as {
    version: 1; entries: readonly Record<string, unknown>[];
  };
  const oldEntry = autoState.entries[0]!;
  h.storage.values[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY] = {
    version: 1, entries: [{ ...oldEntry, skippedExecutions: [{ threadId: 'thread-1', turnId: 'turn-1' }] }],
  };
  const monitorRecords = structuredClone(h.storage.values[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY]);

  h.setTabMatches(4, false);
  h.setTabRebindable(4, true);
  h.setTabMatches(9, true);
  assert.deepEqual(await h.auto.getStatus(target.id, ownerConversationId, 9), {
    targetId: target.id, connectionId: 'connection-A', enabled: false, ownerConversationId,
    state: 'error', failure: 'owner-tab-unavailable', watchingThreadCount: 0,
  });

  const result = await h.auto.setEnabled(target.id, 9, ownerConversationId, true);
  assert.equal(result.ok, true);
  const reboundState = h.storage.values[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY] as {
    entries: readonly { ownerTabId: number; ownerConversationId: string; enabled: boolean; skippedExecutions: unknown[] }[];
  };
  assert.deepEqual(reboundState.entries, [{
    ...oldEntry, ownerTabId: 9, ownerConversationId, enabled: true,
    skippedExecutions: [{ threadId: 'thread-1', turnId: 'turn-1' }],
  }]);
  assert.deepEqual(h.storage.values[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY], monitorRecords);
  assert.deepEqual(await h.auto.getStatus(target.id, ownerConversationId, 9), result.ok ? result.status : null);
});

test('別の有効owner tabが同じ会話を保持中なら明示ONで所有を付け替えない', async () => {
  const h = harness();
  assert.equal((await h.auto.setEnabled(target.id, 4, ownerConversationId, true)).ok, true);
  h.setTabMatches(9, true);

  assert.deepEqual(await h.auto.setEnabled(target.id, 9, ownerConversationId, true), {
    ok: false, reason: 'auto-owner-conflict',
  });
});

test('旧owner tabがopenのまま応答しない場合は明示ONでも再bindしない', async () => {
  const h = harness();
  assert.equal((await h.auto.setEnabled(target.id, 4, ownerConversationId, true)).ok, true);
  h.setTabMatches(4, false);
  h.setTabMatches(9, true);

  assert.deepEqual(await h.auto.setEnabled(target.id, 9, ownerConversationId, true), {
    ok: false, reason: 'auto-owner-conflict',
  });
  const stored = h.storage.values[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY] as { entries: readonly { ownerTabId: number }[] };
  assert.equal(stored.entries[0]?.ownerTabId, 4);
});

test('owner確認が復旧した後は以前のowner-tab-unavailable表示を引き継がない', async () => {
  const h = harness();
  assert.equal((await h.auto.setEnabled(target.id, 4, ownerConversationId, true)).ok, true);
  const autoState = h.storage.values[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY] as {
    version: 1; entries: readonly Record<string, unknown>[];
  };
  h.storage.values[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY] = {
    version: 1, entries: [{ ...autoState.entries[0], failure: 'owner-tab-unavailable' }],
  };

  const status = await h.auto.getStatus(target.id, ownerConversationId, 4);
  assert.equal(status.enabled, true);
  assert.equal(status.state, 'ready');
  assert.equal(status.failure, null);
});
