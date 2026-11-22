import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexBridgeWatchStartFeedback, codexBridgeWatchStartFailureLabel } from '../src/content/codexbridge-watch-start-feedback.ts';

const ownerA = { conversationId: 'conversation-a', targetId: 'target', threadId: 'thread' } as const;

test('A選択変更で古い監視開始失敗を無効化し、別選択へ表示しない', () => {
  const feedback = new CodexBridgeWatchStartFeedback();
  const ticket = feedback.begin(ownerA);
  feedback.invalidate();
  assert.equal(feedback.recordFailure(ticket, { ...ownerA, conversationId: 'conversation-b' }), false);
});

test('現在の選択では実際の監視開始失敗を表示対象として記録する', () => {
  const feedback = new CodexBridgeWatchStartFeedback();
  const ticket = feedback.begin(ownerA);
  assert.equal(feedback.recordFailure(ticket, ownerA), true);
});

test('一覧更新だけでは進行中の監視開始ticketを無効化しない', () => {
  const feedback = new CodexBridgeWatchStartFeedback();
  const ticket = feedback.begin(ownerA);
  assert.equal(feedback.isCurrent(ticket, ownerA), true);
  assert.equal(feedback.recordFailure(ticket, ownerA), true);
});

test('現在の選択とownerの監視開始失敗は表示対象として残る', () => {
  const feedback = new CodexBridgeWatchStartFeedback();
  const ticket = feedback.begin(ownerA);
  assert.equal(feedback.isCurrent(ticket, ownerA), true);
  assert.equal(feedback.recordFailure(ticket, ownerA), true);
  assert.equal(feedback.isCurrent(ticket, { ...ownerA, conversationId: 'conversation-b' }), false);
});

test('新しいsender検証拒否は監視開始の操作経路と理由を表示する', () => {
  assert.match(codexBridgeWatchStartFailureLabel('invalid-request'), /監視開始: 会話ページの送信元を確認できません/);
  assert.match(codexBridgeWatchStartFailureLabel('watch-limit'), /監視件数の上限/);
});
