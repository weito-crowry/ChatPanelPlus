import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchCodexBridgeTerminalEventSaved } from '../src/background/terminal-event-dispatch.ts';
import { CODEX_BRIDGE_TERMINAL_EVENT_SAVED } from '../src/shared/codexbridge-thread-monitor-protocol.ts';

test('新規eventはowner tabだけへidentity-onlyでdispatchする', async () => {
  const sent: Array<{ tabId: number; message: unknown }> = [];
  const event = {
    eventId: 'event-A', ownerTabId: 7, ownerConversationId: 'conversation-A',
    detectedAt: '2026-11-24T10:00:00.000Z', connectionId: 'private-connection',
    threadId: 'private-thread', turnId: 'private-turn', status: 'completed',
  };
  const result = await dispatchCodexBridgeTerminalEventSaved(event, {
    async ownerMatches(tabId, conversationId) { return tabId === 7 && conversationId === 'conversation-A'; },
    async send(tabId, message) { sent.push({ tabId, message }); },
  });
  assert.equal(result, true);
  assert.deepEqual(sent, [{ tabId: 7, message: {
    type: CODEX_BRIDGE_TERMINAL_EVENT_SAVED, eventId: 'event-A', ownerConversationId: 'conversation-A',
    detectedAt: '2026-11-24T10:00:00.000Z',
  } }]);
});

test('owner会話が不一致・owner情報欠落・送信失敗では別tabへ転送しない', async () => {
  let sends = 0;
  const ports = {
    async ownerMatches() { return false; },
    async send() { sends += 1; },
  };
  assert.equal(await dispatchCodexBridgeTerminalEventSaved({
    eventId: 'event-A', ownerTabId: 7, ownerConversationId: 'conversation-A',
    detectedAt: '2026-11-24T10:00:00.000Z',
  }, ports), false);
  assert.equal(await dispatchCodexBridgeTerminalEventSaved({ eventId: 'event-A' }, ports), false);
  assert.equal(sends, 0);
  assert.equal(await dispatchCodexBridgeTerminalEventSaved({
    eventId: 'event-A', ownerTabId: 7, ownerConversationId: 'conversation-A',
    detectedAt: '2026-11-24T10:00:00.000Z',
  }, {
    async ownerMatches() { return true; },
    async send() { throw new Error('tab closed'); },
  }), false);
});
