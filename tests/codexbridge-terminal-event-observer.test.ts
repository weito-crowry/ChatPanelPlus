import assert from 'node:assert/strict';
import test from 'node:test';
import type { CodexBridgeTerminalEvent } from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import { CodexBridgeTerminalEventObserver } from '../src/content/codexbridge-terminal-event-observer.ts';

function event(
  eventId: string, targetId = 'target-A', acknowledgedAt: string | null = null,
  connectionId = 'connection-A', status: CodexBridgeTerminalEvent['status'] = 'completed',
): CodexBridgeTerminalEvent {
  return {
    eventId, watchId: 'watch-A', connectionId, targetId, threadId: `thread-${eventId}`,
    turnId: `turn-${eventId}`, status, detectedAt: '2026-11-23T00:00:00Z',
    notificationState: 'played', notificationReason: null, ownerConversationId: 'conversation-A', acknowledgedAt,
  };
}

test('初回snapshotの過去eventを基準化し、新しい完了eventだけを一度通知する', () => {
  const observer = new CodexBridgeTerminalEventObserver();
  const oldEvent = event('old');
  const failed = event('failed', 'target-A', null, 'connection-A', 'failed');
  const interrupted = event('interrupted', 'target-A', null, 'connection-A', 'interrupted');
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [oldEvent]), []);
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [oldEvent, failed, interrupted])
    .map(({ eventId, status }) => [eventId, status]), [['failed', 'failed'], ['interrupted', 'interrupted']]);
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [interrupted, failed, oldEvent]), []);
});

test('ACK、clear後の再表示、event順変更は同じeventを再通知しない', () => {
  const observer = new CodexBridgeTerminalEventObserver();
  observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [event('one'), event('two')]);
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [event('two', 'target-A', '2026-11-23T01:00:00Z'), event('one')]), []);
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [event('two')]), []);
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [event('one'), event('two')]), []);
});

test('event identityは会話ownerごとに分離する', () => {
  const observer = new CodexBridgeTerminalEventObserver();
  observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [event('same-id')]);
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-B', 'connection-A', [event('same-id')]), []);
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-B', 'connection-A', [event('same-id'), event('new-B')]).map(({ eventId }) => eventId), ['new-B']);
});

test('接続先が変わった最初のsnapshotは履歴の基準化だけを行う', () => {
  const observer = new CodexBridgeTerminalEventObserver();
  observer.observeSuccessfulSnapshot('conversation-A', 'connection-A', [event('old')]);
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-A', 'connection-B', [event('old', 'target-A', null, 'connection-B')]), []);
  assert.deepEqual(observer.observeSuccessfulSnapshot('conversation-A', 'connection-B', [
    event('old', 'target-A', null, 'connection-B'), event('new', 'target-A', null, 'connection-B'),
  ]).map(({ eventId }) => eventId), ['new']);
});
