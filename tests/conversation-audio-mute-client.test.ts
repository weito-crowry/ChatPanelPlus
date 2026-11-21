import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationAudioMuteClient, type ConversationAudioMuteRuntimeLike } from '../src/shared/conversation-audio-mute-client.ts';
import { ANSWER_COMPLETION_SOUND_ROUTE } from '../src/shared/answer-completion-output-device-protocol.ts';
import { GET_CONVERSATION_AUDIO_MUTE, SET_CONVERSATION_AUDIO_MUTE } from '../src/shared/conversation-audio-mute-protocol.ts';
import { routeAnswerCompletionSound } from '../src/content/answer-completion-output-device-route.ts';

function fakeRuntime(reply: unknown) {
  const messages: unknown[] = [];
  const runtime: ConversationAudioMuteRuntimeLike = {
    async sendMessage(message) { messages.push(message); return reply; },
  };
  return { runtime, messages };
}

test('content mute clientはbackground session messageで会話IDを指定し、共有local設定を使わない', async () => {
  const fake = fakeRuntime({ ok: true, value: { schemaVersion: 1, muted: true, revision: 4 }, saved: true });
  const client = new ConversationAudioMuteClient(fake.runtime);
  assert.deepEqual(await client.load('conversation-A'), {
    ok: true, value: { schemaVersion: 1, muted: true, revision: 4 }, saved: true,
  });
  assert.deepEqual(await client.setMuted('conversation-B', false), {
    ok: true, value: { schemaVersion: 1, muted: true, revision: 4 },
  });
  assert.deepEqual(fake.messages, [
    { type: GET_CONVERSATION_AUDIO_MUTE, conversationId: 'conversation-A' },
    { type: SET_CONVERSATION_AUDIO_MUTE, conversationId: 'conversation-B', muted: false },
  ]);
});

test('conversation ID不明または不正な場合はmute messageを送らない', async () => {
  const fake = fakeRuntime({ unexpected: true });
  const client = new ConversationAudioMuteClient(fake.runtime);
  assert.deepEqual(await client.load(null), { ok: false, reason: 'storage-error' });
  assert.deepEqual(await client.setMuted('bad/id', true), { ok: false, reason: 'storage-error' });
  assert.deepEqual(fake.messages, []);
});

test('mute済み再生route応答は既定Content Script playerを呼ばず、エラーにも数えない', async () => {
  const messages: unknown[] = [];
  let playback = 0;
  const errors: string[] = [];
  await routeAnswerCompletionSound({
    async sendMessage(message) { messages.push(message); return { ok: true, route: 'skipped', reason: 'muted' }; },
  }, { conversationId: 'conversation-A', soundId: 'tone-660', volumePercent: 50 }, () => { playback += 1; }, (reason) => errors.push(reason));
  assert.deepEqual(messages, [{ type: ANSWER_COMPLETION_SOUND_ROUTE, conversationId: 'conversation-A', soundId: 'tone-660', volumePercent: 50 }]);
  assert.equal(playback, 0);
  assert.deepEqual(errors, []);
});
