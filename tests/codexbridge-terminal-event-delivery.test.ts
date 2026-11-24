import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexBridgeThreadMonitorStorage } from '../src/background/thread-monitor-storage.ts';
import { CodexBridgeTerminalEventDelivery } from '../src/background/terminal-event-delivery.ts';
import {
  CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY,
  CODEX_BRIDGE_TERMINAL_EVENT_SAVED,
  type CodexBridgeTerminalEvent,
} from '../src/shared/codexbridge-thread-monitor-protocol.ts';

const identity = { connectionId: 'connection-A', targetId: 'target-A', conversationId: 'conversation-A' } as const;

function event(eventId: string, delivery: CodexBridgeTerminalEvent['ownerDeliveryState'] | null = 'pending',
  ownerConversationId = identity.conversationId): CodexBridgeTerminalEvent {
  return {
    eventId, watchId: 'watch-A', connectionId: identity.connectionId, targetId: identity.targetId,
    threadId: 'thread-A', turnId: `turn-${eventId}`, status: 'completed', detectedAt: '2026-11-24T10:00:00.000Z',
    notificationState: 'pending', notificationReason: null, ownerTabId: 4, ownerConversationId,
    ownerMuted: false, ownerMuteRevision: 3,
    ...(delivery === null ? {} : { ownerDeliveryState: delivery }),
  };
}

class FakeArea {
  readonly values: Record<string, unknown>;
  constructor(events: readonly CodexBridgeTerminalEvent[]) {
    this.values = { [CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY]: { version: 2, items: [], events } };
  }
  async get(keys: string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.filter((key) => key in this.values).map((key) => [key, structuredClone(this.values[key])]));
  }
  async set(items: Record<string, unknown>): Promise<void> { Object.assign(this.values, structuredClone(items)); }
}

function storedEvents(area: FakeArea): readonly CodexBridgeTerminalEvent[] {
  return (area.values[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY] as { events: readonly CodexBridgeTerminalEvent[] }).events;
}

test('pending new eventはowner lease再開後に一度だけidentity-onlyでdispatchする', async () => {
  const area = new FakeArea([event('event-pending')]);
  const storage = new CodexBridgeThreadMonitorStorage(area);
  let available = false;
  const sent: Array<{ tabId: number; message: unknown }> = [];
  const delivery = new CodexBridgeTerminalEventDelivery(storage,
    async (requested) => available && JSON.stringify(requested) === JSON.stringify(identity)
      ? { kind: 'owner', tabId: 9 } : { kind: 'none' },
    async (tabId, message) => { sent.push({ tabId, message }); });

  assert.equal(await delivery.dispatch('event-pending'), false);
  assert.equal(storedEvents(area)[0]?.ownerDeliveryState, 'pending');
  available = true;
  await delivery.resume(identity, 9);
  await delivery.resume(identity, 9);

  assert.deepEqual(sent, [{ tabId: 9, message: {
    type: CODEX_BRIDGE_TERMINAL_EVENT_SAVED, eventId: 'event-pending',
    ownerConversationId: identity.conversationId, detectedAt: '2026-11-24T10:00:00.000Z',
  } }]);
  assert.equal(storedEvents(area)[0]?.ownerDeliveryState, 'delivered');
  assert.equal(storedEvents(area)[0]?.ownerTabId, 9);
});

test('requestedと旧format eventはrestoreで再送しない', async () => {
  const historyEvent = event('event-history', null);
  const area = new FakeArea([event('event-uncertain', 'requested'), historyEvent]);
  const storage = new CodexBridgeThreadMonitorStorage(area);
  let sends = 0;
  const delivery = new CodexBridgeTerminalEventDelivery(storage,
    async () => ({ kind: 'owner', tabId: 9 }), async () => { sends += 1; });

  await delivery.resumeAll();
  await delivery.resume(identity, 9);
  assert.equal(sends, 0);
  assert.equal(storedEvents(area)[0]?.ownerDeliveryState, 'requested');
  assert.equal(storedEvents(area)[1]?.ownerDeliveryState, undefined);
});

test('送信結果不明はrequested claimを残し再試行せず、既読pendingも自動挿入しない', async () => {
  const acknowledged = { ...event('event-ack'), acknowledgedAt: '2026-11-24T10:01:00.000Z' };
  const area = new FakeArea([event('event-uncertain'), acknowledged]);
  const storage = new CodexBridgeThreadMonitorStorage(area);
  let sends = 0;
  const delivery = new CodexBridgeTerminalEventDelivery(storage,
    async () => ({ kind: 'owner', tabId: 9 }), async () => { sends += 1; throw new Error('reply unavailable'); });

  await delivery.resume(identity, 9);
  await delivery.resume(identity, 9);
  assert.equal(sends, 1);
  assert.equal(storedEvents(area).find((item) => item.eventId === 'event-uncertain')?.ownerDeliveryState, 'requested');
  assert.equal(storedEvents(area).find((item) => item.eventId === 'event-ack')?.ownerDeliveryState, 'pending');
});

test('別identityのownerがいるだけではpending eventをdispatchしない', async () => {
  const area = new FakeArea([event('event-other')]);
  const delivery = new CodexBridgeTerminalEventDelivery(new CodexBridgeThreadMonitorStorage(area),
    async () => ({ kind: 'owner', tabId: 9 }), async () => assert.fail('wrong identity dispatch'));

  await delivery.resume({ ...identity, targetId: 'target-B' }, 9);
  assert.equal(storedEvents(area)[0]?.ownerDeliveryState, 'pending');
});
