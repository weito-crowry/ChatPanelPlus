import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodexBridgeNotificationHandler } from '../src/background/codexbridge-notifications.ts';
import type { CodexBridgeTerminalEvent, CodexBridgeNotificationReason } from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import type { OffscreenPlaybackResult } from '../src/shared/answer-completion-output-device-protocol.ts';
import type { ExtensionSettings } from '../src/shared/settings.ts';
import type { SoundAsset } from '../src/shared/answer-completion-sound-assets.ts';

const customAsset: SoundAsset = {
  id: 'user-12345678-1234-4234-9234-123456789012', name: 'custom', mimeType: 'audio/wav', data: 'AAAA',
  sizeBytes: 3, durationSeconds: 0.5,
};

function notification(options: {
  enabled?: boolean;
  volume?: number;
  soundId?: string;
  chatGptEnabled?: boolean;
  chatGptSoundId?: string;
  chatGptVolume?: number;
  deviceId?: string;
  deviceIds?: string[];
  asset?: SoundAsset;
  outputAvailable?: boolean;
  playResult?: OffscreenPlaybackResult;
  muted?: boolean;
  guardReason?: 'muted' | 'owner-unavailable';
} = {}) {
  const requests: unknown[] = [];
  const event: CodexBridgeTerminalEvent = {
    eventId: 'event-A', watchId: 'watch-A', connectionId: 'connection-A', targetId: 'target-A', threadId: 'thread-A',
    turnId: 'turn-A', status: 'completed', detectedAt: '2026-11-21T00:00:00.000Z',
    notificationState: 'pending', notificationReason: null, ownerTabId: 4,
    ownerConversationId: 'conversation-A', ownerMuted: false, ownerMuteRevision: 0,
  };
  const handler = createCodexBridgeNotificationHandler({
    settings: { async loadSettings() {
      return { ok: true as const, settings: {
        schemaVersion: 1,
        answerCompletionSoundEnabled: options.chatGptEnabled ?? false,
        answerCompletionSoundId: options.chatGptSoundId ?? 'tone-660',
        answerCompletionSoundVolumePercent: options.chatGptVolume ?? 60,
        codexBridgeTerminalSoundEnabled: options.enabled ?? true,
        codexBridgeTerminalSoundId: options.soundId ?? 'two-tone',
        codexBridgeTerminalSoundVolumePercent: options.volume ?? 37,
      } as ExtensionSettings };
    } },
    outputDevice: { async load() {
      return options.outputAvailable === false
        ? { ok: false as const, reason: 'corrupt-selection' as const }
        : { ok: true as const, selection: { schemaVersion: 2 as const, devices: options.deviceIds
          ? options.deviceIds.map((deviceId, index) => ({ deviceId, label: `device-${index}` }))
          : options.deviceId && options.deviceId !== 'default' ? [{ deviceId: options.deviceId, label: 'device' }] : [] } };
    } },
    assets: { async loadAssets() {
      return options.asset ? { ok: true as const, assets: [options.asset] } : { ok: true as const, assets: [] };
    } },
    audio: { async play(request) {
      requests.push(request);
      return options.playResult ?? { ok: true, status: 'complete', outputCount: request.deviceIds.length,
        succeededCount: request.deviceIds.length, failures: [] };
    } },
    async loadOwnerMute() { return { ok: true, muted: options.muted ?? false }; },
    async playWithOwnerMuteGuard(_event: CodexBridgeTerminalEvent, action: () => Promise<Readonly<{ ok: true } | { ok: false; reason: CodexBridgeNotificationReason }>>) {
      if (options.guardReason) return { ok: false, reason: options.guardReason };
      return action();
    },
  });
  return { handler, requests, event };
}

test('default and selected output devices both use the offscreen audio route with existing sound settings', async () => {
  for (const deviceId of ['default', 'explicit-device']) {
    const harness = notification({ deviceId, soundId: customAsset.id, asset: customAsset, volume: 63 });
    const prepared = await harness.handler.prepare(harness.event);
    assert.equal(prepared.state, 'ready');
    if (prepared.state !== 'ready') continue;
    assert.deepEqual(await prepared.play(), { ok: true });
    assert.deepEqual(harness.requests, [{
      type: 'CPP_OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND', deviceIds: deviceId === 'default' ? ['default'] : [deviceId], soundId: customAsset.id,
      volumePercent: 63, asset: customAsset,
    }]);
  }
});

