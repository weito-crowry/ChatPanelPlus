import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodexBridgeThreadMonitorMessageHandler } from '../src/background/codexbridge-thread-monitor.ts';
import { CODEX_BRIDGE_WATCH_ACK_EVENTS } from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import { acknowledgeCodexBridgeEventIds } from '../src/content/codexbridge-event-ack.ts';
import { CodexBridgeEventAcknowledger } from '../src/content/codexbridge-event-ack.ts';

function eventIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `event-${index}`);
}

test('129 IDs are acknowledged as a fixed 128+1 serial snapshot', async () => {
  const batches: string[][] = [];
  const ids = eventIds(129);
  const result = await acknowledgeCodexBridgeEventIds(ids, async (batch) => {
    batches.push([...batch]);
    return true;
  }, () => true);
  assert.deepEqual(batches.map((batch) => batch.length), [128, 1]);
  assert.deepEqual(batches.flat(), ids);
  assert.deepEqual(result, { status: 'complete', totalCount: 129, confirmedCount: 129 });
});

test('256 IDs are acknowledged as two sequential 128-ID batches', async () => {
  const batches: string[][] = [];
  const ids = eventIds(256);
  const result = await acknowledgeCodexBridgeEventIds(ids, async (batch) => {
    batches.push([...batch]);
    return true;
  }, () => true);
  assert.deepEqual(batches.map((batch) => batch.length), [128, 128]);
  assert.deepEqual(batches.flat(), ids);
  assert.deepEqual(result, { status: 'complete', totalCount: 256, confirmedCount: 256 });
});

test('partial failure re-reads against the fixed snapshot and leaves concurrent new events unacknowledged', async () => {
  const ids = eventIds(256);
  const acknowledged = new Set<string>();
  const visible = [...ids];
  const batches: string[][] = [];
  const result = await acknowledgeCodexBridgeEventIds(ids, async (batch) => {
    batches.push([...batch]);
    if (batches.length === 1) {
      batch.forEach((eventId) => acknowledged.add(eventId));
      visible.push('event-new-during-ack');
      return true;
    }
    return false;
  }, () => true);
  assert.deepEqual(batches.map((batch) => batch.length), [128, 128]);
  assert.deepEqual(result, { status: 'partial', totalCount: 256, confirmedCount: 128 });
  assert.equal(acknowledged.size, 128);
  assert.ok(visible.includes('event-new-during-ack'));
  assert.equal(acknowledged.has('event-new-during-ack'), false);
});

test('route change stops before sending the next batch', async () => {
  let current = true;
  const batches: string[][] = [];
  const result = await acknowledgeCodexBridgeEventIds(eventIds(256), async (batch) => {
    batches.push([...batch]);
    current = false;
    return true;
  }, () => current);
  assert.deepEqual(batches.map((batch) => batch.length), [128]);
  assert.deepEqual(result, { status: 'partial', totalCount: 256, confirmedCount: 128 });
});

test('256-ID snapshot traverses the real owner-authenticated handler in accepted batches', async () => {
  const acceptedBatches: string[][] = [];
  const monitor = {
    async startWatch() { return { ok: false as const, reason: 'connection-unavailable' as const }; },
    async stopWatch() { return false; },
    async list() { return []; },
    async listEvents() { return []; },
    async read() { return null; },
    async readEvent() { return null; },
    async refreshForeground() {},
    async acknowledgeEvents(ownerConversationId: string, ids: readonly string[]) {
      if (ownerConversationId !== 'test' || ids.length > 128) return false;
      acceptedBatches.push([...ids]);
      return true;
    },
    async clearEvents() { return false; },
  };
  const handle = createCodexBridgeThreadMonitorMessageHandler({
    extensionId: 'test-extension', monitor,
    async resolveAccess() {
      return {
        connectionId: 'sha256:abc', failure: 'permission-required' as const,
        async readFinalAnswer() { return { status: 'failed' as const, reason: 'permission-required' as const }; },
      };
    },
    async loadOwnerMute() { return { ok: true as const, muted: false, revision: 0 }; },
  });
  const sender = {
    id: 'test-extension', origin: 'https://chatgpt.com', url: 'https://chatgpt.com/c/test', frameId: 0,
    tab: { id: 7, url: 'https://chatgpt.com/c/test' },
  };
  const ids = eventIds(256);
  const result = await acknowledgeCodexBridgeEventIds(ids, async (batch) => {
    const response = await handle({ type: CODEX_BRIDGE_WATCH_ACK_EVENTS, conversationId: 'test', eventIds: batch }, sender);
    return Boolean(response && response.ok);
  }, () => true);
  assert.deepEqual(result, { status: 'complete', totalCount: 256, confirmedCount: 256 });
  assert.deepEqual(acceptedBatches.map((batch) => batch.length), [128, 128]);
  assert.deepEqual(acceptedBatches.flat(), ids);
  assert.deepEqual(await handle({
    type: CODEX_BRIDGE_WATCH_ACK_EVENTS, conversationId: 'test', eventIds: ids.slice(0, 129),
  }, sender), { ok: false, reason: 'invalid-request' });
});

