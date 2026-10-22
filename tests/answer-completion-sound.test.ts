import assert from 'node:assert/strict';
import test from 'node:test';
import { AnswerCompletionSoundPlayer, AnswerCompletionTracker } from '../src/content/answer-completion-sound.ts';
import type { TurnIdentity } from '../src/content/conversation-statistics-dom.ts';
import { createStatisticsStore } from '../src/shared/conversation-statistics.ts';
import { FakeMutationObserver, harness, settle, turn } from './conversation-statistics-controller-fixture.ts';

const complete: TurnIdentity = { turnKey: 'turn-a', assistantMessageId: 'answer-a', assistantState: 'complete' };
const inProgress: TurnIdentity = { ...complete, assistantState: 'in_progress' };

test('初回表示済み回答は通知せず、初期生成中回答は後の完了遷移でだけ通知する', () => {
  const tracker = new AnswerCompletionTracker();
  tracker.reset([complete, { ...inProgress, turnKey: 'turn-b' }]);

  assert.equal(tracker.observe(complete), null);
  assert.deepEqual(tracker.observe({ ...inProgress, turnKey: 'turn-b', assistantState: 'complete' }), {
    turnKey: 'turn-b', assistantMessageId: 'answer-a',
  });
});

test('基準化後のin_progressからcompleteへの遷移は1回だけ通知する', () => {
  const tracker = new AnswerCompletionTracker();
  tracker.reset([complete]);

  assert.equal(tracker.observe(inProgress), null);
  assert.deepEqual(tracker.observe(complete), { turnKey: 'turn-a', assistantMessageId: 'answer-a' });
  assert.equal(tracker.observe(complete), null);
});

test('同じTurn Keyの再生成は新しいin_progressを観測した場合に別通知する', () => {
  const tracker = new AnswerCompletionTracker();
  tracker.reset([complete]);
  tracker.observe(inProgress);
  tracker.observe(complete);

  assert.equal(tracker.observe({ ...inProgress, assistantMessageId: 'answer-b' }), null);
  assert.deepEqual(tracker.observe({ ...complete, assistantMessageId: 'answer-b' }), {
    turnKey: 'turn-a', assistantMessageId: 'answer-b',
  });
});

test('ID変更だけ・unknown・Assistant IDなしでは通知しない', () => {
  const tracker = new AnswerCompletionTracker();
  tracker.reset([complete]);

  assert.equal(tracker.observe({ ...complete, assistantMessageId: 'answer-b' }), null);
  tracker.observe({ ...inProgress, assistantState: 'unknown' });
  assert.equal(tracker.observe(complete), null);

  tracker.observe(inProgress);
  assert.equal(tracker.observe({ turnKey: 'turn-a', assistantState: 'complete' }), null);
  assert.deepEqual(tracker.observe(complete), { turnKey: 'turn-a', assistantMessageId: 'answer-a' });
});

test('基準化後に初めて現れたin_progress Turnは完了を通知し、SPAの再基準化では通知しない', () => {
  const tracker = new AnswerCompletionTracker();
  tracker.reset([complete]);
  const newTurn: TurnIdentity = { turnKey: 'turn-new', assistantMessageId: 'answer-new', assistantState: 'in_progress' };

  assert.equal(tracker.observe(newTurn), null);
  assert.deepEqual(tracker.observe({ ...newTurn, assistantState: 'complete' }), {
    turnKey: 'turn-new', assistantMessageId: 'answer-new',
  });

  tracker.reset([complete]);
  assert.equal(tracker.observe(complete), null);
});

test('音を有効にしたページ操作後だけ再生し、無効化でリスナーとAudioContextを解放する', () => {
  const target = new EventTarget();
  let factoryCalls = 0;
  let starts = 0;
  let stops = 0;
  const context = {
    state: 'suspended',
    currentTime: 0,
    destination: {},
    resume() { this.state = 'running'; return Promise.resolve(); },
    close() { this.state = 'closed'; return Promise.resolve(); },
    createOscillator() {
      return {
        type: 'sine',
        frequency: { setValueAtTime() {} },
        connect() {},
        start() { starts += 1; },
        stop() { stops += 1; },
      };
    },
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
      };
    },
  };
  const player = new AnswerCompletionSoundPlayer(target as Document, () => {
    factoryCalls += 1;
    return context as unknown as AudioContext;
  });

  player.play();
  assert.equal(factoryCalls, 0);
  player.setEnabled(true);
  target.dispatchEvent(new Event('pointerdown'));
  assert.equal(factoryCalls, 0);
  const gesture = new Event('pointerdown');
  Object.defineProperty(gesture, 'isTrusted', { value: true });
  target.dispatchEvent(gesture);
  player.play();
  assert.deepEqual([starts, stops], [1, 1]);

  player.setEnabled(false);
  assert.equal(context.state, 'closed');
  target.dispatchEvent(gesture);
  player.play();
  assert.equal(factoryCalls, 1);
  assert.deepEqual([starts, stops], [1, 1]);
  player.dispose();
});

test('Conversation Statisticsの既存Observerから識別済み完了サイクルを一度だけ通知する', async () => {
  const completions: Array<{ turnKey: string; assistantMessageId: string }> = [];
  const h = harness('/c/sound-conversation', false, createStatisticsStore(), {
    onAnswerCompleted: (event) => completions.push(event),
  });
  const answer = turn('sound-turn', '質問', '回答', 'sound-answer');
  h.document.root.append(answer);
  h.controller.start();
  await settle();
  assert.deepEqual(completions, []);

  const state = answer.querySelectorAll('[data-talvt-turn-state]')[0]!;
  state.attributes['data-talvt-turn-state'] = 'in_progress';
  FakeMutationObserver.latest?.notify(state, state);
  await settle();
  state.attributes['data-talvt-turn-state'] = 'complete';
  FakeMutationObserver.latest?.notify(state, state);
  await settle();
  FakeMutationObserver.latest?.notify(state, state);
  await settle();

  assert.deepEqual(completions, [{ turnKey: 'sound-turn', assistantMessageId: 'sound-answer' }]);
  h.controller.stop();
});
