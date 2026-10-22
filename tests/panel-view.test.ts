import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_BUTTONS, type TabId } from '../src/shared/default-ui.ts';
import {
  createInitialPanelViewState,
  createPanelViewModel,
  formatJstTimestamp,
  pasteResultErrorReason,
  reconcilePanelViewState,
  selectPanelTab,
  togglePanelMinimized,
} from '../src/content/panel-view.ts';
import type { ClipboardPasteResult } from '../src/content/clipboard.ts';

test('未確認や添付の貼り付け結果は通知せず、確定失敗だけエラー理由を返す', () => {
  const cases: Array<[ClipboardPasteResult, string | null]> = [
    [{ kind: 'inserted', edit: { ok: true } }, null],
    [{ kind: 'edit-unconfirmed', reason: 'edit-unconfirmed' }, null],
    [{ kind: 'attachment-accepted', scope: 'composer-ui' }, null],
    [{ kind: 'attachment-unconfirmed' }, null],
    [{ kind: 'manual-required', reason: 'unavailable' }, null],
    [{ kind: 'edit-failed', reason: 'editor-disabled' }, 'editor-disabled'],
  ];

  for (const [result, expected] of cases) {
    assert.equal(pasteResultErrorReason(result), expected);
  }
});

test('標準Panelモデルは常時4ボタン、5タブ、左端タブの内容を正しい順で返す', () => {
  const model = createPanelViewModel();
  assert.deepEqual(model.utilityButtons.map(({ id }) => id), [
    'now-btn', 'paste-btn', 'clear-btn', 'chat-btn',
  ]);
  assert.deepEqual(model.tabs.map(({ id, label }) => [id, label]), [
    ['directive', '指示'], ['control', '会話制御'], ['wall', '壁打ち'], ['binary', '二択'], ['quad', '四択'],
  ]);
  assert.equal(model.selectedTabId, 'directive');
  assert.deepEqual(model.buttonsByTab.get('directive')?.map(({ id }) => id), [
    'full-btn', 'summary-btn', 'translate-btn', 'search-btn',
  ]);
  assert.equal(model.buttonsByTab.get('control')?.length, 2);
  assert.equal(model.utilityButtons.length + [...model.buttonsByTab.values()].flat().length, 20);
});

test('Panelモデルは20 stable IDと既定の表示内容をそのまま維持する', () => {
  const model = createPanelViewModel();
  const projected = [...model.utilityButtons, ...[...model.buttonsByTab.values()].flat()];
  assert.deepEqual(projected.map(({ id, label, color, text, action }) => [id, label, color, text, action]),
    DEFAULT_BUTTONS.map(({ id, label, color, text, action }) => [id, label, color, text, action]));
});

test('Panelモデルは常時表示とタブ内のカスタムボタンを同じ解決済み一覧へ含める', () => {
  const utilityId = 'custom-123e4567-e89b-42d3-a456-426614174040';
  const tabId = 'custom-123e4567-e89b-42d3-a456-426614174041';
  const model = createPanelViewModel({
    schemaVersion: 1,
    customButtons: {
      [utilityId]: { groupId: 'always', label: '貼付', color: '#123', visible: true, kind: 'action', action: 'paste' },
      [tabId]: { groupId: 'directive', label: '追加指示', color: '#456', visible: true, kind: 'insert', text: '' },
    },
  });

  assert.ok(model.utilityButtons.some(({ id, action }) => id === utilityId && action === 'paste'));
  assert.ok(model.buttonsByTab.get('directive')?.some(({ id, text }) => id === tabId && text === ''));
});

test('日時は固定の表示例でなくAsia/Tokyoの実日時形式に整形する', () => {
  assert.equal(formatJstTimestamp(new Date(0)), '[1970/01/01 09:00:00 JST]');
});

test('有効な選択タブを維持し、保存値または非表示タブは左端可視へ戻す', () => {
  const model = createPanelViewModel();
  const initial = createInitialPanelViewState(model.tabs);
  assert.equal(initial.selectedTabId, 'directive');
  const selected = selectPanelTab(initial, model.tabs, 'wall');
  assert.equal(selected.selectedTabId, 'wall');
  const reordered = [...model.tabs].reverse();
  assert.equal(reconcilePanelViewState(selected, reordered).selectedTabId, 'wall');
  assert.equal(createInitialPanelViewState(model.tabs, { selectedTabId: 'binary' }).selectedTabId, 'binary');
  assert.equal(createInitialPanelViewState(model.tabs, { selectedTabId: 'removed' as TabId }).selectedTabId, 'directive');
  const withoutWall = model.tabs.filter(({ id }) => id !== 'wall');
  assert.equal(reconcilePanelViewState(selected, withoutWall).selectedTabId, 'directive');
  assert.equal(reconcilePanelViewState(selectPanelTab(selected, withoutWall, 'wall'), withoutWall).selectedTabId, 'directive');
  const normalized = reconcilePanelViewState(selected, withoutWall);
  assert.equal(reconcilePanelViewState(normalized, model.tabs).selectedTabId, 'directive');
});

test('全タブ非表示では選択をnullにし、再表示時は左端へ戻す', () => {
  const model = createPanelViewModel();
  const empty = createPanelViewModel({
    schemaVersion: 1,
    tabOverrides: Object.fromEntries(model.tabs.map(({ id }) => [id, { visible: false }])),
  });
  const state = createInitialPanelViewState(empty.tabs, { selectedTabId: 'control' });
  assert.equal(state.selectedTabId, null);
  assert.equal(empty.tabs.length, 0);
  assert.equal(empty.utilityButtons.length, 4);
  assert.equal(empty.buttonsByTab.size, 0);
  assert.equal(reconcilePanelViewState(state, model.tabs).selectedTabId, 'directive');
});

test('最小化の切替で選択タブを保ち、初期値は展開状態', () => {
  const tabs = createPanelViewModel().tabs;
  const initial = selectPanelTab(createInitialPanelViewState(tabs), tabs, 'control');
  assert.equal(initial.minimized, false);
  const minimized = togglePanelMinimized(initial);
  assert.deepEqual(minimized, { selectedTabId: 'control', minimized: true });
  assert.deepEqual(togglePanelMinimized(minimized), initial);
});
