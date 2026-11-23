import assert from 'node:assert/strict';
import test from 'node:test';
import { collectCodexBridgeWatchAdditionBatch, CodexBridgeWatchAdditionObserver } from '../src/content/codexbridge-watch-addition-observer.ts';
import { CodexBridgeTerminalRefreshCoordinator } from '../src/content/codexbridge-terminal-refresh.ts';

const watch = (watchId: string, threadId = watchId, ownerConversationId = 'conversation-A', targetId = 'target-A', connectionId = 'connection-A') => ({
  watchId, threadId, ownerConversationId, targetId, connectionId, enabled: true,
});

test('初回snapshotと既存watch更新・重複storage refreshは抑止し、真の追加だけを通知する', () => {
  const observer = new CodexBridgeWatchAdditionObserver();
  const existing = watch('watch-existing', 'thread-existing');
  const updatedExisting = { ...existing, lastTurnStatus: 'completed' };
  const added = watch('watch-added', 'thread-added');
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [existing]), []);
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [
    updatedExisting, added,
  ]).map(({ threadId }) => threadId), ['thread-added']);
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [existing, added]), []);
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [existing]), []);
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [existing, added])
    .map(({ threadId }) => threadId), ['thread-added']);
});

test('別ownerと別connectionの最初のsnapshotは基準化し、後続追加と混同しない', () => {
  const observer = new CodexBridgeWatchAdditionObserver();
  observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [watch('old')]);
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-B', 'connection-A', [watch('owner-change', 'thread-owner', 'conversation-B')]), []);
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-B', 'connection-A', [
    watch('owner-change', 'thread-owner', 'conversation-B'), watch('new-owner', 'thread-new', 'conversation-B'),
  ]).map(({ threadId }) => threadId), ['thread-new']);
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-B', 'connection-B', [
    watch('new-connection', 'thread-connection', 'conversation-B', 'target-A', 'connection-B'),
  ]), []);
});

test('他ownerのwatch、他connectionのwatch、削除だけではA refresh signalを作らない', () => {
  const observer = new CodexBridgeWatchAdditionObserver();
  observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [watch('existing')]);
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [
    watch('existing'), watch('other-owner', 'thread-other-owner', 'conversation-B'),
    watch('other-connection', 'thread-other-connection', 'conversation-A', 'target-A', 'connection-B'),
  ]), []);
});

test('storage差分は真のwatch追加だけを出し、重複イベントはA coordinatorで一度へ束ねる', () => {
  const observer = new CodexBridgeWatchAdditionObserver();
  const coordinator = new CodexBridgeTerminalRefreshCoordinator();
  const oldValue = { version: 2, items: [watch('existing')], events: [] };
  const addedItem = watch('added', 'thread-added');
  const newValue = { version: 2, items: [watch('existing'), addedItem], events: [] };
  const additions = observer.observeStorageChange('conversation-A', oldValue, newValue);
  const context = { ownerConversationId: 'conversation-A', connectionId: 'connection-A', targetId: 'target-A',
    mode: 'running' as const, connected: true, routeCurrent: true, threadsBusy: false };
  assert.equal(additions.length, 1);
  assert.equal(coordinator.observeWatchAdditions(additions, context), 'threads');
  assert.equal(coordinator.observeWatchAdditions(observer.observeStorageChange('conversation-A', oldValue, newValue), context), null);
  assert.deepEqual(observer.observeStorageChange('conversation-A', newValue,
    { ...newValue, items: newValue.items.map((item) => ({ ...item, lastTurnStatus: 'completed' })) }), []);
  assert.deepEqual(observer.observeStorageChange('conversation-A', newValue,
    { ...newValue, items: [watch('existing')] }), []);
  assert.deepEqual(observer.observeStorageChange('conversation-A', newValue,
    { ...newValue, events: [{ eventId: 'old-event' }] }), []);
});

test('storage追加は同じowner・connection snapshotに残っている場合だけAへ渡す', () => {
  const observer = new CodexBridgeWatchAdditionObserver();
  const pending = new Map();
  const existing = watch('existing');
  const added = watch('added', 'thread-added');
  observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [existing]);
  pending.set('connection-A\u0000target-A\u0000thread-added\u0000added', {
    watchId: 'added', connectionId: 'connection-A', targetId: 'target-A', threadId: 'thread-added',
    ownerConversationId: 'conversation-A',
  });
  assert.deepEqual(collectCodexBridgeWatchAdditionBatch(observer, pending, 'conversation-A', 'connection-A', [existing]).additions, []);
  assert.equal(pending.size, 0);

  pending.set('connection-A\u0000target-A\u0000thread-added\u0000added', {
    watchId: 'added', connectionId: 'connection-A', targetId: 'target-A', threadId: 'thread-added',
    ownerConversationId: 'conversation-A',
  });
  assert.deepEqual(collectCodexBridgeWatchAdditionBatch(observer, pending, 'conversation-A', 'connection-A', [existing, added])
    .additions.map(({ threadId }) => threadId), ['thread-added']);
});
