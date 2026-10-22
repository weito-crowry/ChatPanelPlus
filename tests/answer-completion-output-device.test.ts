import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY,
  AnswerCompletionOutputDeviceRepository,
  DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE,
  enumerateAudioOutputDevices,
  normalizeAudioOutputDevices,
  requestAudioOutputPermission,
  validateAnswerCompletionOutputDevice,
} from '../src/shared/answer-completion-output-device.ts';
import { createOutputDevicePlaybackMessageHandler } from '../src/background/answer-completion-output-device.ts';
import { playAnswerCompletionSoundOffscreen } from '../src/offscreen/answer-completion-audio.ts';
import { createOffscreenAudioTransport } from '../src/background/offscreen-audio-transport.ts';
import { routeAnswerCompletionSound } from '../src/content/answer-completion-output-device-route.ts';
import { DEFAULT_COMPLETION_SOUND_ID } from '../src/shared/answer-completion-sound-definitions.ts';
import { ANSWER_COMPLETION_SOUND_PREVIEW, ANSWER_COMPLETION_SOUND_ROUTE } from '../src/shared/answer-completion-output-device-protocol.ts';

test('列挙結果は出力だけに絞り、デバイスIDで重複を除く', () => {
  assert.deepEqual(normalizeAudioOutputDevices([
    { kind: 'audioinput', deviceId: 'mic-1', label: 'マイク' },
    { kind: 'audiooutput', deviceId: 'default', label: 'システム既定' },
    { kind: 'audiooutput', deviceId: 'headphones-1', label: 'ヘッドホン' },
    { kind: 'audiooutput', deviceId: 'headphones-1', label: '別名' },
    { kind: 'audiooutput', deviceId: '', label: '' },
  ]), [
    { deviceId: 'default', label: 'システムの既定' },
    { deviceId: 'headphones-1', label: 'ヘッドホン' },
  ]);
  assert.deepEqual(normalizeAudioOutputDevices([{ kind: 'audioinput', deviceId: 'mic', label: 'マイク' }]), []);
});

test('出力一覧APIの未対応・拒否・空一覧を区別する', async () => {
  assert.deepEqual(await enumerateAudioOutputDevices(undefined), { ok: false, reason: 'unsupported' });
  assert.deepEqual(await enumerateAudioOutputDevices({ enumerateDevices: async () => [] }), { ok: true, devices: [] });
  assert.deepEqual(await enumerateAudioOutputDevices({ enumerateDevices: async () => { throw new DOMException('', 'NotAllowedError'); } }), {
    ok: false, reason: 'permission-denied',
  });
});

test('出力先の保存値を検証し、既定値に正規化する', () => {
  assert.deepEqual(validateAnswerCompletionOutputDevice({ deviceId: 'default', label: '任意の表示名' }), DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE);
  assert.deepEqual(validateAnswerCompletionOutputDevice({ deviceId: 'aB09+/=', label: 'USBヘッドセット' }), {
    deviceId: 'aB09+/=', label: 'USBヘッドセット',
  });
  for (const invalid of [null, [], {}, { deviceId: '', label: 'x' }, { deviceId: '  x', label: 'x' },
    { deviceId: 'x\n', label: 'x' }, { deviceId: 'x'.repeat(513), label: 'x' },
    { deviceId: 'x', label: 'y'.repeat(257) }, { deviceId: 'https://example.test', label: 'x' }]) {
    assert.equal(validateAnswerCompletionOutputDevice(invalid), null);
  }
});

