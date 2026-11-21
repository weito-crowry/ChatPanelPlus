import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH,
  CODEX_BRIDGE_WATCH_ACK_EVENTS,
  CODEX_BRIDGE_WATCH_LIST,
  CODEX_BRIDGE_WATCH_READ,
  CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER,
  CODEX_BRIDGE_WATCH_START,
  CODEX_BRIDGE_WATCH_STOP,
  type CodexBridgeWatchSnapshot,
  type CodexBridgeTerminalEvent,
} from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import { createCodexBridgeThreadMonitorMessageHandler } from '../src/background/codexbridge-thread-monitor.ts';

const item: CodexBridgeWatchSnapshot = {
  watchId: 'watch-1', connectionId: 'sha256:abc', targetId: 'target-1', threadId: 'thread-1', enabled: true,
  baselineCaptured: true, baselineTurnKind: 'turn', baselineTurnId: 'turn-1', baselineTurnStatus: 'completed',
  lastObservedTurnId: 'turn-1', statusState: 'not_loaded', lastTurnStatus: 'completed', lastTurnEvidence: 'live',
  currentExecutionState: null, currentExecutionEvidence: null, currentExecutionTurnId: null,
  needsAttention: false, turnChange: 'baseline', observedAt: '2026-11-20T00:00:00.000Z',
  lastSuccessAt: '2026-11-20T00:00:00.000Z', fetchOutcome: 'ok', nextPollAt: 0, failureCount: 0,
  ownerTabId: 4, ownerConversationId: 'test', ownerMuted: false, ownerMuteRevision: 0,
};
const event: CodexBridgeTerminalEvent = {
  eventId: 'event-1', watchId: item.watchId, connectionId: item.connectionId, targetId: item.targetId,
  threadId: item.threadId, turnId: 'turn-2', status: 'completed', detectedAt: item.observedAt ?? '2026-11-20T00:00:00.000Z',
  notificationState: 'played', notificationReason: null,
  ownerTabId: 4, ownerConversationId: 'test', ownerMuted: false, ownerMuteRevision: 0,
};

function handlerFixture(connectionId = item.connectionId, sourceItems: readonly CodexBridgeWatchSnapshot[] = [item], sourceEvents: readonly CodexBridgeTerminalEvent[] = [event]) {
  const calls: string[] = [];
  const monitor = {
    async startWatch(targetId: string, threadId: string) {
      calls.push(`start:${targetId}:${threadId}`);
      return { ok: true as const, item, created: true };
    },
    async stopWatch(connectionId: string, targetId: string, threadId: string, ownerConversationId: string) {
      calls.push(`stop:${connectionId}:${targetId}:${threadId}`);
      return ownerConversationId === item.ownerConversationId;
    },
    async list() {
      calls.push('list');
      return sourceItems;
    },
    async listEvents() { return sourceEvents; },
    async readEvent(eventId: string) { calls.push(`read-event:${eventId}`); return eventId === event.eventId ? event : null; },
    async read(connectionId: string, targetId: string, threadId: string) {
      calls.push(`read:${connectionId}:${targetId}:${threadId}`);
      return item;
    },
    async refreshForeground() { calls.push('foreground'); },
    async acknowledgeEvents(ownerConversationId: string, eventIds: readonly string[]) {
      calls.push(`ack:${ownerConversationId}:${eventIds.join(',')}`);
      return ownerConversationId === event.ownerConversationId && eventIds.every((id) => id === event.eventId);
    },
  };
  const handle = createCodexBridgeThreadMonitorMessageHandler({
    extensionId: 'test-extension',
    monitor,
    async resolveAccess() {
      return {
        connectionId,
        failure: 'permission-required' as const,
        async readFinalAnswer(targetId: string, threadId: string, turnId: string) {
          calls.push(`final:${targetId}:${threadId}:${turnId}`);
          return { status: 'retrieved', text: 'final', completeness: 'unconfirmed' };
        },
      };
    },
    async loadOwnerMute() { return { ok: true as const, muted: false, revision: 0 }; },
  });
  return { handle, calls };
}

const trustedSender = {
  id: 'test-extension',
  origin: 'https://chatgpt.com',
  url: 'https://chatgpt.com/c/test',
  frameId: 0,
  tab: { id: 4, url: 'https://chatgpt.com/c/test' },
};

