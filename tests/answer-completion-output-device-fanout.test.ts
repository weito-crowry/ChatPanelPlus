import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_ANSWER_COMPLETION_OUTPUT_DEVICES } from '../src/shared/answer-completion-output-device.ts';
import {
  isOffscreenAnswerCompletionSoundRequest,
  isOffscreenPlaybackResult,
} from '../src/shared/answer-completion-output-device-protocol.ts';
import { playAnswerCompletionSoundOffscreen } from '../src/offscreen/answer-completion-audio.ts';

function audioContext(options: { failSink?: string } = {}) {
  const events: string[] = [];
  let source: { onended: (() => void) | null } | null = null;
  let closed = false;
  const context = {
    currentTime: 0,
    get state() { return closed ? 'closed' : 'running'; },
    destination: {},
    async setSinkId(deviceId: string) {
      events.push(`sink:${deviceId}`);
      if (deviceId === options.failSink) throw new DOMException('', 'NotFoundError');
    },
    async resume() { events.push('resume'); },
    async close() { closed = true; events.push('close'); },
    createOscillator() {
      source = { onended: null };
      return { type: 'sine', frequency: { setValueAtTime() {} }, connect() {}, start() { events.push('start'); }, stop() {},
        get onended() { return source?.onended ?? null; }, set onended(value: (() => void) | null) { if (source) source.onended = value; } };
    },
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; },
  };
  return { context: context as unknown as AudioContext, events, end() { source?.onended?.(); }, isClosed: () => closed };
}

test('Offscreen requestは一意な複数deviceIdを許可し、default混在・重複・上限超過を拒否する', () => {
  const base = { type: 'CPP_OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND', soundId: 'tone-660', volumePercent: 50 };
  assert.equal(isOffscreenAnswerCompletionSoundRequest({ ...base, deviceIds: ['usb-1', 'usb-2'] }), true);
  assert.equal(isOffscreenAnswerCompletionSoundRequest({ ...base, deviceIds: ['default'] }), true);
  assert.equal(isOffscreenAnswerCompletionSoundRequest({ ...base, deviceIds: [] }), false);
  assert.equal(isOffscreenAnswerCompletionSoundRequest({ ...base, deviceIds: ['default', 'usb-1'] }), false);
  assert.equal(isOffscreenAnswerCompletionSoundRequest({ ...base, deviceIds: ['usb-1', 'usb-1'] }), false);
  assert.equal(isOffscreenAnswerCompletionSoundRequest({ ...base,
    deviceIds: Array.from({ length: MAX_ANSWER_COMPLETION_OUTPUT_DEVICES + 1 }, (_, index) => `usb-${index}`) }), false);
});

test('各出力は独立AudioContextで同じ音を並行再生し、全成功件数を返す', async () => {
  const contexts = [audioContext(), audioContext(), audioContext()];
  let next = 0;
  const result = await playAnswerCompletionSoundOffscreen({
    type: 'CPP_OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND', deviceIds: ['usb-1', 'usb-2', 'usb-3'],
    soundId: 'tone-660', volumePercent: 37,
  }, () => contexts[next++]!.context);
  assert.deepEqual(result, { ok: true, status: 'complete', outputCount: 3, succeededCount: 3, failures: [] });
  assert.deepEqual(contexts.map(({ events }) => events.filter((event) => event.startsWith('sink:'))),
    [['sink:usb-1'], ['sink:usb-2'], ['sink:usb-3']]);
  assert.equal(new Set(contexts.map(({ context }) => context)).size, 3);
  for (const item of contexts) item.end();
  assert.deepEqual(contexts.map(({ isClosed }) => isClosed()), [true, true, true]);
});

test('sink拒否とfactory例外は他出力を止めず、部分成功を返す', async () => {
  const first = audioContext();
  const second = audioContext({ failSink: 'usb-2' });
  let calls = 0;
  const result = await playAnswerCompletionSoundOffscreen({
    type: 'CPP_OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND', deviceIds: ['usb-1', 'usb-2', 'usb-3'],
    soundId: 'tone-660', volumePercent: 50,
  }, () => {
    calls += 1;
    if (calls === 1) return first.context;
    if (calls === 2) return second.context;
    throw new Error('AudioContext unavailable');
  });
  assert.deepEqual(result, { ok: true, status: 'partial', outputCount: 3, succeededCount: 1,
    failures: ['device-unavailable', 'playback-failed'] });
  assert.equal(first.events.includes('start'), true);
  assert.equal(second.isClosed(), true);
  first.end();
});

test('全出力失敗はrejectionへせずfailed集計にし、部分成功結果validatorは厳密', async () => {
  const result = await playAnswerCompletionSoundOffscreen({
    type: 'CPP_OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND', deviceIds: ['usb-1', 'usb-2'],
    soundId: 'tone-660', volumePercent: 50,
  }, () => { throw new Error('AudioContext unavailable'); });
  assert.deepEqual(result, { ok: false, status: 'failed', outputCount: 2, succeededCount: 0,
    failures: ['playback-failed', 'playback-failed'] });
  assert.equal(isOffscreenPlaybackResult(result), true);
  assert.equal(isOffscreenPlaybackResult({ ...result, succeededCount: 1 }), false);
});
