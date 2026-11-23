import assert from 'node:assert/strict';
import test from 'node:test';
import { isCodexBridgeWatchRefreshContextCurrent } from '../src/content/codexbridge-watch-refresh-context.ts';

const expected = { ownerConversationId: 'conversation-A', connectionId: 'connection-A', targetId: 'target-A',
  mode: 'running' as const, watchGeneration: 3, routeGeneration: 8 };
const current = { ...expected, connected: true, routeCurrent: true };

test('遅延中のA更新はowner・connection・target・mode・route generation変更を破棄する', () => {
  assert.equal(isCodexBridgeWatchRefreshContextCurrent(expected, current), true);
  for (const changed of [
    { ownerConversationId: 'conversation-B' }, { connectionId: 'connection-B' }, { targetId: 'target-B' },
    { mode: 'normal' as const }, { watchGeneration: 4 }, { routeGeneration: 9 },
    { connected: false }, { routeCurrent: false },
  ]) assert.equal(isCodexBridgeWatchRefreshContextCurrent(expected, { ...current, ...changed }), false);
});
