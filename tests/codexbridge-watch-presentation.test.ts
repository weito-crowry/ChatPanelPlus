import assert from 'node:assert/strict';
import test from 'node:test';
import type { CodexBridgeTerminalEvent, CodexBridgeWatchSnapshot } from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import {
  editorInsertionFailureLabel,
  eventKindLabel,
  eventStatusLabel,
  filterOwnedWatchData,
  finalAnswerLabel,
  watchListFailureLabel,
  watchTurnStateLabel,
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
  assert.equal(eventStatusLabel({ notificationState: 'played', notificationReason: 'partial-output' } as CodexBridgeTerminalEvent), '一部の出力先で音声再生成功');
  assert.match(finalAnswerLabel({ status: 'no-final-answer', completeness: 'unconfirmed' }), /完全性は未確認です/);
  assert.equal(editorInsertionFailureLabel('ime-composing'), 'IME変換中のため挿入しませんでした。');
  assert.equal(editorInsertionFailureLabel('unknown'), '入力欄へ挿入できませんでした。');
});

test('B一覧の失敗理由をtimeout・送信元・保存領域・不正応答に分ける', () => {
  assert.match(watchListFailureLabel('timeout'), /25秒以内.*再試行/);
  assert.match(watchListFailureLabel('sender-unverified'), /送信元.*SPA/);
  assert.match(watchListFailureLabel('storage-error'), /保存領域.*削除していません/);
  assert.match(watchListFailureLabel('invalid-response'), /応答が空または不正.*送信元検証/);
});

test('terminal valueの保留理由とgapを同時に表示する', () => {
  const snapshot: CodexBridgeWatchSnapshot = {
    watchId: 'watch', connectionId: 'connection-A', targetId: 'target-A', threadId: 'thread-A', enabled: true,
    baselineCaptured: true, baselineTurnKind: 'turn', baselineTurnId: 'turn-a', baselineTurnStatus: 'in_progress',
    lastObservedTurnId: 'turn-b', statusState: 'completed', lastTurnStatus: 'completed', lastTurnEvidence: 'live',
    currentExecutionState: 'unknown', currentExecutionEvidence: 'inferred', currentExecutionReason: 'other_reason',
    currentExecutionTurnId: null, terminalHoldReason: 'execution-evidence-unconfirmed', needsAttention: false,
    turnChange: 'gap', observedAt: null, lastSuccessAt: null, fetchOutcome: 'ok', nextPollAt: 0, failureCount: 0,
  };

  const label = watchTurnStateLabel(snapshot, true);
  assert.match(label, /完了状態を観測しました/);
  assert.match(label, /current_executionの証拠を確認できない/);
  assert.match(label, /観測gapあり/);
});
