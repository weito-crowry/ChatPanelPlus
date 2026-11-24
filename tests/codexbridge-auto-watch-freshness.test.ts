import assert from 'node:assert/strict';
import test from 'node:test';
import { CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY } from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeTarget, CodexBridgeThread, CodexBridgeThreadPage } from '../src/shared/codexbridge-mcp-protocol.ts';
import { CodexBridgeAutoWatchCandidates } from '../src/background/thread-monitor-auto-registration-candidates.ts';
import type { CodexBridgeRunningSnapshot, CodexBridgeReadAccess } from '../src/background/codexbridge-read-service.ts';
import { CodexBridgeAutoThreadRegistration } from '../src/background/thread-monitor-auto-registration.ts';
import type { CodexBridgeWatchSnapshot } from '../src/shared/codexbridge-thread-monitor-protocol.ts';

const target: CodexBridgeTarget = { id: 'target', name: 'Workstation', kind: 'local', available: true };
const liveThread: CodexBridgeThread = {
  targetId: target.id, id: 'thread-live', title: 'Live thread', preview: null, cwd: null, updatedAt: null,
  currentExecution: { turnId: 'turn-live', state: 'in_progress', evidence: 'live', reason: null, observedAt: null, needsAttention: false },
  lastTurn: { turnId: 'turn-live', status: 'in_progress', category: null, evidence: 'live', reason: null,
    observedAt: null, needsAttention: false }, needsAttention: false,
};
const page: CodexBridgeThreadPage = { threads: [liveThread], nextCursor: null };
const identity = { targetId: target.id, ownerTabId: 7, conversationId: 'conversation-A', turnKey: 'turn-answer',
  assistantMessageId: 'assistant-answer' };

function harness(snapshotResult?: CodexBridgeRunningSnapshot) {
  const optionsSeen: Array<{ maxAgeMs?: number; force?: boolean; priority?: string }> = [];
  const entry = { connectionId: 'connection-A', targetId: target.id, enabled: true, ownerTabId: identity.ownerTabId,
    ownerConversationId: identity.conversationId, ownerMuted: false, ownerMuteRevision: 0, failure: null,
    liveThreadCount: null, lastScannedAt: null, nextScanAt: 0, failureCount: 0, skippedExecutions: [] };
  const storage = { async get() { return { [CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]: { version: 1, entries: [entry] } }; }, async set() {} };
  const access: CodexBridgeReadAccess = {
    connectionId: 'connection-A', generation: 3,
    async readTargets() { return [target]; },
    async readRunningThreads() { return page; },
    async readRunningSnapshot(_targetId, options) {
      optionsSeen.push(options ?? {});
      return snapshotResult ?? { ok: true, connectionId: 'connection-A', generation: 3, page, freshness: 'fresh',
        observedAt: '2026-11-24T00:00:00.000Z', ageMs: 0, failureReason: null };
    },
  };
  const monitor = { scheduleTargetRequest<T>(_targetId: string, operation: () => Promise<T>): Promise<T> { return operation(); } };
  const candidates = new CodexBridgeAutoWatchCandidates(storage, monitor, async () => access, async () => true);
  return { candidates, optionsSeen };
}

test('auto candidateはstale running_only snapshotのlive IDを返さない', async () => {
  const h = harness({ ok: true, connectionId: 'connection-A', generation: 3, page, freshness: 'stale',
    observedAt: '2026-11-23T23:59:50.000Z', ageMs: 10_000, failureReason: 'timeout' });
  const result = await h.candidates.get(identity.targetId, identity.ownerTabId, identity.conversationId,
    identity.turnKey, identity.assistantMessageId);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'timeout');
});

test('auto candidateは2秒以内のfresh snapshotだけを要求する', async () => {
  const h = harness();
  const result = await h.candidates.get(identity.targetId, identity.ownerTabId, identity.conversationId,
    identity.turnKey, identity.assistantMessageId);
  assert.equal(result.ok, true);
  assert.deepEqual(h.optionsSeen[0], { maxAgeMs: 2_000, priority: 'candidate' });
  if (result.ok) assert.deepEqual(result.data.threads, [{ threadId: 'thread-live', turnId: 'turn-live' }]);
});

test('登録確定はmanual forceでfresh snapshotを取りstale cacheのIDを登録しない', async () => {
  const entry = { connectionId: 'connection-A', targetId: target.id, enabled: true, ownerTabId: identity.ownerTabId,
    ownerConversationId: identity.conversationId, ownerMuted: false, ownerMuteRevision: 0, failure: null,
    liveThreadCount: null, lastScannedAt: null, nextScanAt: 0, failureCount: 0, skippedExecutions: [] };
  const storage = { async get() { return { [CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]: { version: 1, entries: [entry] } }; }, async set() {} };
  const requested: Array<{ maxAgeMs?: number; force?: boolean; priority?: string }> = [];
  const registrations: Array<{ expectedGeneration?: number }> = [];
  let freshness: 'fresh' | 'stale' = 'stale';
  let started = 0;
  const monitor = {
    async list() { return []; }, async read() { return null; }, async stopWatch() { return false; }, async updateOwnerMute() {},
    scheduleTargetRequest<T>(_targetId: string, operation: () => Promise<T>): Promise<T> { return operation(); },
    async startWatch(_targetId: string, _threadId: string, _owner?: unknown,
      options?: { expectedGeneration?: number }) {
      started += 1; registrations.push(options ?? {});
      return { ok: true as const, item: {} as CodexBridgeWatchSnapshot, created: true, transferred: false };
    },
  };
  const access: CodexBridgeReadAccess = {
    connectionId: 'connection-A', generation: 3, readsScheduled: true, isCurrent: () => true,
    async readTargets() { return [target]; },
    async readRunningSnapshot(_targetId, options) {
      requested.push(options ?? {});
      return { ok: true, connectionId: 'connection-A', generation: 3, page, freshness,
        observedAt: '2026-11-24T00:00:00.000Z', ageMs: freshness === 'fresh' ? 0 : 10_000,
        failureReason: freshness === 'stale' ? 'timeout' : null };
    },
  };
  const auto = new CodexBridgeAutoThreadRegistration(storage, { async clear() { return true; } }, monitor,
    async () => access, async () => ({ ok: true, muted: false, revision: 0 }), async () => true);
  const args = [target.id, 'connection-A', identity.ownerTabId, identity.conversationId,
    identity.turnKey, identity.assistantMessageId, ['thread-live']] as const;
  assert.equal(await auto.registerCompletedAnswer(...args), 0);
  assert.deepEqual(requested[0], { priority: 'manual', maxAgeMs: 0, force: true });
  assert.equal(started, 0);
  freshness = 'fresh';
  const retry = new CodexBridgeAutoThreadRegistration(storage, { async clear() { return true; } }, monitor,
    async () => access, async () => ({ ok: true, muted: false, revision: 0 }), async () => true);
  assert.equal(await retry.registerCompletedAnswer(...args), 1);
  assert.equal(started, 1);
  assert.equal(registrations[0]?.expectedGeneration, 3);
});
