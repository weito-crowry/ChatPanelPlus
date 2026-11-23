import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCodexBridgeAutoWatchCandidatesMessage,
  createCodexBridgeAutoWatchCompletionMessage,
  matchKnownBridgeRunningThreadIds,
  publishCodexBridgeAutoWatchCompletion,
  subscribeCodexBridgeAutoWatchCompletion,
} from '../src/content/codexbridge-auto-watch-completion.ts';
import { dispatchAnswerCompletionNotifications } from '../src/content/answer-completion-notifications.ts';
import { harness, settle, turn, FakeMutationObserver } from './conversation-statistics-controller-fixture.ts';

const THREAD_A = '01a207cf-52ab-7900-a91d-3288982ab221';
const THREAD_B = '01a207d0-12ab-7c00-a911-3288982ab222';
const completionEvent = { turnKey: 'completed-turn', assistantMessageId: 'assistant-message' };
const completionNotice = { conversationId: 'owner', ...completionEvent };

test('Bridge候補IDだけを回答本文に照合し、関係ないUUIDは候補にも上限にも使わない', () => {
  const noise = Array.from({ length: 80 }, (_, index) =>
    `09a207${index.toString(16).padStart(2, '0')}-52ab-7900-a91d-3288982ab221`).join(' ');
  assert.deepEqual(matchKnownBridgeRunningThreadIds(`${noise} ${THREAD_A}`, 'target-1', [THREAD_A, THREAD_B]), {
    status: 'ok', threadIds: [THREAD_A],
  });
});

test('大きすぎる回答と32件を超えるBridge ID一致は登録候補を返さない', () => {
  assert.deepEqual(matchKnownBridgeRunningThreadIds('x'.repeat(65_537), 'target-1', [THREAD_A]), {
    status: 'skipped', reason: 'answer-too-large',
  });
  const ids = Array.from({ length: 33 }, (_, index) =>
    `01a207${index.toString(16).padStart(2, '0')}-52ab-7900-a91d-3288982ab221`);
  assert.deepEqual(matchKnownBridgeRunningThreadIds(ids.join(' '), 'target-1', ids), {
    status: 'skipped', reason: 'too-many-matches',
  });
});

test('AnswerCompletionTrackerは本文scanより前にidentity-only通知し、過去turnと本文を渡さない', async () => {
  const prior = turn('prior-turn', '過去質問', `過去 ${THREAD_B}`, 'prior-assistant');
  const active = turn('active-turn', '質問', '', 'active-assistant', 'in_progress');
  let captured: unknown;
  const unsubscribe = subscribeCodexBridgeAutoWatchCompletion((notice) => { captured = notice; });
  const h = harness('/c/completion-owner', false, undefined, {
    onAnswerCompleted: (event, conversationId) => {
      publishCodexBridgeAutoWatchCompletion(h.window.location.pathname, event, conversationId);
    },
  });
  h.document.root.append(prior, active);
  h.controller.start();
  await settle();

  const state = active.querySelectorAll('[data-talvt-turn-state]')[0]!;
  const dil = active.querySelectorAll('[data-dil-message-id]')[0]!;
  state.attributes['data-talvt-turn-state'] = 'complete';
  dil.text = `Thread ID: ${THREAD_A}`;
  FakeMutationObserver.latest?.notify(state, state);
  await settle();

  assert.deepEqual(captured, { conversationId: 'completion-owner', turnKey: 'active-turn', assistantMessageId: 'active-assistant' });
  assert.equal(JSON.stringify(captured).includes('Thread ID:'), false);
  h.controller.stop();
  unsubscribe();
});

test('refresh後の既存complete回答は再通知せず、route不一致でも候補requestを作らない', async () => {
  const h = harness('/c/owner');
  const completed = turn('old-complete-turn', '質問', `ID ${THREAD_A}`, 'old-assistant');
  h.document.root.append(completed);
  let eventCount = 0;
  const unsubscribe = subscribeCodexBridgeAutoWatchCompletion(() => { eventCount += 1; });
  h.controller.start();
  await settle();
  assert.equal(eventCount, 0);
  assert.equal(createCodexBridgeAutoWatchCandidatesMessage('target-1', 'owner', '/c/other', completionNotice), null);
  assert.deepEqual(publishCodexBridgeAutoWatchCompletion('/c/other', completionEvent, 'owner'), {
    status: 'skipped', reason: 'invalid-route',
  });
  assert.equal(eventCount, 0);
  h.controller.stop();
  unsubscribe();
});

test('音声OFFまたは再生失敗でも完了identity通知は動く', async () => {
  for (const [assistantId, soundEnabled, playbackFails] of [
    ['audio-off-assistant', false, false], ['playback-failure-assistant', true, true],
  ] as const) {
    const active = turn(`turn-${assistantId}`, '質問', '', assistantId, 'in_progress');
    let captured: unknown;
    const unsubscribe = subscribeCodexBridgeAutoWatchCompletion((notice) => { captured = notice; });
    const h = harness(`/c/${assistantId}`, false, undefined, {
      onAnswerCompleted: (event, conversationId) => {
        publishCodexBridgeAutoWatchCompletion(h.window.location.pathname, event, conversationId);
        dispatchAnswerCompletionNotifications({ notifyTab() {}, soundEnabled, soundVolumePercent: 100,
          playSound() { if (playbackFails) throw new Error('muted or unavailable'); } });
      },
    });
    h.document.root.append(active);
    h.controller.start();
    await settle();
    active.querySelectorAll('[data-talvt-turn-state]')[0]!.attributes['data-talvt-turn-state'] = 'complete';
    active.querySelectorAll('[data-dil-message-id]')[0]!.text = `Thread ${THREAD_A}`;
    FakeMutationObserver.latest?.notify(active, active);
    await settle();
    assert.deepEqual(captured, { conversationId: assistantId, turnKey: `turn-${assistantId}`, assistantMessageId: assistantId });
    h.controller.stop();
    unsubscribe();
  }
});

test('final registration requestにはcanonical Bridge IDとconnectionだけを含み、本文を含めない', () => {
  const message = createCodexBridgeAutoWatchCompletionMessage('target-1', 'connection-A', 'owner', '/c/owner',
    completionNotice, [THREAD_A]);
  assert.deepEqual(message, {
    type: 'CODEX_BRIDGE_AUTO_WATCH_COMPLETED', targetId: 'target-1', candidateConnectionId: 'connection-A',
    conversationId: 'owner', turnKey: 'completed-turn', assistantMessageId: 'assistant-message', threadIds: [THREAD_A],
  });
  assert.equal(JSON.stringify(message).includes('本文'), false);
  assert.equal(createCodexBridgeAutoWatchCompletionMessage('target-1', 'connection-A', 'owner', '/c/other',
    completionNotice, [THREAD_A]), null);
  assert.equal(createCodexBridgeAutoWatchCompletionMessage('target-1', 'connection-A', 'owner', '/c/owner',
    completionNotice, Array.from({ length: 33 }, (_, index) => `candidate-${index}`)), null);
});
