import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRunningThreadCount } from '../src/content/codexbridge-running-summary.ts';

test('Bridgeのrunning_onlyが返した真の0件を表示する', () => {
  assert.deepEqual(formatRunningThreadCount({ targetId: 'machine-1', count: 0, status: 'ready' }, 'machine-1', 'connected'), {
    value: 0,
    title: '選択中の対象に対するBridgeの実行中一覧です（確定・推定を含む）。',
  });
});

test('未対応・エラー・接続中・対象切替中は古い件数を表示しない', () => {
  const stale = { targetId: 'machine-old', count: 12, status: 'ready' as const };
  for (const input of [
    [stale, 'machine-new', 'connected'],
    [{ targetId: 'machine-new', count: null, status: 'unsupported' }, 'machine-new', 'connected'],
    [{ targetId: 'machine-new', count: null, status: 'error' }, 'machine-new', 'connected'],
    [{ targetId: 'machine-new', count: null, status: 'loading' }, 'machine-new', 'connected'],
    [{ targetId: 'machine-new', count: 7, status: 'ready' }, 'machine-new', 'error'],
    [{ targetId: null, count: 7, status: 'ready' }, null, 'connected'],
  ] as const) {
    const view = formatRunningThreadCount(input[0], input[1], input[2]);
    assert.equal(view.value, '—');
    assert.notEqual(view.title, '選択中の対象に対するBridgeの実行中一覧です（確定・推定を含む）。');
  }
});
