import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRunningThreadCount, type RunningThreadSummary } from '../src/content/codexbridge-running-summary.ts';

function summary(status: RunningThreadSummary['status'], threads: RunningThreadSummary['threads']): RunningThreadSummary {
  return { targetId: 'target', threads, status };
}

test('freshな実行中snapshotの0件と複数件をそのまま件数表示する', () => {
  assert.equal(formatRunningThreadCount(summary('ready', []), 'target', 'connected').value, 0);
  assert.equal(formatRunningThreadCount(summary('ready', [
    { targetId: 'target', id: 'one', title: null, preview: null, cwd: null, updatedAt: null,
      currentExecution: null, lastTurn: null, needsAttention: null },
    { targetId: 'target', id: 'two', title: null, preview: null, cwd: null, updatedAt: null,
      currentExecution: null, lastTurn: null, needsAttention: null },
  ]), 'target', 'connected').value, 2);
});

test('staleな実行中snapshotは件数を最新表示せず古さを示す', () => {
  const view = formatRunningThreadCount({ ...summary('stale', []), observedAt: '2026-11-24T00:00:00.000Z' }, 'target', 'connected');
  assert.equal(view.value, '—');
  assert.match(view.title, /古い/);
});

test('未取得状態と取得失敗を0件やloadingと区別する', () => {
  const unknown = formatRunningThreadCount({ targetId: 'target', threads: null, status: 'unknown' }, 'target', 'connected');
  const error = formatRunningThreadCount({ targetId: 'target', threads: null, status: 'error' }, 'target', 'connected');
  assert.equal(unknown.value, '—');
  assert.match(unknown.title, /未確認/);
  assert.equal(error.value, '—');
  assert.match(error.title, /取得できません/);
});
