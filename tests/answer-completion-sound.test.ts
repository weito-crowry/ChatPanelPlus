import assert from 'node:assert/strict';
import test from 'node:test';
import { AnswerCompletionSoundPlayer, AnswerCompletionTracker } from '../src/content/answer-completion-sound.ts';
import { previewCompletionSound } from '../src/shared/answer-completion-sound-playback.ts';
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

test('選択した内蔵音の音程と通知向け音量を使い、ユーザー音源が消えたら既定短音へ戻る', async () => {
  const target = new EventTarget();
  const frequencies: number[] = [];
  const peaks: number[] = [];
  const context = {
    state: 'running', currentTime: 0, destination: {},
    close() { this.state = 'closed'; return Promise.resolve(); },
    createOscillator() {
      return { type: 'sine', frequency: { setValueAtTime(value: number) { frequencies.push(value); } }, connect() {}, start() {}, stop() {} };
    },
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime(value: number) { peaks.push(value); } }, connect() {} };
    },
  };
  const player = new AnswerCompletionSoundPlayer(target as Document, () => context as unknown as AudioContext);
  player.setEnabled(true);
  const gesture = new Event('pointerdown');
  Object.defineProperty(gesture, 'isTrusted', { value: true });
  target.dispatchEvent(gesture);
  player.setSoundId('two-tone');
  player.play();
  assert.deepEqual(frequencies, [587.33, 783.99]);
  assert.deepEqual(peaks.filter((volume) => volume > 0.001), [0.18, 0.18]);
  player.dispose();

  frequencies.length = 0;
  context.state = 'running';
  const fallback = new AnswerCompletionSoundPlayer(target as Document, () => context as unknown as AudioContext, async () => undefined);
  fallback.setEnabled(true);
  target.dispatchEvent(gesture);
  fallback.setSoundId('user-00000000-0000-4000-8000-000000000001');
  fallback.play();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(frequencies, [660]);
  fallback.dispose();
});

test('通知音とユーザー音源は既定音量または指定音量を共有する', async () => {
  const target = new EventTarget();
  const peaks: number[] = [];
  const context = {
    state: 'running', currentTime: 0, destination: {},
    close() { this.state = 'closed'; return Promise.resolve(); },
    async decodeAudioData() { return { duration: 0.4 } as AudioBuffer; },
    createOscillator() {
      return { type: 'sine', frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} };
    },
    createBufferSource() { return { buffer: null, connect() {}, start() {} }; },
    createGain() {
      return { gain: { setValueAtTime(value: number) { if (value > 0.001) peaks.push(value); }, exponentialRampToValueAtTime(value: number) { if (value > 0.001) peaks.push(value); } }, connect() {} };
    },
  };
  const selected = 'user-00000000-0000-4000-8000-000000000001';
  const player = new AnswerCompletionSoundPlayer(
    target as Document,
    () => context as unknown as AudioContext,
    async (id) => ({ id, name: 'notice.wav', mimeType: 'audio/wav', data: 'AA==', sizeBytes: 1, durationSeconds: 0.4 }),
  );
  player.setEnabled(true);
  const gesture = new Event('pointerdown');
  Object.defineProperty(gesture, 'isTrusted', { value: true });
  target.dispatchEvent(gesture);
  player.setSoundId(selected);
  player.setVolumePercent(40);
  player.play();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(peaks, [0.12]);
  player.dispose();

  context.state = 'running';
  peaks.length = 0;
  const builtin = new AnswerCompletionSoundPlayer(target as Document, () => context as unknown as AudioContext);
  builtin.setEnabled(true);
  target.dispatchEvent(gesture);
  builtin.setVolumePercent(40);
  builtin.play();
  assert.deepEqual(peaks.filter((volume) => volume > 0.001), [0.12]);
  builtin.dispose();

  context.state = 'running';
  peaks.length = 0;
  const muted = new AnswerCompletionSoundPlayer(target as Document, () => context as unknown as AudioContext);
  muted.setEnabled(true);
  muted.setVolumePercent(0);
  target.dispatchEvent(gesture);
  muted.play();
  assert.deepEqual(peaks, []);
  muted.dispose();
});

