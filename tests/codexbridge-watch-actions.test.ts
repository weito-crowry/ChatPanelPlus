import assert from 'node:assert/strict';
import test from 'node:test';
import { stopOwnedCodexBridgeWatch } from '../src/content/codexbridge-watch-actions.ts';
import type { CodexBridgeWatchSnapshot } from '../src/shared/codexbridge-thread-monitor-protocol.ts';

const item = { watchId: 'watch', ownerConversationId: 'conversation-a', connectionId: 'connection',
  targetId: 'target', threadId: 'thread' } as CodexBridgeWatchSnapshot;
const options = (overrides: Record<string, unknown> = {}) => ({ item,
  getConversationId: () => 'conversation-a', getPathname: () => '/c/conversation-a',
  sendMessage: async () => { throw new Error('unexpected request'); }, refreshList: async () => {},
  setBusyKey: () => {}, setError: () => {}, ...overrides });

test('別ownerやsender route不一致では監視解除messageを送らない', async () => {
  let sends = 0;
  await stopOwnedCodexBridgeWatch(options({ getConversationId: () => 'conversation-b', sendMessage: async () => { sends += 1; } }));
  await stopOwnedCodexBridgeWatch(options({ getPathname: () => '/c/conversation-b', sendMessage: async () => { sends += 1; } }));
  assert.equal(sends, 0);
});

test('現在ownerの明示解除後だけ一覧を再取得し、その操作のbusy状態だけを解放する', async () => {
  const messages: unknown[] = [];
  const busy: string[] = [];
  let refreshed = 0;
  await stopOwnedCodexBridgeWatch(options({
    sendMessage: async (message: unknown) => { messages.push(message); },
    refreshList: async () => { refreshed += 1; },
    setBusyKey: (value: string | ((current: string) => string)) => { busy.push(typeof value === 'string' ? value : value('stop:watch')); },
  }));
  assert.deepEqual(messages, [{ type: 'CODEX_BRIDGE_WATCH_STOP', connectionId: 'connection', targetId: 'target', threadId: 'thread' }]);
  assert.equal(refreshed, 1);
  assert.deepEqual(busy, ['stop:watch', '']);
});
