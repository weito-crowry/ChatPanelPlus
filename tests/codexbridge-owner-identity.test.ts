import assert from 'node:assert/strict';
import test from 'node:test';
import { ownerTabCanBeRebound, ownerTabMatchesConversation } from '../src/background/codexbridge-thread-monitor.ts';

const PONG = 'CODEX_BRIDGE_OWNER_IDENTITY_PONG';

test('tab URLがない場合もmain frameの同一会話identity pingでownerを確認する', async () => {
  let requestCount = 0;
  let sentFrameId: number | undefined;
  const tabs = {
    async get() { return { id: 4 }; },
    async sendMessage(tabId: number, message: Record<string, unknown>, options: { frameId: number }) {
      requestCount += 1;
      assert.equal(tabId, 4);
      sentFrameId = options.frameId;
      return { type: PONG, nonce: message.nonce, conversationId: 'conversation-A' };
    },
  };

  assert.equal(await ownerTabMatchesConversation(tabs as never, 4, 'conversation-A'), true);
  assert.equal(requestCount, 1);
  assert.equal(sentFrameId, 0);
});

test('別conversationのidentity応答はowner確認に使わない', async () => {
  let requestCount = 0;
  const tabs = {
    async get() { return { url: undefined }; },
    async sendMessage(_tabId: number, message: Record<string, unknown>) {
      requestCount += 1;
      return { type: PONG, nonce: message.nonce, conversationId: 'conversation-B' };
    },
  };

  assert.equal(await ownerTabMatchesConversation(tabs as never, 4, 'conversation-A'), false);
  assert.equal(requestCount, 1);
});

test('閉じたtabと応答timeoutはowner確認失敗として返す', async () => {
  const closedTab = {
    async get() { return { url: 'https://chatgpt.com/c/conversation-A' }; },
    async sendMessage() { throw new Error('tab closed'); },
  };
  const timedOutTab = {
    async get() { return { url: 'https://chatgpt.com/c/conversation-A' }; },
    async sendMessage() { return new Promise<never>(() => {}); },
  };

  assert.equal(await ownerTabMatchesConversation(closedTab as never, 4, 'conversation-A'), false);
  assert.equal(await ownerTabMatchesConversation(timedOutTab as never, 4, 'conversation-A', 10), false);
});

test('再bindは別route応答または閉じたtabだけ許し、open tabの無応答は拒否する', async () => {
  const otherConversation = {
    async get() { return { id: 4 }; },
    async sendMessage(_tabId: number, message: Record<string, unknown>) {
      return { type: PONG, nonce: message.nonce, conversationId: 'conversation-B' };
    },
  };
  const closedTab = {
    async get() { throw new Error('No tab with id'); },
    async sendMessage() { throw new Error('No tab with id'); },
  };
  const openWithoutResponder = {
    async get() { return { id: 4 }; },
    async sendMessage() { return new Promise<never>(() => {}); },
  };

  assert.equal(await ownerTabCanBeRebound(otherConversation as never, 4, 'conversation-A'), true);
  assert.equal(await ownerTabCanBeRebound(closedTab as never, 4, 'conversation-A'), true);
  assert.equal(await ownerTabCanBeRebound(openWithoutResponder as never, 4, 'conversation-A', 10), false);
});

test('不明・nonce不一致・余分なfieldを持つidentity応答は拒否する', async () => {
  const responses = [
    { type: 'UNKNOWN', nonce: 'nonce', conversationId: 'conversation-A' },
    { type: PONG, nonce: 'another-nonce', conversationId: 'conversation-A' },
    { type: PONG, nonce: 'nonce', conversationId: 'conversation-A', url: 'https://chatgpt.com/c/conversation-A' },
  ];
  for (const response of responses) {
    const tabs = {
      async get() { return { url: 'https://chatgpt.com/c/conversation-A' }; },
      async sendMessage() { return response; },
    };
    assert.equal(await ownerTabMatchesConversation(tabs as never, 4, 'conversation-A'), false);
  }
});

test('content responderは同一extensionからの厳密なpingにだけChatGPT route identityを返す', async () => {
  const identity = await import('../src/shared/codexbridge-owner-identity.ts') as Record<string, unknown>;
  const createResponse = identity.createCodexBridgeOwnerIdentityResponse as
    ((message: unknown, senderId: string | undefined, extensionId: string, pageUrl: string) => unknown) | undefined;
  assert.equal(typeof createResponse, 'function');
  const request = { type: 'CODEX_BRIDGE_OWNER_IDENTITY_PING', nonce: '123e4567-e89b-42d3-a456-426614174000' };

  assert.deepEqual(createResponse!(request, 'extension-id', 'extension-id',
    'https://chatgpt.com/g/project/c/conversation-A'), {
    type: PONG, nonce: request.nonce, conversationId: 'conversation-A',
  });
  for (const [message, senderId, pageUrl] of [
    [{ ...request, unexpected: true }, 'extension-id', 'https://chatgpt.com/c/conversation-A'],
    [request, 'other-extension', 'https://chatgpt.com/c/conversation-A'],
    [request, 'extension-id', 'https://user@chatgpt.com/c/conversation-A'],
    [request, 'extension-id', 'https://example.com/c/conversation-A'],
    [{ ...request, nonce: 'bad' }, 'extension-id', 'https://chatgpt.com/c/conversation-A'],
  ] as const) {
    assert.equal(createResponse!(message, senderId, 'extension-id', pageUrl), null);
  }
  assert.deepEqual(createResponse!(request, 'extension-id', 'extension-id',
    'https://chatgpt.com/c/conversation-B'), {
    type: PONG, nonce: request.nonce, conversationId: 'conversation-B',
  });
});

test('owner確認失敗と同一会話別tab競合を区別し、保持データを示す', async () => {
  const presentation = await import('../src/content/codexbridge-auto-watch-presentation.ts') as Record<string, unknown>;
  const label = presentation.codexBridgeAutoWatchFailureLabel as ((failure: string | null) => string) | undefined;
  assert.equal(typeof label, 'function');
  assert.equal(label!('owner-tab-unavailable'),
    'この会話の自動登録は別タブが所有中か、ownerタブを確認できません。設定と監視・通知履歴は保持されています。');
  assert.equal(label!('auto-owner-conflict'),
    '同じ会話の別タブが自動登録を所有中です。このtabは処理しません。');
});