test('disabled sound and zero volume skip playback, while device and audio failures remain explicit', async () => {
  const disabled = notification({ enabled: false, chatGptEnabled: true });
  assert.deepEqual(await disabled.handler.prepare(disabled.event), { state: 'skipped', reason: 'disabled' });
  assert.deepEqual(disabled.requests, []);

  const muted = notification({ volume: 0 });
  assert.deepEqual(await muted.handler.prepare(muted.event), { state: 'skipped', reason: 'volume-zero' });
  assert.deepEqual(muted.requests, []);

  const missingDevice = notification({ outputAvailable: false });
  assert.deepEqual(await missingDevice.handler.prepare(missingDevice.event), { state: 'failed', reason: 'output-device-unavailable' });

  const denied = notification({ playResult: { ok: false, status: 'failed', outputCount: 1, succeededCount: 0, failures: ['permission-denied'] } });
  const prepared = await denied.handler.prepare(denied.event);
  assert.equal(prepared.state, 'ready');
  if (prepared.state === 'ready') assert.deepEqual(await prepared.play(), { ok: false, reason: 'permission-denied' });
});

test('Codex終了音はChatGPT回答完了音の専用設定を参照し、相手側の値に追随しない', async () => {
  const harness = notification({
    enabled: true, soundId: 'soft-chime', volume: 19,
    chatGptEnabled: false, chatGptSoundId: 'tone-660', chatGptVolume: 88,
  });
  const prepared = await harness.handler.prepare(harness.event);
  assert.equal(prepared.state, 'ready');
  if (prepared.state === 'ready') {
    assert.deepEqual(await prepared.play(), { ok: true });
  }
  assert.deepEqual(harness.requests, [{
    type: 'CPP_OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND', deviceIds: ['default'],
    soundId: 'soft-chime', volumePercent: 19,
  }]);
});

test('専用設定で選んだカスタム音源が欠落した場合はCodex既定音へ戻る', async () => {
  const selectedId = 'user-12345678-1234-4234-9234-123456789012';
  const harness = notification({ enabled: true, soundId: selectedId, chatGptSoundId: 'soft-chime' });
  const prepared = await harness.handler.prepare(harness.event);
  assert.equal(prepared.state, 'ready');
  if (prepared.state === 'ready') {
    assert.deepEqual(await prepared.play(), { ok: true });
  }
  assert.deepEqual(harness.requests, [{
    type: 'CPP_OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND', deviceIds: ['default'],
    soundId: 'two-tone', volumePercent: 37,
  }]);
});

test('ownerless・muted・再生直前mute raceはBridge完了音をskipする', async () => {
  const ownerless = notification();
  const event = { ...ownerless.event, ownerTabId: undefined, ownerConversationId: undefined, ownerMuted: undefined, ownerMuteRevision: undefined };
  assert.deepEqual(await ownerless.handler.prepare(event), { state: 'skipped', reason: 'owner-unavailable' });

  const muted = notification({ muted: true });
  assert.deepEqual(await muted.handler.prepare(muted.event), { state: 'skipped', reason: 'muted' });
  assert.deepEqual(muted.requests, []);

  const race = notification({ guardReason: 'muted' });
  const prepared = await race.handler.prepare(race.event);
  assert.equal(prepared.state, 'ready');
  if (prepared.state === 'ready') assert.deepEqual(await prepared.play(), { ok: false, reason: 'muted' });
  assert.deepEqual(race.requests, []);
});

test('Codex通知は複数出力へ一つのOffscreen要求を送り、部分成功を監視状態へ返す', async () => {
  const result: OffscreenPlaybackResult = {
    ok: true, status: 'partial', outputCount: 2, succeededCount: 1, failures: ['device-unavailable'],
  };
  const harness = notification({ deviceIds: ['usb-1', 'usb-2'], playResult: result });
  const prepared = await harness.handler.prepare(harness.event);
  assert.equal(prepared.state, 'ready');
  if (prepared.state === 'ready') assert.deepEqual(await prepared.play(), { ok: true, reason: 'partial-output' });
  assert.deepEqual(harness.requests, [{
    type: 'CPP_OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND', deviceIds: ['usb-1', 'usb-2'],
    soundId: 'two-tone', volumePercent: 37,
  }]);
});