test('ユーザー音源はAudioContextでデコードして再生し、設定変更後の遅延ロードは破棄する', async () => {
  const target = new EventTarget();
  let resolveAsset: ((asset: { id: string; name: string; mimeType: 'audio/wav'; data: string; sizeBytes: number; durationSeconds: number }) => void) | undefined;
  let decoded = 0;
  let starts = 0;
  const context = {
    state: 'running', currentTime: 0, destination: {},
    close() { this.state = 'closed'; return Promise.resolve(); },
    async decodeAudioData() { decoded += 1; return { duration: 0.4 } as AudioBuffer; },
    createBufferSource() { return { buffer: null, connect() {}, start() { starts += 1; } }; },
    createGain() { return { gain: { setValueAtTime() {} }, connect() {} }; },
  };
  const player = new AnswerCompletionSoundPlayer(
    target as Document,
    () => context as unknown as AudioContext,
    () => new Promise((resolve) => { resolveAsset = resolve; }),
  );
  player.setEnabled(true);
  const gesture = new Event('pointerdown');
  Object.defineProperty(gesture, 'isTrusted', { value: true });
  target.dispatchEvent(gesture);
  const selected = 'user-00000000-0000-4000-8000-000000000001';
  player.setSoundId(selected);
  player.play();
  player.setSoundId('tone-660');
  resolveAsset?.({ id: selected, name: 'notice.wav', mimeType: 'audio/wav', data: 'AA==', sizeBytes: 1, durationSeconds: 0.4 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(decoded, 0);
  assert.equal(starts, 0);
  player.dispose();

  context.state = 'running';
  const successful = new AnswerCompletionSoundPlayer(
    target as Document,
    () => context as unknown as AudioContext,
    async (id) => ({ id, name: 'notice.wav', mimeType: 'audio/wav', data: 'AA==', sizeBytes: 1, durationSeconds: 0.4 }),
  );
  successful.setEnabled(true);
  target.dispatchEvent(gesture);
  successful.setSoundId(selected);
  successful.play();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(decoded, 1);
  assert.equal(starts, 1);
  successful.dispose();
});

test('Optionsの明示試聴はミュート設定と独立し、クリック処理中にAudioContextをresumeする', async () => {
  const target = new EventTarget();
  let resumes = 0;
  let starts = 0;
  const context = {
    state: 'suspended', currentTime: 0, destination: {},
    resume() { resumes += 1; this.state = 'running'; return Promise.resolve(); },
    close() { this.state = 'closed'; return Promise.resolve(); },
    createOscillator() {
      return { type: 'sine', frequency: { setValueAtTime() {} }, connect() {}, start() { starts += 1; }, stop() {} };
    },
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; },
  };
  const preview = previewCompletionSound(target as Document, 'tone-660', undefined, () => context as unknown as AudioContext);
  assert.equal(resumes, 1);
  assert.equal(await preview, true);
  assert.equal(starts, 1);
});

test('内蔵音とユーザー音源の試聴は同じdraft音量をgainへ適用する', async () => {
  const target = new EventTarget();
  const peaks: number[] = [];
  const makeContext = () => ({
    state: 'running', currentTime: 0, destination: {},
    resume() { return Promise.resolve(); },
    close() { this.state = 'closed'; return Promise.resolve(); },
    async decodeAudioData() { return { duration: 0.4 } as AudioBuffer; },
    createOscillator() {
      return { type: 'sine', frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} };
    },
    createBufferSource() { return { buffer: null, connect() {}, start() {} }; },
    createGain() {
      return { gain: { setValueAtTime(value: number) { if (value > 0.001) peaks.push(value); }, exponentialRampToValueAtTime(value: number) { if (value > 0.001) peaks.push(value); } }, connect() {} };
    },
  });
  assert.equal(await previewCompletionSound(target as Document, 'tone-660', undefined, () => makeContext() as unknown as AudioContext, 40), true);
  assert.deepEqual(peaks, [0.12]);

  peaks.length = 0;
  const asset = { id: 'user-00000000-0000-4000-8000-000000000001', name: 'notice.wav', mimeType: 'audio/wav' as const, data: 'AA==', sizeBytes: 1, durationSeconds: 0.4 };
  assert.equal(await previewCompletionSound(target as Document, asset.id, asset, () => makeContext() as unknown as AudioContext, 40), true);
  assert.deepEqual(peaks, [0.12]);

  let zeroVolumeContextCalls = 0;
  assert.equal(await previewCompletionSound(target as Document, 'tone-660', undefined, () => {
    zeroVolumeContextCalls += 1;
    return makeContext() as unknown as AudioContext;
  }, 0), false);
  assert.equal(zeroVolumeContextCalls, 0);
});

