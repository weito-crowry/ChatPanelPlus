import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCodexBridgeWatchListResponse } from '../src/content/codexbridge-watch-response.ts';

test('watch一覧はsender拒否・storage失敗・不正応答を区別する', () => {
  assert.deepEqual(parseCodexBridgeWatchListResponse({ ok: false, reason: 'invalid-request' }), {
    ok: false, reason: 'sender-unverified',
  });
  assert.deepEqual(parseCodexBridgeWatchListResponse({ ok: false, reason: 'storage-error' }), {
    ok: false, reason: 'storage-error',
  });
  assert.deepEqual(parseCodexBridgeWatchListResponse({ ok: true, data: {} }), {
    ok: false, reason: 'invalid-response',
  });
});

test('正しいwatch一覧応答では接続ID nullと0件を成功値として保持する', () => {
  assert.deepEqual(parseCodexBridgeWatchListResponse({
    ok: true,
    data: { items: [], events: [], currentConnectionId: null, summary: { watchingCount: 0, unacknowledgedThreadCount: 0 } },
  }), {
    ok: true,
    data: { items: [], events: [], currentConnectionId: null, summary: { watchingCount: 0, unacknowledgedThreadCount: 0 } },
  });
});

test('欠落または不正なwatch/event配列は成功した0件として扱わない', () => {
  const base = { items: [], events: [], currentConnectionId: null,
    summary: { watchingCount: 0, unacknowledgedThreadCount: 0 } };
  assert.deepEqual(parseCodexBridgeWatchListResponse({ ok: true, data: { ...base, events: undefined } }), {
    ok: false, reason: 'invalid-response',
  });
  assert.deepEqual(parseCodexBridgeWatchListResponse({ ok: true, data: { ...base, items: [null] } }), {
    ok: false, reason: 'invalid-response',
  });
  assert.deepEqual(parseCodexBridgeWatchListResponse({ ok: true, data: { ...base, events: [null] } }), {
    ok: false, reason: 'invalid-response',
  });
});