test('出力先を保存・再読込し、storage変更を購読できる', async () => {
  const values: Record<string, unknown> = {};
  const listeners: Array<(changes: Record<string, { newValue?: unknown }>, area: string) => void> = [];
  const repository = new AnswerCompletionOutputDeviceRepository({
    async get(keys) { return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]])); },
    async set(items) { Object.assign(values, items); },
  }, {
    addListener(listener) { listeners.push(listener); },
    removeListener(listener) { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1); },
  });
  assert.deepEqual(await repository.load(), { ok: true, device: DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE });
  assert.deepEqual(await repository.save({ deviceId: 'usb-64', label: 'USB' }), { ok: true, device: { deviceId: 'usb-64', label: 'USB' } });
  assert.equal(values[ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY] instanceof Object, true);
  assert.deepEqual(await repository.load(), { ok: true, device: { deviceId: 'usb-64', label: 'USB' } });
  const updates: unknown[] = [];
  const unsubscribe = repository.subscribe((result) => updates.push(result));
  for (const listener of listeners) listener({ [ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY]: { newValue: { deviceId: 'usb-2', label: '別のUSB' } } }, 'local');
  assert.deepEqual(updates, [{ ok: true, device: { deviceId: 'usb-2', label: '別のUSB' } }]);
  unsubscribe();
  assert.equal(listeners.length, 0);
});

test('保存エラーと破損値は既存の出力先を上書きしない', async () => {
  let current: unknown = { deviceId: 'usb-old', label: '既存' };
  let failSave = false;
  const repository = new AnswerCompletionOutputDeviceRepository({
    async get() { return { [ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY]: current }; },
    async set(items) { if (failSave) throw new Error('quota'); current = items[ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY]; },
  });
  assert.deepEqual(await repository.save({ deviceId: 'invalid\n', label: '破損' }), { ok: false, reason: 'invalid-selection' });
  failSave = true;
  assert.deepEqual(await repository.save({ deviceId: 'usb-new', label: '新規' }), { ok: false, reason: 'storage-failed' });
  assert.deepEqual(await repository.load(), { ok: true, device: { deviceId: 'usb-old', label: '既存' } });
});

test('明示されたマイク権限操作は取得した全トラックを直ちに停止する', async () => {
  const stopped: string[] = [];
  const result = await requestAudioOutputPermission({
    async getUserMedia() {
      return { getTracks: () => [
        { stop: () => { stopped.push('track-1'); } },
        { stop: () => { stopped.push('track-2'); } },
      ] };
    },
  });
  assert.deepEqual(result, { ok: true, stoppedTracks: 2 });
  assert.deepEqual(stopped, ['track-1', 'track-2']);
  assert.deepEqual(await requestAudioOutputPermission({ getUserMedia: async () => { throw new DOMException('', 'NotAllowedError'); } }), {
    ok: false, reason: 'permission-denied',
  });
});

test('既定出力は既存Content Script再生を選び、Offscreenを起動しない', async () => {
  let offscreenCalls = 0;
  const handler = createOutputDevicePlaybackMessageHandler({
    loadOutputDevice: async () => ({ ok: true, device: DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE }),
    loadAssets: async () => ({ ok: true, assets: [] }),
    playOffscreen: async () => { offscreenCalls += 1; return { ok: true }; },
  });
  assert.deepEqual(await handler({ type: ANSWER_COMPLETION_SOUND_ROUTE, soundId: DEFAULT_COMPLETION_SOUND_ID, volumePercent: 50 }, {
    id: 'extension-id', tab: { url: 'https://chatgpt.com/c/abc' },
  }, 'extension-id'), { ok: true, route: 'default' });
  assert.equal(offscreenCalls, 0);
});

