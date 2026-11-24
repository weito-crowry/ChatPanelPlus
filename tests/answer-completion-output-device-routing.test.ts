import assert from 'node:assert/strict';
import test from 'node:test';
import { createOutputDevicePlaybackMessageHandler } from '../src/background/answer-completion-output-device.ts';
import { routeAnswerCompletionSound } from '../src/content/answer-completion-output-device-route.ts';
import { ANSWER_COMPLETION_SOUND_PREVIEW, ANSWER_COMPLETION_SOUND_ROUTE, type OffscreenPlaybackResult } from '../src/shared/answer-completion-output-device-protocol.ts';

const outputs = { schemaVersion: 2 as const, devices: [
  { deviceId: 'usb-1', label: 'Speaker' }, { deviceId: 'usb-2', label: 'Headphones' },
] };
const complete: OffscreenPlaybackResult = { ok: true, status: 'complete', outputCount: 2, succeededCount: 2, failures: [] };
const partial: OffscreenPlaybackResult = { ok: true, status: 'partial', outputCount: 2, succeededCount: 1, failures: ['device-unavailable'] };
const failed: OffscreenPlaybackResult = { ok: false, status: 'failed', outputCount: 2, succeededCount: 0,
  failures: ['device-unavailable', 'permission-denied'] };

function handler(result: OffscreenPlaybackResult = complete) {
  const requests: unknown[] = [];
  let guardCalls = 0;
  const playback = createOutputDevicePlaybackMessageHandler({
    loadOutputDevice: async () => ({ ok: true as const, selection: outputs }),
    loadAssets: async () => ({ ok: true as const, assets: [] }),
    async playOffscreen(request) { requests.push(request); return result; },
    async loadConversationMute() { return { ok: true as const, muted: false }; },
    async playOffscreenWithMuteGuard(_sender, conversationId, request) {
      guardCalls += 1;
      assert.equal(conversationId, 'conversation-A');
      requests.push(request);
      return { ok: true as const, result };
    },
  });
  return { playback, requests, guardCalls: () => guardCalls };
}

const pageSender = { id: 'extension-id', url: 'https://chatgpt.com/c/conversation-A', frameId: 0,
  tab: { id: 4, url: 'https://chatgpt.com/c/conversation-A' } };

test('ChatGPT音と試聴は同じ複数出力fanoutを一度要求し、会話mute guardはfanout全体に一度適用', async () => {
  const harness = handler();
  const route = { type: ANSWER_COMPLETION_SOUND_ROUTE, conversationId: 'conversation-A', soundId: 'tone-660', volumePercent: 44 };
  const preview = { type: ANSWER_COMPLETION_SOUND_PREVIEW, soundId: 'tone-660', volumePercent: 44 };
  assert.deepEqual(await harness.playback(route, pageSender, 'extension-id'), { ok: true, route: 'device', playback: complete });
  assert.deepEqual(await harness.playback(preview, { id: 'extension-id', url: 'chrome-extension://extension-id/options.html' }, 'extension-id'),
    { ok: true, route: 'device', playback: complete });
  assert.equal(harness.guardCalls(), 1);
  assert.deepEqual(harness.requests, [
    { type: 'CPP_OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND', deviceIds: ['usb-1', 'usb-2'], soundId: 'tone-660', volumePercent: 44 },
    { type: 'CPP_OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND', deviceIds: ['usb-1', 'usb-2'], soundId: 'tone-660', volumePercent: 44 },
  ]);
});

test('部分成功を通知し、Content Scriptは既定出力へ重複fallbackしない', async () => {
  const harness = handler(partial);
  assert.deepEqual(await harness.playback({ type: ANSWER_COMPLETION_SOUND_ROUTE, soundId: 'tone-660', volumePercent: 40 },
    { id: 'extension-id', tab: { url: 'https://chatgpt.com/' } }, 'extension-id'),
  { ok: true, route: 'partial-device', playback: partial });
  let localStarts = 0;
  const errors: unknown[] = [];
  await routeAnswerCompletionSound({ async sendMessage() { return { ok: true, route: 'partial-device', playback: partial }; } },
    { soundId: 'tone-660', volumePercent: 40 }, () => { localStarts += 1; }, (reason, summary) => errors.push([reason, summary]));
  assert.equal(localStarts, 0);
  assert.deepEqual(errors, [['partial-output', partial]]);
});

test('全出力失敗は出力ごとの結果を返し、別経路で再生しない', async () => {
  const harness = handler(failed);
  assert.deepEqual(await harness.playback({ type: ANSWER_COMPLETION_SOUND_PREVIEW, soundId: 'tone-660', volumePercent: 40 },
    { id: 'extension-id', url: 'chrome-extension://extension-id/options.html' }, 'extension-id'),
  { ok: false, reason: 'device-unavailable', playback: failed });
  assert.equal(harness.requests.length, 1);
});

test('空選択はChatGPT/試聴の既存既定routeを一度使い、Offscreenへ送らない', async () => {
  let offscreenCalls = 0;
  const playback = createOutputDevicePlaybackMessageHandler({
    loadOutputDevice: async () => ({ ok: true as const, selection: { schemaVersion: 2 as const, devices: [] } }),
    loadAssets: async () => ({ ok: true as const, assets: [] }),
    async playOffscreen() { offscreenCalls += 1; return complete; },
  });
  assert.deepEqual(await playback({ type: ANSWER_COMPLETION_SOUND_PREVIEW, soundId: 'tone-660', volumePercent: 50 },
    { id: 'extension-id', url: 'chrome-extension://extension-id/options.html' }, 'extension-id'), { ok: true, route: 'default' });
  assert.equal(offscreenCalls, 0);
});
