import assert from 'node:assert/strict';
import test from 'node:test';
import {
  answerCompletionSoundGain,
  DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT,
} from '../src/shared/answer-completion-sound-volume.ts';

test('百分率から通知gainへ変換し、上限0.30を越えない', () => {
  assert.equal(DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT, 60);
  for (const [percent, gain] of [[0, 0], [25, 0.075], [60, 0.18], [100, 0.3]] as const) {
    assert.equal(answerCompletionSoundGain(percent), gain);
  }
  for (const invalid of [-1, 101, 20.5, Number.NaN]) assert.equal(answerCompletionSoundGain(invalid), 0);
});
