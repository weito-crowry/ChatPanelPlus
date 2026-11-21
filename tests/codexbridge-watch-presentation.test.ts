import assert from 'node:assert/strict';
import test from 'node:test';
import type { CodexBridgeTerminalEvent, CodexBridgeWatchSnapshot } from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import {
  editorInsertionFailureLabel,
  eventKindLabel,
  eventStatusLabel,
  filterOwnedWatchData,
  finalAnswerLabel,
} from '../src/content/codexbridge-watch-presentation.ts';

function item(ownerConversationId: string): CodexBridgeWatchSnapshot {
  return { ownerConversationId } as CodexBridgeWatchSnapshot;
}

function event(ownerConversationId: string, eventId: string, acknowledgedAt?: string): CodexBridgeTerminalEvent {
  return {
    ownerConversationId, eventId, connectionId: 'connection-A', targetId: 'target-A', threadId: 'thread-A',
    acknowledgedAt,
  } as CodexBridgeTerminalEvent;
}

test('会話別表示はowner一致項目だけ返し、未確認Turn数はwatch identityを重複除外する', () => {
  const result = filterOwnedWatchData({
    items: [item('conversation-A'), item('conversation-B')],
    events: [
      event('conversation-A', 'event-a1'), event('conversation-A', 'event-a2'),
      event('conversation-A', 'event-a3', '2026-11-21T00:00:00Z'), event('conversation-B', 'event-b1'),
    ],
  }, 'conversation-A');
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.events.map(({ eventId }) => eventId), ['event-a1', 'event-a2', 'event-a3']);
  assert.deepEqual(result.summary, { watchingCount: 1, unacknowledgedThreadCount: 1 });
});

test('移動した通知・回答・挿入ラベルを維持する', () => {
  assert.equal(eventKindLabel('completed'), '完了');
  assert.equal(eventStatusLabel({ notificationState: 'skipped', notificationReason: 'disabled' } as CodexBridgeTerminalEvent), '音声通知無効');
  assert.match(finalAnswerLabel({ status: 'no-final-answer', completeness: 'unconfirmed' }), /完全性は未確認です/);
  assert.equal(editorInsertionFailureLabel('ime-composing'), 'IME変換中のため挿入しませんでした。');
  assert.equal(editorInsertionFailureLabel('unknown'), '入力欄へ挿入できませんでした。');
});