test('only top-level ChatGPT senders can use the typed watch messages', async () => {
  const { handle, calls } = handlerFixture();
  assert.equal(await handle({ type: CODEX_BRIDGE_WATCH_LIST }, { ...trustedSender, frameId: 2 }), null);
  assert.equal(await handle({ type: CODEX_BRIDGE_WATCH_LIST }, { ...trustedSender, tab: { id: 4, url: 'https://example.com/' } }), null);
  assert.deepEqual(await handle({ type: 'ARBITRARY_FETCH', url: 'https://bridge.example' }, trustedSender), {
    ok: false, reason: 'invalid-request',
  });
  assert.deepEqual(await handle({ type: CODEX_BRIDGE_WATCH_LIST, endpoint: 'https://bridge.example' }, trustedSender), {
    ok: false, reason: 'invalid-request',
  });
  assert.deepEqual(await handle({
    type: CODEX_BRIDGE_WATCH_START, targetId: 'target-1', threadId: 'target-2::thread-1',
  }, trustedSender), { ok: false, reason: 'invalid-request' });
  assert.deepEqual(calls, []);
});

test('start, stop, read, list, and foreground refresh are explicit bounded operations', async () => {
  const { handle, calls } = handlerFixture();
  assert.deepEqual(await handle({ type: CODEX_BRIDGE_WATCH_START, targetId: 'target-1', threadId: 'thread-1', conversationId: 'test' }, trustedSender), {
    ok: true, data: { item, created: true },
  });
  assert.deepEqual(await handle({
    type: CODEX_BRIDGE_WATCH_STOP, connectionId: item.connectionId, targetId: item.targetId, threadId: item.threadId,
  }, trustedSender), { ok: true, data: { removed: true } });
  assert.deepEqual(await handle({
    type: CODEX_BRIDGE_WATCH_READ, connectionId: item.connectionId, targetId: item.targetId, threadId: item.threadId,
  }, trustedSender), { ok: true, data: item });
  assert.deepEqual(await handle({ type: CODEX_BRIDGE_WATCH_LIST }, trustedSender), {
    ok: true, data: { items: [item], events: [event], currentConnectionId: item.connectionId,
      summary: { watchingCount: 1, unacknowledgedThreadCount: 1 } },
  });
  assert.deepEqual(await handle({ type: CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH }, trustedSender), {
    ok: true, data: { items: [item], events: [event], currentConnectionId: item.connectionId,
      summary: { watchingCount: 1, unacknowledgedThreadCount: 1 } },
  });
  assert.deepEqual(calls, [
    'start:target-1:thread-1',
    `stop:${item.connectionId}:${item.targetId}:${item.threadId}`,
    `read:${item.connectionId}:${item.targetId}:${item.threadId}`,
    'list', 'foreground', 'list',
  ]);
});

test('final answer requests read only saved exact events and require the current connection', async () => {
  const current = handlerFixture();
  assert.deepEqual(await current.handle({ type: CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER, eventId: event.eventId }, trustedSender), {
    ok: true, data: { status: 'retrieved', text: 'final', completeness: 'unconfirmed' },
  });
  assert.deepEqual(current.calls, [`read-event:${event.eventId}`, `final:${event.targetId}:${event.threadId}:${event.turnId}`, `read-event:${event.eventId}`]);

  const changed = handlerFixture('sha256:other');
  assert.deepEqual(await changed.handle({ type: CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER, eventId: event.eventId }, trustedSender), {
    ok: true, data: { status: 'failed', reason: 'connection-changed' },
  });
  assert.deepEqual(changed.calls, [`read-event:${event.eventId}`]);

  const invalid = handlerFixture();
  assert.deepEqual(await invalid.handle({
    type: CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER, eventId: event.eventId, threadId: 'arbitrary',
  }, trustedSender), { ok: false, reason: 'invalid-request' });
  assert.deepEqual(invalid.calls, []);
});