test('10秒ユーザー音源を通知・試聴でき、試聴の非常用タイマーは再生長に合わせる', async () => {
  const target = new EventTarget();
  const asset = {
    id: 'user-00000000-0000-4000-8000-000000000001',
    name: 'notice.wav', mimeType: 'audio/wav' as const, data: 'AA==', sizeBytes: 1, durationSeconds: 10,
  };
  let notificationStarts = 0;
  let notificationStops = 0;
  let resolveNotificationStart: (() => void) | undefined;
  const notificationStarted = new Promise<void>((resolve) => { resolveNotificationStart = resolve; });
  const notificationSource = {
    buffer: null as AudioBuffer | null,
    onended: null as (() => void) | null,
    connect() {},
    start() { notificationStarts += 1; resolveNotificationStart?.(); },
    stop() { notificationStops += 1; },
  };
  const notificationContext = {
    state: 'running', currentTime: 0, destination: {},
    async decodeAudioData() { return { duration: 10 } as AudioBuffer; },
    createBufferSource() { return notificationSource; },
    createGain() { return { gain: { setValueAtTime() {} }, connect() {} }; },
    close() { this.state = 'closed'; return Promise.resolve(); },
  };
  const player = new AnswerCompletionSoundPlayer(
    target as Document,
    () => notificationContext as unknown as AudioContext,
    async () => asset,
  );
  player.setEnabled(true);
  const gesture = new Event('pointerdown');
  Object.defineProperty(gesture, 'isTrusted', { value: true });
  target.dispatchEvent(gesture);
  player.setSoundId(asset.id);
  player.play();
  await notificationStarted;
  assert.equal(notificationSource.buffer?.duration, 10);
  assert.equal(notificationStarts, 1);
  assert.equal(notificationStops, 0);
  player.dispose();

  let timeoutDelay: number | undefined;
  const previewSource = {
    buffer: null as AudioBuffer | null,
    onended: null as (() => void) | null,
    connect() {},
    start() {},
  };
  const previewContext = {
    state: 'running', currentTime: 0, destination: {},
    async decodeAudioData() { return { duration: 10 } as AudioBuffer; },
    createBufferSource() { return previewSource; },
    createGain() { return { gain: { setValueAtTime() {} }, connect() {} }; },
    close() { return Promise.resolve(); },
  };
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
    void callback;
    timeoutDelay = delay;
    return 1 as unknown as ReturnType<typeof globalThis.setTimeout>;
  }) as unknown as typeof globalThis.setTimeout;
  let previewed: boolean;
  try {
    previewed = await previewCompletionSound(target as Document, asset.id, asset, () => previewContext as unknown as AudioContext);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.equal(previewed, true);
  assert.equal(previewSource.buffer?.duration, 10);
  assert.equal(timeoutDelay, 10_500);
});

test('試聴音源のonendedとcleanup timerが競合してもContextを一度だけ閉じる', async () => {
  const target = new EventTarget();
  const asset = {
    id: 'user-00000000-0000-4000-8000-000000000001',
    name: 'notice.wav', mimeType: 'audio/wav' as const, data: 'AA==', sizeBytes: 1, durationSeconds: 10,
  };
  let closeCalls = 0;
  let timerCallback: (() => void) | undefined;
  let timeoutCleared = false;
  const source = {
    buffer: null as AudioBuffer | null,
    onended: null as (() => void) | null,
    connect() {},
    start() {},
  };
  const context = {
    state: 'running', currentTime: 0, destination: {},
    async decodeAudioData() { return { duration: 10 } as AudioBuffer; },
    createBufferSource() { return source; },
    createGain() { return { gain: { setValueAtTime() {} }, connect() {} }; },
    close() { closeCalls += 1; return Promise.resolve(); },
  };
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((callback: TimerHandler) => {
    if (typeof callback === 'function') timerCallback = callback as () => void;
    return 1 as unknown as ReturnType<typeof globalThis.setTimeout>;
  }) as unknown as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((timeout: ReturnType<typeof globalThis.setTimeout>) => {
    timeoutCleared = timeout === 1 as unknown as ReturnType<typeof globalThis.setTimeout>;
  }) as typeof globalThis.clearTimeout;
  let previewed: boolean;
  try {
    previewed = await previewCompletionSound(target as Document, asset.id, asset, () => context as unknown as AudioContext);
    source.onended?.();
    timerCallback?.();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
  assert.equal(previewed, true);
  assert.equal(closeCalls, 1);
  assert.equal(timeoutCleared, true);
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
