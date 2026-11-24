import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRunningThreadCount } from '../src/content/codexbridge-running-summary.ts';
import type { CodexBridgeThread } from '../src/shared/codexbridge-mcp-protocol.ts';

function thread(id: string, targetId = 'machine-new'): CodexBridgeThread {
  return { targetId, id, title: null, preview: null, cwd: null, updatedAt: null,
    currentExecution: null, lastTurn: null, needsAttention: null };
}

test('Bridgeのrunning_onlyが返した真の0件を表示する', () => {
  assert.deepEqual(formatRunningThreadCount({ targetId: 'machine-1', threads: [], status: 'ready' }, 'machine-1', 'connected'), {
    value: 0,
    title: '選択中の対象に対するBridgeの実行中一覧です（確定・推定を含む）。',
  });
});

test('未対応・エラー・接続中・対象切替中は古い件数を表示しない', () => {
  const stale = { targetId: 'machine-old', threads: Array.from({ length: 12 }, (_, id) => thread(String(id), 'machine-old')), status: 'ready' as const };
  for (const input of [
    [stale, 'machine-new', 'connected'],
    [{ targetId: 'machine-new', threads: null, status: 'unsupported' }, 'machine-new', 'connected'],
    [{ targetId: 'machine-new', threads: null, status: 'error' }, 'machine-new', 'connected'],
    [{ targetId: 'machine-new', threads: null, status: 'loading' }, 'machine-new', 'connected'],
    [{ targetId: 'machine-new', threads: [thread('stale')], status: 'ready' }, 'machine-new', 'error'],
    [{ targetId: null, threads: [thread('stale')], status: 'ready' }, null, 'connected'],
  ] as const) {
    const view = formatRunningThreadCount(input[0], input[1], input[2]);
    assert.equal(view.value, '—');
    assert.notEqual(view.title, '選択中の対象に対するBridgeの実行中一覧です（確定・推定を含む）。');
  }
});

test('実行中件数はポップオーバーへ渡す同じrunning_only一覧から算出する', () => {
  const summary = { targetId: 'machine-1', threads: [thread('one', 'machine-1'), thread('two', 'machine-1')], status: 'ready' as const };
  assert.equal(formatRunningThreadCount(summary, 'machine-1', 'connected').value, 2);
  assert.equal(formatRunningThreadCount({ ...summary, threads: [] }, 'machine-1', 'connected').value, 0);
});