test('listとforeground refreshはowner会話だけを返し、watch read/stopも別会話から隠す', async () => {
  const itemB = { ...item, watchId: 'watch-B', targetId: 'target-B', threadId: 'thread-B', ownerTabId: 8, ownerConversationId: 'other' };
  const eventB = { ...event, eventId: 'event-B', watchId: 'watch-B', targetId: 'target-B', threadId: 'thread-B', ownerTabId: 8, ownerConversationId: 'other' };
  const legacy = { ...item, watchId: 'watch-legacy', targetId: 'target-legacy', threadId: 'thread-legacy',
    ownerTabId: undefined, ownerConversationId: undefined, ownerMuted: undefined, ownerMuteRevision: undefined };
  const legacyEvent = { ...event, eventId: 'event-legacy', watchId: 'watch-legacy', targetId: 'target-legacy', threadId: 'thread-legacy',
    ownerTabId: undefined, ownerConversationId: undefined, ownerMuted: undefined, ownerMuteRevision: undefined };
  const { handle, calls } = handlerFixture(item.connectionId, [item, itemB, legacy], [event, eventB, legacyEvent]);
  const otherSender = { ...trustedSender, url: 'https://chatgpt.com/c/other', tab: { id: 8, url: 'https://chatgpt.com/c/other' } };
  const expected = { items: [item], events: [event], currentConnectionId: item.connectionId,
    summary: { watchingCount: 1, unacknowledgedThreadCount: 1 } };
  assert.deepEqual(await handle({ type: CODEX_BRIDGE_WATCH_LIST }, trustedSender), { ok: true, data: expected });
  assert.deepEqual(await handle({ type: CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH }, trustedSender), { ok: true, data: expected });
  assert.deepEqual(await handle({ type: CODEX_BRIDGE_WATCH_READ, connectionId: item.connectionId, targetId: item.targetId, threadId: item.threadId }, otherSender), {
    ok: true, data: null,
  });
  assert.deepEqual(await handle({ type: CODEX_BRIDGE_WATCH_STOP, connectionId: item.connectionId, targetId: item.targetId, threadId: item.threadId }, otherSender), {
    ok: true, data: { removed: false },
  });
  assert.deepEqual(calls.slice(0, 3), ['list', 'foreground', 'list']);
});

test('ACKは要求元会話のevent IDsだけ確認し、越権・unknownを同じ拒否にする', async () => {
  const { handle, calls } = handlerFixture();
  const otherSender = { ...trustedSender, url: 'https://chatgpt.com/c/other', tab: { id: 8, url: 'https://chatgpt.com/c/other' } };
  assert.deepEqual(await handle({ type: CODEX_BRIDGE_WATCH_ACK_EVENTS, conversationId: 'other', eventIds: [event.eventId] }, otherSender), {
    ok: false, reason: 'invalid-request',
  });
  assert.deepEqual(await handle({ type: CODEX_BRIDGE_WATCH_ACK_EVENTS, conversationId: 'test', eventIds: ['missing-event'] }, trustedSender), {
    ok: false, reason: 'invalid-request',
  });
  assert.deepEqual(await handle({ type: CODEX_BRIDGE_WATCH_ACK_EVENTS, conversationId: 'test', eventIds: [event.eventId] }, trustedSender), {
    ok: true, data: { acknowledged: true },
  });
  assert.deepEqual(calls, ['ack:other:event-1', 'ack:test:missing-event', 'ack:test:event-1']);
});

test('final-answerは別会話のevent IDから本文を取得しない', async () => {
  const { handle, calls } = handlerFixture();
  const otherSender = { ...trustedSender, url: 'https://chatgpt.com/c/other', tab: { id: 8, url: 'https://chatgpt.com/c/other' } };
  assert.deepEqual(await handle({ type: CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER, eventId: event.eventId }, otherSender), {
    ok: true, data: { status: 'failed', reason: 'event-not-found' },
  });
  assert.deepEqual(calls, [`read-event:${event.eventId}`]);
});

test('sender URLの会話ID欠落・要求ID不一致は一覧・登録を拒否する', async () => {
  const { handle, calls } = handlerFixture();
  assert.equal(await handle({ type: CODEX_BRIDGE_WATCH_LIST }, {
    ...trustedSender, url: 'https://chatgpt.com/', tab: { id: 4, url: 'https://chatgpt.com/' },
  }), null);
  assert.equal(await handle({ type: CODEX_BRIDGE_WATCH_START, targetId: 'target-1', threadId: 'thread-1', conversationId: 'other' }, trustedSender), null);
  assert.deepEqual(calls, []);
});
