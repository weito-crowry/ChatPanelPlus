import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_BRIDGE_TERMINAL_EVENT_SAVED,
  isCodexBridgeTerminalEventSavedMessage,
} from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import {
  createCodexBridgeTerminalAnswerAutoReflector,
  isTerminalEventNewerThanAutoReflectEnable,
} from '../src/content/codexbridge-terminal-answer-auto-reflect.ts';
import type { EditResult } from '../src/content/editor/adapter.ts';

const event = (eventId: string, ownerConversationId = 'conversation-A') => ({
  type: CODEX_BRIDGE_TERMINAL_EVENT_SAVED,
  eventId,
  ownerConversationId,
  detectedAt: '2026-11-24T10:00:00.000Z',
});

function reflector(options: {
  read?: (eventId: string) => Promise<unknown>;
  eligible?: () => boolean;
  append?: (text: string) => EditResult;
} = {}) {
  const reads: string[] = [];
  const inserted: string[] = [];
  const outcomes: Array<{ eventId: string; result: unknown }> = [];
  const waits: number[] = [];
  const instance = createCodexBridgeTerminalAnswerAutoReflector({
    isEligible: options.eligible ?? (() => true),
    async readFinalAnswer(eventId) {
      reads.push(eventId);
      return options.read ? options.read(eventId) : {
        ok: true, data: { status: 'retrieved', completeness: 'confirmed', text: `answer:${eventId}` },
      };
    },
    appendAnswer(text) { inserted.push(text); return options.append?.(text) ?? { ok: true }; },
    async wait(milliseconds) { waits.push(milliseconds); },
    onResult(eventId, result) { outcomes.push({ eventId, result }); },
  });
  return { instance, reads, inserted, outcomes, waits };
}

test('identity-only event messageを厳密に判定し、本文付き/不正messageを受け付けない', () => {
  assert.equal(isCodexBridgeTerminalEventSavedMessage(event('event-1')), true);
  assert.equal(isCodexBridgeTerminalEventSavedMessage({ ...event('event-1'), text: 'private' }), false);
  assert.equal(isCodexBridgeTerminalEventSavedMessage({ ...event(''), ownerConversationId: 'conversation-A' }), false);
});

test('ON時刻より前に保存されたeventは遅れて届いても過去eventとして反映しない', () => {
  const oldEvent = event('old-event');
  assert.equal(isTerminalEventNewerThanAutoReflectEnable(oldEvent, true, Date.parse('2026-11-24T10:00:00.001Z')), false);
  assert.equal(isTerminalEventNewerThanAutoReflectEnable(oldEvent, true, Date.parse('2026-11-24T10:00:00.000Z')), false);
  assert.equal(isTerminalEventNewerThanAutoReflectEnable({ ...oldEvent, detectedAt: '2026-11-24T10:00:00.002Z' }, true,
    Date.parse('2026-11-24T10:00:00.001Z')), true);
});

test('OFF受信eventは取得せず未反映とし、後からONや重複通知でも遡及挿入しない', async () => {
  const h = reflector();
  assert.equal(await h.instance.receive(event('event-off'), false), true);
  assert.equal(await h.instance.receive(event('event-off'), true), false);
  assert.deepEqual(h.reads, []);
  assert.deepEqual(h.inserted, []);
  assert.deepEqual(h.outcomes[0]?.result, { status: 'not-reflected', reason: 'disabled' });
});

test('確定取得本文は一度だけ追記し、本文を状態結果へ含めない', async () => {
  const h = reflector();
  assert.equal(await h.instance.receive(event('event-1'), true), true);
  assert.equal(await h.instance.receive(event('event-1'), true), false);
  assert.deepEqual(h.reads, ['event-1']);
  assert.deepEqual(h.inserted, ['answer:event-1']);
  assert.deepEqual(h.outcomes[0]?.result, { status: 'reflected' });
});

test('pendingのみ最大2回retryし、未確定・不完全・取得失敗は挿入しない', async () => {
  const pending = reflector({ read: async () => ({ ok: true, data: { status: 'pending' } }) });
  await pending.instance.receive(event('pending'), true);
  assert.equal(pending.reads.length, 3);
  assert.deepEqual(pending.waits, [250, 500]);
  assert.deepEqual(pending.inserted, []);
  assert.deepEqual(pending.outcomes[0]?.result, { status: 'not-reflected', reason: 'pending' });

  for (const [eventId, data] of [
    ['unconfirmed', { status: 'retrieved', completeness: 'unconfirmed', text: 'no' }],
    ['incomplete', { status: 'incomplete', reason: 'partial_response', completeness: 'unconfirmed' }],
    ['failed', { status: 'failed', reason: 'connection-changed' }],
    ['no-answer', { status: 'no-final-answer', completeness: 'unconfirmed' }],
  ] as const) {
    const h = reflector({ read: async () => ({ ok: true, data }) });
    await h.instance.receive(event(eventId), true);
    assert.deepEqual(h.inserted, [], eventId);
  }
});

test('取得中に会話route/設定が変われば挿入せず、同一会話の複数eventは順番に処理する', async () => {
  const eligible = false;
  const changed = reflector({ eligible: () => eligible });
  await changed.instance.receive(event('route-changed'), true);
  assert.deepEqual(changed.inserted, []);
  assert.deepEqual(changed.outcomes[0]?.result, { status: 'not-reflected', reason: 'route-or-setting-changed' });

  let release!: (value: unknown) => void;
  const firstAnswer = new Promise<unknown>((resolve) => { release = resolve; });
  const serialized = reflector({
    read: async (eventId) => eventId === 'first'
      ? firstAnswer
      : { ok: true, data: { status: 'retrieved', completeness: 'confirmed', text: 'second-answer' } },
  });
  const first = serialized.instance.receive(event('first'), true);
  const second = serialized.instance.receive(event('second'), true);
  await Promise.resolve();
  assert.deepEqual(serialized.reads, ['first']);
  release({ ok: true, data: { status: 'retrieved', completeness: 'confirmed', text: 'first-answer' } });
  await Promise.all([first, second]);
  assert.deepEqual(serialized.reads, ['first', 'second']);
  assert.deepEqual(serialized.inserted, ['first-answer', 'second-answer']);
});

test('C37取得応答後、挿入前にrouteまたは設定が変化していれば下書きを変更しない', async () => {
  let eligible = true;
  const h = reflector({
    eligible: () => eligible,
    read: async () => {
      eligible = false;
      return { ok: true, data: { status: 'retrieved', completeness: 'confirmed', text: 'answer' } };
    },
  });
  await h.instance.receive(event('changed-during-read'), true);
  assert.deepEqual(h.inserted, []);
  assert.deepEqual(h.outcomes[0]?.result, { status: 'not-reflected', reason: 'route-or-setting-changed' });
});