test('指定出力の試聴と回答完了音は同じOffscreen経路を使う', async () => {
  const storedDevice = { deviceId: 'usb-headset-64', label: 'USBヘッドセット' };
  const storedAsset = {
    id: 'user-12345678-1234-4234-9234-123456789abc', name: 'ding.wav', mimeType: 'audio/wav' as const,
    data: 'UklGRg==', sizeBytes: 4, durationSeconds: 0.25,
  };
  const sent: unknown[] = [];
  const handler = createOutputDevicePlaybackMessageHandler({
    loadOutputDevice: async () => ({ ok: true, device: storedDevice }),
    loadAssets: async () => ({ ok: true, assets: [storedAsset] }),
    playOffscreen: async (request) => { sent.push(request); return { ok: true }; },
  });
  for (const type of [ANSWER_COMPLETION_SOUND_ROUTE, ANSWER_COMPLETION_SOUND_PREVIEW]) {
    assert.deepEqual(await handler({ type, soundId: storedAsset.id, volumePercent: 73 }, {
      id: 'extension-id', url: 'chrome-extension://extension-id/index.html', tab: { url: 'https://chatgpt.com/' },
    }, 'extension-id'), { ok: true, route: 'device' });
  }
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], {
    type: 'CPP_OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND', deviceId: storedDevice.deviceId,
    soundId: storedAsset.id, volumePercent: 73, asset: storedAsset,
  });
  assert.deepEqual(sent[1], sent[0]);
});

test('指定先でのsetSinkId失敗はエラーとして返し、既定出力へ送らない', async () => {
  let offscreenCalls = 0;
  const handler = createOutputDevicePlaybackMessageHandler({
    loadOutputDevice: async () => ({ ok: true, device: { deviceId: 'removed-device-64', label: '切断済み' } }),
    loadAssets: async () => ({ ok: true, assets: [] }),
    playOffscreen: async () => { offscreenCalls += 1; return { ok: false, reason: 'device-unavailable' }; },
  });
  assert.deepEqual(await handler({ type: ANSWER_COMPLETION_SOUND_ROUTE, soundId: DEFAULT_COMPLETION_SOUND_ID, volumePercent: 50 }, {
    id: 'extension-id', tab: { url: 'https://chatgpt.com/c/abc' },
  }, 'extension-id'), { ok: false, reason: 'device-unavailable' });
  assert.equal(offscreenCalls, 1);
});

test('外部ページや不正な再生指定は処理しない', async () => {
  let offscreenCalls = 0;
  const handler = createOutputDevicePlaybackMessageHandler({
    loadOutputDevice: async () => ({ ok: true, device: { deviceId: 'usb-64', label: 'USB' } }),
    loadAssets: async () => ({ ok: true, assets: [] }),
    playOffscreen: async () => { offscreenCalls += 1; return { ok: true }; },
  });
  assert.equal(await handler({ type: ANSWER_COMPLETION_SOUND_ROUTE, soundId: DEFAULT_COMPLETION_SOUND_ID, volumePercent: 50 }, {
    id: 'other-extension', tab: { url: 'https://chatgpt.com/' },
  }, 'extension-id'), undefined);
  assert.equal(await handler({ type: ANSWER_COMPLETION_SOUND_ROUTE, soundId: 'https://evil.invalid', volumePercent: 50 }, {
    id: 'extension-id', tab: { url: 'https://chatgpt.com/' },
  }, 'extension-id'), undefined);
  assert.equal(offscreenCalls, 0);
});

