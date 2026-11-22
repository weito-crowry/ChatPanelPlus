import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONVERSATION_AUDIO_MUTE_SESSION_KEY_PREFIX,
  ConversationAudioMuteStore,
  createConversationAudioMuteMessageHandler,
  removeConversationAudioMuteEntriesForTab,
  type ConversationAudioMuteSessionLike,
} from '../src/background/conversation-audio-mute.ts';
import {
  GET_CONVERSATION_AUDIO_MUTE,
  SET_CONVERSATION_AUDIO_MUTE,
} from '../src/shared/conversation-audio-mute-protocol.ts';

function fixture() {
  const data: Record<string, unknown> = {};
  const removed: string[] = [];
  const session: ConversationAudioMuteSessionLike = {
    async get(keys) {
      if (keys === null) return structuredClone(data);
      const requested = typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(requested.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(items) { Object.assign(data, structuredClone(items)); },
    async remove(keys) {
      const names = typeof keys === 'string' ? [keys] : keys;
      for (const key of names) { removed.push(key); delete data[key]; }
    },
  };
  const handler = createConversationAudioMuteMessageHandler(new ConversationAudioMuteStore(session), 'extension-id');
  const sender = (tabId: number, url = 'https://chatgpt.com/c/conversation-A') => ({
    id: 'extension-id', frameId: 0, url,
    tab: { id: tabId, url },
  });
  return { data, removed, session, handler, sender };
}

test('muteは信頼済みtab IDとconversation IDで保存し、同一会話の別tabと分離する', async () => {
  const fake = fixture();
  assert.deepEqual(await fake.handler({ type: GET_CONVERSATION_AUDIO_MUTE, conversationId: 'conversation-A' }, fake.sender(11)), {
    ok: true, value: { schemaVersion: 1, muted: false, revision: 0 }, saved: false,
  });
  assert.deepEqual(await fake.handler({ type: SET_CONVERSATION_AUDIO_MUTE, conversationId: 'conversation-A', muted: true }, fake.sender(11)), {
    ok: true, value: { schemaVersion: 1, muted: true, revision: 1 }, saved: true,
  });
  assert.deepEqual(await fake.handler({ type: GET_CONVERSATION_AUDIO_MUTE, conversationId: 'conversation-A' }, fake.sender(11)), {
    ok: true, value: { schemaVersion: 1, muted: true, revision: 1 }, saved: true,
  });
  assert.deepEqual(await fake.handler({ type: GET_CONVERSATION_AUDIO_MUTE, conversationId: 'conversation-A' }, fake.sender(12)), {
    ok: true, value: { schemaVersion: 1, muted: false, revision: 0 }, saved: false,
  });
  const otherConversation = fake.sender(11, 'https://chatgpt.com/c/conversation-B');
  assert.deepEqual(await fake.handler({ type: GET_CONVERSATION_AUDIO_MUTE, conversationId: 'conversation-B' }, otherConversation), {
    ok: true, value: { schemaVersion: 1, muted: false, revision: 0 }, saved: false,
  });
  assert.ok(Object.keys(fake.data).every((key) => key.startsWith(CONVERSATION_AUDIO_MUTE_SESSION_KEY_PREFIX)));
});

test('sender.url・tab.url・要求conversation ID・frame ID不一致は拒否理由を保ち、保存しない', async () => {
  const fake = fixture();
  const valid = fake.sender(11);
  assert.deepEqual(await fake.handler({ type: GET_CONVERSATION_AUDIO_MUTE, conversationId: 'conversation-B' }, valid), {
    ok: false, reason: 'sender-unverified',
  });
  assert.deepEqual(await fake.handler({ type: GET_CONVERSATION_AUDIO_MUTE, conversationId: 'conversation-A' }, {
    ...valid, url: 'https://chatgpt.com/c/conversation-B',
  }), { ok: false, reason: 'sender-unverified' });
  assert.deepEqual(await fake.handler({ type: GET_CONVERSATION_AUDIO_MUTE, conversationId: 'conversation-A' }, {
    ...valid, tab: { id: 11, url: 'https://chatgpt.com/c/conversation-B' },
  }), { ok: false, reason: 'sender-unverified' });
  assert.deepEqual(await fake.handler({ type: GET_CONVERSATION_AUDIO_MUTE, conversationId: 'conversation-A' }, {
    ...valid, frameId: 2,
  }), { ok: false, reason: 'sender-unverified' });
  assert.deepEqual(await fake.handler({ type: GET_CONVERSATION_AUDIO_MUTE, conversationId: 'conversation-A' }, {
    ...valid, id: 'other-extension',
  }), { ok: false, reason: 'sender-unverified' });
  assert.deepEqual(fake.data, {});
});

test('tab終了時にそのtabのmuteだけをsessionから削除する', async () => {
  const fake = fixture();
  await fake.handler({ type: SET_CONVERSATION_AUDIO_MUTE, conversationId: 'conversation-A', muted: true }, fake.sender(11));
  await fake.handler({ type: SET_CONVERSATION_AUDIO_MUTE, conversationId: 'conversation-B', muted: true }, fake.sender(12, 'https://chatgpt.com/c/conversation-B'));
  await removeConversationAudioMuteEntriesForTab(fake.session, 11);
  assert.equal(Object.keys(fake.data).length, 1);
  assert.equal(fake.removed.length, 1);
  assert.ok(fake.removed[0]?.startsWith(`${CONVERSATION_AUDIO_MUTE_SESSION_KEY_PREFIX}11.`));
});

test('同じ会話のmute updateは直列化してrevisionを失わない', async () => {
  const fake = fixture();
  await Promise.all([
    fake.handler({ type: SET_CONVERSATION_AUDIO_MUTE, conversationId: 'conversation-A', muted: true }, fake.sender(11)),
    fake.handler({ type: SET_CONVERSATION_AUDIO_MUTE, conversationId: 'conversation-A', muted: false }, fake.sender(11)),
  ]);
  const loaded = await fake.handler({ type: GET_CONVERSATION_AUDIO_MUTE, conversationId: 'conversation-A' }, fake.sender(11));
  assert.deepEqual(loaded, { ok: true, value: { schemaVersion: 1, muted: false, revision: 2 }, saved: true });
});

test('Offscreen開始判定とmute更新を直列化し、音声開始後の書込は再生完了まで待つ', async () => {
  const fake = fixture();
  const store = new ConversationAudioMuteStore(fake.session);
  let started = false;
  let releasePlayback!: () => void;
  const playback = store.runIfUnmuted(11, 'conversation-A', async () => {
    started = true;
    await new Promise<void>((resolve) => { releasePlayback = resolve; });
    return 'played';
  });
  while (!started) await new Promise((resolve) => setTimeout(resolve, 0));
  let muteSaved = false;
  const muteChange = store.set(11, 'conversation-A', true).then((result) => { muteSaved = true; return result; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(muteSaved, false);
  releasePlayback();
  assert.deepEqual(await playback, { ok: true, value: 'played' });
  assert.equal((await muteChange).ok, true);
  assert.equal(muteSaved, true);
  assert.deepEqual(await store.runIfUnmuted(11, 'conversation-A', async () => 'unexpected'), { ok: false, reason: 'muted' });
});