test('共通ack controllerはクリック時snapshotの未確認eventだけを同一ownerへ送り、新規通知を含めない', async () => {
  const events = [
    { eventId: 'event-a', ownerConversationId: 'conversation-a', acknowledgedAt: null },
    { eventId: 'event-b', ownerConversationId: 'conversation-b', acknowledgedAt: null },
    { eventId: 'event-done', ownerConversationId: 'conversation-a', acknowledgedAt: '2026-11-24T00:00:00Z' },
  ];
  const controller = new CodexBridgeEventAcknowledger();
  const batches: string[][] = [];
  const result = await controller.acknowledge({
    events,
    ownerConversationId: 'conversation-a',
    ownerGeneration: 3,
    getCurrentOwner: () => ({ conversationId: 'conversation-a', generation: 3 }),
    async sendBatch(batch) { batches.push([...batch]); events.push({ eventId: 'event-new', ownerConversationId: 'conversation-a', acknowledgedAt: null }); return true; },
  });
  assert.deepEqual(batches, [['event-a']]);
  assert.equal(result.status, 'complete');
  assert.equal(controller.isBusy, false);
});

test('共通ack controllerは同時操作を抑止し、conversation世代変更後の次batchを送らない', async () => {
  const controller = new CodexBridgeEventAcknowledger();
  const oneEvent = [{ eventId: 'event-a', ownerConversationId: 'conversation-a', acknowledgedAt: null }];
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const batches: string[][] = [];
  const first = controller.acknowledge({
    events: oneEvent, ownerConversationId: 'conversation-a', ownerGeneration: 1,
    getCurrentOwner: () => ({ conversationId: 'conversation-a', generation: 1 }),
    async sendBatch(batch) { batches.push([...batch]); await gate; return true; },
  });
  const duplicate = await controller.acknowledge({
    events: oneEvent, ownerConversationId: 'conversation-a', ownerGeneration: 1,
    getCurrentOwner: () => ({ conversationId: 'conversation-a', generation: 1 }), async sendBatch() { assert.fail('重複送信'); },
  });
  assert.equal(duplicate.status, 'busy');
  release?.();
  assert.equal((await first).status, 'complete');
  assert.deepEqual(batches, [['event-a']]);

  let owner = { conversationId: 'conversation-a', generation: 4 };
  const many = eventIds(129).map((eventId) => ({ eventId, ownerConversationId: 'conversation-a', acknowledgedAt: null }));
  const raceBatches: string[][] = [];
  const raced = await controller.acknowledge({
    events: many, ownerConversationId: 'conversation-a', ownerGeneration: 4, getCurrentOwner: () => owner,
    async sendBatch(batch) { raceBatches.push([...batch]); owner = { conversationId: 'conversation-a', generation: 6 }; return true; },
  });
  assert.equal(raced.status, 'partial');
  assert.deepEqual(raceBatches.map((batch) => batch.length), [128]);
});

test('共通ack controllerは部分失敗を返し、未確認snapshotの残りを個別確認可能にする', async () => {
  const controller = new CodexBridgeEventAcknowledger();
  const batches: number[] = [];
  const result = await controller.acknowledge({
    events: eventIds(129).map((eventId) => ({ eventId, ownerConversationId: 'conversation-a', acknowledgedAt: null })),
    ownerConversationId: 'conversation-a', ownerGeneration: 1,
    getCurrentOwner: () => ({ conversationId: 'conversation-a', generation: 1 }),
    async sendBatch(batch) { batches.push(batch.length); return batches.length === 1; },
  });
  assert.deepEqual(batches, [128, 1]);
  assert.deepEqual(result, { status: 'partial', totalCount: 129, confirmedCount: 128 });
});
