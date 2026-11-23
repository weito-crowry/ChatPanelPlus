import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractCodexBridgeThreadIds,
  publishCodexBridgeAutoWatchCompletion,
  subscribeCodexBridgeAutoWatchCompletion,
} from '../src/content/codexbridge-auto-watch-completion.ts';
import { dispatchAnswerCompletionNotifications } from '../src/content/answer-completion-notifications.ts';
import { harness, settle, turn, FakeMutationObserver } from './conversation-statistics-controller-fixture.ts';

const THREAD_ONE = '01a207cf-52ab-7900-a91d-3288982ab221';
const THREAD_TWO = '01a207d0-12ab-7c00-a911-3288982ab222';
const TURN_ID = '01a207d1-12ab-7c00-a911-3288982ab223';

test('回答本文では独立UUIDとtarget prefix付きBridge IDだけを重複排除して抽出する', () => {
  const result = extractCodexBridgeThreadIds(
    `対象 ${THREAD_ONE}。再掲 ${THREAD_ONE}。ID:${THREAD_ONE}. remote target-1::native_thread-7. 部分 x${THREAD_TWO}y。turn ${TURN_ID.slice(0, 35)}。`,
  );
  assert.deepEqual(result, {
    status: 'ok', threadIds: [THREAD_ONE, 'target-1::native_thread-7'],
  });
});

test('大きすぎる本文と32件を超える候補は全件スキップする', () => {
  assert.deepEqual(extractCodexBridgeThreadIds('x'.repeat(65_537)), { status: 'skipped', reason: 'answer-too-large' });
  const candidates = Array.from({ length: 33 }, (_, index) =>
    `01a207${index.toString(16).padStart(2, '0')}-52ab-7900-a91d-3288982ab221`).join(' ');
  assert.deepEqual(extractCodexBridgeThreadIds(candidates), { status: 'skipped', reason: 'too-many-thread-ids' });
});

test('AnswerCompletionTracker発火時に完了したその1ターンのIDだけを内部通知し、本文は渡さない', async () => {
  const prior = turn('prior-turn', '過去質問', `過去 ${THREAD_TWO}`, 'prior-assistant');
  const active = turn('active-turn', '質問', '', 'active-assistant', 'in_progress');
  let captured: unknown;
  const unsubscribe = subscribeCodexBridgeAutoWatchCompletion((notice) => { captured = notice; });
  const h = harness('/c/completion-owner', false, undefined, {
    onAnswerCompleted: (event, conversationId) => {
      publishCodexBridgeAutoWatchCompletion(h.document as unknown as Document, h.window.location.pathname, event, conversationId);
    },
  });
  h.document.root.append(prior, active);
  h.controller.start();
  await settle();

  const state = active.querySelectorAll('[data-talvt-turn-state]')[0]!;
  const dil = active.querySelectorAll('[data-dil-message-id]')[0]!;
  state.attributes['data-talvt-turn-state'] = 'complete';
  dil.text = `Thread ID: ${THREAD_ONE}`;
  FakeMutationObserver.latest?.notify(state, state);
  await settle();

  assert.deepEqual(captured, {
    conversationId: 'completion-owner',
    turnKey: 'active-turn',
    assistantMessageId: 'active-assistant',
    threadIds: [THREAD_ONE],
  });
  assert.equal(JSON.stringify(captured).includes('Thread ID:'), false);
  h.controller.stop();
  unsubscribe();
});

test('refresh後の既存complete回答は再通知せず、route不一致でも通知しない', async () => {
  const h = harness('/c/refresh-owner');
  const completed = turn('old-complete-turn', '質問', `ID ${THREAD_ONE}`, 'old-assistant');
  h.document.root.append(completed);
  let eventCount = 0;
  const unsubscribe = subscribeCodexBridgeAutoWatchCompletion(() => { eventCount += 1; });
  h.controller.start();
  await settle();
  assert.equal(eventCount, 0);

  publishCodexBridgeAutoWatchCompletion(h.document as unknown as Document, '/c/other-owner', {
    turnKey: 'old-complete-turn', assistantMessageId: 'old-assistant',
  }, 'refresh-owner');
  assert.equal(eventCount, 0);
  h.controller.stop();
  unsubscribe();
});

test('音声OFFまたは再生失敗でも回答完了の自動登録通知経路は動く', async () => {
  for (const [assistantId, soundEnabled, playbackFails] of [
    ['audio-off-assistant', false, false], ['playback-failure-assistant', true, true],
  ] as const) {
    const active = turn(`turn-${assistantId}`, '質問', '', assistantId, 'in_progress');
    let captured: unknown;
    const unsubscribe = subscribeCodexBridgeAutoWatchCompletion((notice) => { captured = notice; });
    const h = harness(`/c/${assistantId}`, false, undefined, {
      onAnswerCompleted: (event, conversationId) => {
        publishCodexBridgeAutoWatchCompletion(h.document as unknown as Document, h.window.location.pathname, event, conversationId);
        dispatchAnswerCompletionNotifications({ notifyTab() {}, soundEnabled, soundVolumePercent: 100,
          playSound() { if (playbackFails) throw new Error('muted or unavailable'); } });
      },
    });
    h.document.root.append(active);
    h.controller.start();
    await settle();
    active.querySelectorAll('[data-talvt-turn-state]')[0]!.attributes['data-talvt-turn-state'] = 'complete';
    active.querySelectorAll('[data-dil-message-id]')[0]!.text = `Thread ${THREAD_ONE}`;
    FakeMutationObserver.latest?.notify(active, active);
    await settle();
    assert.deepEqual((captured as { threadIds: readonly string[] } | undefined)?.threadIds, [THREAD_ONE]);
    h.controller.stop();
    unsubscribe();
  }
});
