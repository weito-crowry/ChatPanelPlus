import assert from 'node:assert/strict';
import test from 'node:test';
import { createStatisticsStore } from '../src/shared/conversation-statistics.ts';
import { FakeMutationObserver, harness, settle, turn } from './conversation-statistics-controller-fixture.ts';

test('統計controllerは音声と独立して完了検出結果をIDなしで通知する', async () => {
  const checks: Array<{ eventDetected: boolean; reason: string | null }> = [];
  const h = harness('/c/sound-conversation', false, createStatisticsStore(), {
    onAnswerCompletionChecked: (eventDetected, reason) => checks.push({ eventDetected, reason }),
  });
  const answer = turn('sound-turn', '質問', '回答', 'sound-answer');
  h.document.root.append(answer);
  h.controller.start();
  await settle();
  const state = answer.querySelectorAll('[data-talvt-turn-state]')[0]!;
  state.attributes['data-talvt-turn-state'] = 'in_progress';
  FakeMutationObserver.latest?.notify(state, state);
  await settle();
  state.attributes['data-talvt-turn-state'] = 'complete';
  FakeMutationObserver.latest?.notify(state, state);
  await settle();
  assert.deepEqual(checks, [{ eventDetected: true, reason: null }]);
  h.controller.stop();
});

test('in_progressを観測できなかった完了は未検出理由を通知する', async () => {
  const checks: Array<{ eventDetected: boolean; reason: string | null }> = [];
  const h = harness('/c/sound-conversation', false, createStatisticsStore(), {
    onAnswerCompletionChecked: (eventDetected, reason) => checks.push({ eventDetected, reason }),
  });
  const answer = turn('sound-turn', '質問', '回答', 'sound-answer', 'unknown');
  h.document.root.append(answer);
  h.controller.start();
  await settle();
  const state = answer.querySelectorAll('[data-talvt-turn-state]')[0]!;
  state.attributes['data-talvt-turn-state'] = 'complete';
  FakeMutationObserver.latest?.notify(state, state);
  await settle();
  assert.deepEqual(checks, [{ eventDetected: false, reason: 'no-active-cycle' }]);
  h.controller.stop();
});
