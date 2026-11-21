import assert from 'node:assert/strict';
import test from 'node:test';
import type { CodexBridgeThread } from '../src/shared/codexbridge-mcp-protocol.ts';
import { CodexBridgeRequestTracker, mergeCodexBridgeThreads } from '../src/content/codexbridge-request-tracker.ts';
import {
  classifyCodexBridgeThreadActivity,
  filterCodexBridgeThreads,
  sortCodexBridgeThreadsByActivity,
} from '../src/content/codexbridge-thread-order.ts';

function thread(id: string, options: Readonly<{
  state?: string | null;
  updatedAt?: string | null;
  lastTurnStatus?: string | null;
}> = {}): CodexBridgeThread {
  return {
    targetId: 'target-1', id, title: id, preview: null, cwd: null, updatedAt: options.updatedAt ?? null,
    currentExecution: options.state ? { state: options.state } : null,
    lastTurn: options.lastTurnStatus ? { status: options.lastTurnStatus } : null,
    needsAttention: null,
  } as unknown as CodexBridgeThread;
}

test('実行中、推定、その他の優先順位と更新時刻の安定順を保つ', () => {
  const input = [
    thread('unknown-new', { state: 'unknown', updatedAt: '2026-11-21T06:00:00Z' }),
    thread('estimated', { state: 'estimated_running', updatedAt: '2026-11-21T05:00:00Z' }),
    thread('running-old', { state: 'running', updatedAt: '2026-11-21T03:00:00Z' }),
    thread('running-new', { state: 'in_progress', updatedAt: '2026-11-21T04:00:00Z' }),
    thread('running-tie', { state: 'in_progress', updatedAt: '2026-11-21T04:00:00Z' }),
    thread('last-turn-only', { lastTurnStatus: 'in_progress', updatedAt: '2026-11-21T07:00:00Z' }),
  ];
  const original = [...input];
  const sorted = sortCodexBridgeThreadsByActivity(input);
  assert.deepEqual(sorted.map(({ id }) => id), [
    'running-new', 'running-tie', 'running-old', 'estimated', 'last-turn-only', 'unknown-new',
  ]);
  assert.deepEqual(input, original);
  assert.notStrictEqual(sorted, input);
  assert.deepEqual(classifyCodexBridgeThreadActivity(thread('explicit', { state: 'in_progress' })), 'running');
  assert.deepEqual(classifyCodexBridgeThreadActivity(thread('running', { state: 'running' })), 'running');
  assert.deepEqual(classifyCodexBridgeThreadActivity(thread('estimated', { state: 'estimated_running' })), 'estimated');
  assert.deepEqual(classifyCodexBridgeThreadActivity(thread('last-only', { lastTurnStatus: 'in_progress' })), 'inactive');
  assert.deepEqual(classifyCodexBridgeThreadActivity(thread('unknown', { state: 'future-running-state' })), 'inactive');
});

test('不正・欠損日時は末尾に残し、同順位では元のAPI順を維持する', () => {
  const input = [
    thread('bad-a', { state: 'unknown', updatedAt: 'not-a-date' }),
    thread('valid', { state: 'unknown', updatedAt: '2026-11-21T00:00:00Z' }),
    thread('missing', { state: 'unknown' }),
    thread('bad-b', { state: 'unknown', updatedAt: 'also-not-a-date' }),
  ];
  assert.deepEqual(sortCodexBridgeThreadsByActivity(input).map(({ id }) => id), ['valid', 'bad-a', 'missing', 'bad-b']);
});

test('読み込み済みページのmerge後に優先度を再評価し、元配列を変更しない', () => {
  const firstPage = [
    thread('updated-later', { state: 'unknown', updatedAt: '2026-11-21T00:00:00Z' }),
    thread('page-one-running', { state: 'in_progress', updatedAt: '2026-11-21T01:00:00Z' }),
  ];
  const nextPage = [
    thread('updated-later', { state: 'running', updatedAt: '2026-11-21T02:00:00Z' }),
    thread('page-two-estimated', { state: 'estimated_running', updatedAt: '2026-11-21T03:00:00Z' }),
  ];
  const originalFirstPage = [...firstPage];
  const merged = mergeCodexBridgeThreads(firstPage, nextPage);
  assert.deepEqual(filterCodexBridgeThreads(merged, false).map(({ id }) => id), [
    'updated-later', 'page-one-running', 'page-two-estimated',
  ]);
  assert.deepEqual(firstPage, originalFirstPage);
  assert.deepEqual(filterCodexBridgeThreads(merged, true).map(({ id }) => id), [
    'updated-later', 'page-one-running', 'page-two-estimated',
  ]);
});

test('実行中のみfilterは確定・推定だけを返し、OFFでは全一覧を保持、空状態も空配列を返す', () => {
  const threads = [
    thread('idle', { state: 'unknown' }),
    thread('estimated', { state: 'estimated_running' }),
    thread('running', { state: 'in_progress' }),
    thread('unknown', { state: null }),
  ];
  assert.deepEqual(filterCodexBridgeThreads(threads, true).map(({ id }) => id), ['running', 'estimated']);
  assert.equal(filterCodexBridgeThreads(threads, false).length, 4);
  assert.deepEqual(filterCodexBridgeThreads([], true), []);
});

test('表示モードと対象を切り替えると古い一覧応答を破棄し、通常一覧のcursorを維持する', () => {
  const tracker = new CodexBridgeRequestTracker();
  tracker.selectTarget('target-1');
  const running = tracker.beginThreads('target-1');
  assert.equal(tracker.isCurrentThreads(running), true);

  tracker.selectMode('normal');
  assert.equal(tracker.isCurrentThreads(running), false);
  const firstNormalPage = tracker.beginThreads('target-1');
  assert.equal(tracker.setNextCursor(firstNormalPage, 'page-2'), true);
  const secondNormalPage = tracker.beginThreads('target-1', 'page-2');
  assert.equal(tracker.isCurrentThreads(secondNormalPage), true);

  tracker.selectTarget('target-2');
  assert.equal(tracker.isCurrentThreads(secondNormalPage), false);
});
