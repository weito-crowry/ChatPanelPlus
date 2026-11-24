import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodexBridgeWatchSummary } from '../src/content/codexbridge-watch-summary.ts';
import type { CodexBridgeTerminalEvent, CodexBridgeWatchSnapshot } from '../src/shared/codexbridge-thread-monitor-protocol.ts';

const watch = (ownerConversationId: string, threadId: string, connectionId = 'connection-a', targetId = 'target-a') => ({
  watchId: `watch-${threadId}`, ownerConversationId, threadId, connectionId, targetId, enabled: true,
  baselineCaptured: true, baselineTurnKind: 'turn', baselineTurnId: 'turn-old', baselineTurnStatus: 'in_progress',
  lastObservedTurnId: 'turn-new', statusState: 'running', lastTurnStatus: 'in_progress', lastTurnEvidence: 'live',
  currentExecutionState: 'in_progress', currentExecutionEvidence: 'live', currentExecutionTurnId: 'turn-new',
  needsAttention: false, turnChange: 'advanced', observedAt: '2026-11-24T09:00:00Z', lastSuccessAt: '2026-11-24T09:00:00Z',
  fetchOutcome: 'ok', nextPollAt: 0, failureCount: 0,
}) as unknown as CodexBridgeWatchSnapshot;

const event = (eventId: string, ownerConversationId: string, threadId: string, options: {
  connectionId?: string; targetId?: string; acknowledgedAt?: string | null;
} = {}) => ({
  eventId, ownerConversationId, watchId: 'watch', connectionId: options.connectionId ?? 'connection-a',
  targetId: options.targetId ?? 'target-a', threadId, turnId: `turn-${eventId}`, status: 'completed',
  detectedAt: '2026-11-24T09:01:00Z', notificationState: 'skipped', notificationReason: 'disabled',
  acknowledgedAt: options.acknowledgedAt ?? null,
}) as unknown as CodexBridgeTerminalEvent;

const base = {
  conversationId: 'conversation-a', currentConnectionId: 'connection-a', listConversationId: 'conversation-a',
  listLoading: false, listFailure: null, listFailureConversationId: null, operationBusy: false, notificationError: null,
};

test('同じowner-scoped watch snapshotから監視件数・通知thread単位の件数と詳細を作る', () => {
  const summary = createCodexBridgeWatchSummary({
    ...base,
    items: [watch('conversation-a', 'watched'), watch('conversation-b', 'other-owner')],
    events: [
      event('event-1', 'conversation-a', 'thread-1'), event('event-2', 'conversation-a', 'thread-1'),
      event('event-3', 'conversation-a', 'thread-2', { targetId: 'target-b' }),
      event('event-old', 'conversation-a', 'thread-3', { acknowledgedAt: '2026-11-24T09:02:00Z' }),
      event('event-other', 'conversation-b', 'thread-4'),
    ],
  });
  assert.equal(summary?.status, 'ready');
  assert.equal(summary?.watchingCount, 1);
  assert.equal(summary?.unacknowledgedThreadCount, 2);
  assert.deepEqual(summary?.unacknowledgedGroups.map(({ threadId, events }) => [threadId, events.length]), [
    ['thread-1', 2], ['thread-2', 1],
  ]);
  assert.equal(summary?.events.some(({ eventId }) => eventId === 'event-other'), false);
});

test('未取得と空の正規snapshot、取得失敗を区別し会話切替時に旧詳細を返さない', () => {
  const item = watch('conversation-a', 'thread-1');
  const loaded = createCodexBridgeWatchSummary({ ...base, items: [item], events: [] });
  assert.equal(loaded?.status, 'ready');
  assert.equal(loaded?.watchingCount, 1);
  assert.equal(loaded?.unacknowledgedThreadCount, 0);

  const loading = createCodexBridgeWatchSummary({ ...base, listConversationId: null, items: [item], events: [] });
  assert.equal(loading?.status, 'loading');
  assert.equal(loading?.watchingCount, null);
  assert.deepEqual(loading?.items, []);

  const failed = createCodexBridgeWatchSummary({
    ...base, listFailure: 'storage-error', listFailureConversationId: 'conversation-a', items: [item], events: [],
  });
  assert.equal(failed?.status, 'error');
  assert.equal(failed?.watchingCount, null);

  const changed = createCodexBridgeWatchSummary({ ...base, conversationId: 'conversation-b', items: [item], events: [] });
  assert.equal(changed?.status, 'loading');
  assert.deepEqual(changed?.items, []);
});