test('Offscreenは再生前に指定先を確定し、AudioContext.setSinkId失敗で既定へ出さない', async () => {
  const events: string[] = [];
  let state = 'suspended';
  const context = {
    currentTime: 0,
    get state() { return state; },
    destination: {},
    async setSinkId(deviceId: string) { events.push(`sink:${deviceId}`); },
    async resume() { events.push('resume'); state = 'running'; },
    async close() { state = 'closed'; },
    createOscillator() {
      return {
        type: 'sine', frequency: { setValueAtTime() {} }, connect() {},
        start() { events.push('start'); }, stop() {}, onended: null as (() => void) | null,
      };
    },
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; },
  };
  const result = await playAnswerCompletionSoundOffscreen({
    type: 'CPP_OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND', deviceId: 'usb-headset-64',
    soundId: DEFAULT_COMPLETION_SOUND_ID, volumePercent: 50,
  }, () => context as unknown as AudioContext);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(events, ['sink:usb-headset-64', 'resume', 'start']);

  events.length = 0;
  const assetId = 'user-12345678-1234-4234-9234-123456789abc';
  const assetContext = {
    currentTime: 0,
    get state() { return state; },
    destination: {},
    async setSinkId(deviceId: string) { events.push(`sink:${deviceId}`); },
    async resume() { events.push('resume'); state = 'running'; },
    async close() { state = 'closed'; },
    async decodeAudioData() { events.push('decode'); return { duration: 0.2 }; },
    createBufferSource() {
      return { buffer: null as unknown, connect() {}, start() { events.push('asset-start'); }, onended: null as (() => void) | null };
    },
    createGain() { return { gain: { setValueAtTime() {} }, connect() {} }; },
  };
  state = 'suspended';
  assert.deepEqual(await playAnswerCompletionSoundOffscreen({
    type: 'CPP_OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND', deviceId: 'usb-headset-64',
    soundId: assetId, volumePercent: 50,
    asset: { id: assetId, name: 'ding.wav', mimeType: 'audio/wav', data: 'YWJj', sizeBytes: 3, durationSeconds: 0.2 },
  }, () => assetContext as unknown as AudioContext), { ok: true });
  assert.deepEqual(events, ['sink:usb-headset-64', 'resume', 'decode', 'asset-start']);

  state = 'suspended';
  const missing = await playAnswerCompletionSoundOffscreen({
    type: 'CPP_OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND', deviceId: 'removed-device-64',
    soundId: DEFAULT_COMPLETION_SOUND_ID, volumePercent: 50,
  }, () => ({ ...context, async setSinkId() { throw new DOMException('', 'NotFoundError'); } } as unknown as AudioContext));
  assert.deepEqual(missing, { ok: false, reason: 'device-unavailable' });
});

test('同時要求でOffscreenを二重生成せず、終了後の次要求で再作成する', async () => {
  let open = false;
  let creates = 0;
  let sends = 0;
  const transport = createOffscreenAudioTransport({
    async createDocument() {
      creates += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      open = true;
    },
  }, {
    async getContexts() { return open ? [{}] : []; },
    async sendMessage() { sends += 1; return { ok: true }; },
  }, 'chrome-extension://extension-id/offscreen.html');
  const request = {
    type: 'CPP_OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND' as const,
    deviceId: 'usb-64', soundId: DEFAULT_COMPLETION_SOUND_ID, volumePercent: 40,
  };
  assert.deepEqual(await Promise.all([transport.play(request), transport.play(request)]), [{ ok: true }, { ok: true }]);
  assert.equal(creates, 1);
  assert.equal(sends, 2);
  open = false;
  assert.deepEqual(await transport.play(request), { ok: true });
  assert.equal(creates, 2);
  assert.equal(sends, 3);
});

test('Content Scriptはbackgroundが既定を確定したときだけ既存再生を1回呼ぶ', async () => {
  let localStarts = 0;
  const errors: string[] = [];
  const message = { soundId: DEFAULT_COMPLETION_SOUND_ID, volumePercent: 60 };
  const runtime = { async sendMessage() { return { ok: true, route: 'default' }; } };
  await routeAnswerCompletionSound(runtime, message, () => { localStarts += 1; }, (reason) => errors.push(reason));
  assert.equal(localStarts, 1);
  assert.deepEqual(errors, []);
});

test('Content Scriptは指定先成功時と失敗時に既定経路へ重複再生しない', async () => {
  let localStarts = 0;
  const errors: string[] = [];
  const message = { soundId: DEFAULT_COMPLETION_SOUND_ID, volumePercent: 60 };
  await routeAnswerCompletionSound({ async sendMessage() { return { ok: true, route: 'device' }; } }, message,
    () => { localStarts += 1; }, (reason) => errors.push(reason));
  await routeAnswerCompletionSound({ async sendMessage() { return { ok: false, reason: 'device-unavailable' }; } }, message,
    () => { localStarts += 1; }, (reason) => errors.push(reason));
  assert.equal(localStarts, 0);
  assert.deepEqual(errors, ['device-unavailable']);
});
