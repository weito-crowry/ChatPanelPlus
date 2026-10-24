import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchPanelButton } from '../src/content/panel-button-actions.ts';
import type { ResolvedButton } from '../src/shared/default-ui.ts';

function button(definition: Partial<ResolvedButton>): ResolvedButton {
  return {
    id: 'custom-123e4567-e89b-42d3-a456-426614174030',
    groupId: 'directive', order: 0, label: '操作', color: '#123456', visible: true, kind: 'action', action: 'clear',
    ...definition,
  } as ResolvedButton;
}

test('既定・カスタムボタンの4操作は共通ディスパッチャーから一度だけ正しい処理へ進む', () => {
  const calls: string[] = [];
  const handlers = {
    insert: (text: string) => calls.push(`insert:${text}`),
    insertJst: () => calls.push('insert-jst'),
    paste: () => calls.push('paste'),
    clear: () => calls.push('clear'),
  };

  dispatchPanelButton(button({ id: 'full-btn', kind: 'insert', text: '本文' }), handlers);
  dispatchPanelButton(button({ kind: 'action', action: 'insert-jst' }), handlers);
  dispatchPanelButton(button({ kind: 'action', action: 'paste' }), handlers);
  dispatchPanelButton(button({ kind: 'action', action: 'clear' }), handlers);

  assert.deepEqual(calls, ['insert:本文', 'insert-jst', 'paste', 'clear']);
});

test('挿入ディスパッチはcaret・beginning・未設定のモードをハンドラーへ渡す', () => {
  const modes: Array<string | undefined> = [];
  const button = {
    id: 'custom-123e4567-e89b-42d3-a456-426614174020',
    groupId: 'directive',
    order: 0,
    label: '定型文',
    color: '#123456',
    kind: 'insert',
    text: '定型文',
    insertionMode: 'caret',
    visible: true,
  } as const satisfies ResolvedButton;

  dispatchPanelButton(button, {
    insert: (_text, insertionMode) => modes.push(insertionMode),
    insertJst: () => assert.fail('挿入ボタンは時刻操作へ進まない'),
    paste: () => assert.fail('挿入ボタンは貼付操作へ進まない'),
    clear: () => assert.fail('挿入ボタンはクリア操作へ進まない'),
  });
  dispatchPanelButton({ ...button, insertionMode: 'beginning' }, {
    insert: (_text, insertionMode) => modes.push(insertionMode),
    insertJst: () => assert.fail('挿入ボタンは時刻操作へ進まない'),
    paste: () => assert.fail('挿入ボタンは貼付操作へ進まない'),
    clear: () => assert.fail('挿入ボタンはクリア操作へ進まない'),
  });
  dispatchPanelButton({ ...button, insertionMode: undefined }, {
    insert: (_text, insertionMode) => modes.push(insertionMode),
    insertJst: () => assert.fail('挿入ボタンは時刻操作へ進まない'),
    paste: () => assert.fail('挿入ボタンは貼付操作へ進まない'),
    clear: () => assert.fail('挿入ボタンはクリア操作へ進まない'),
  });

  assert.deepEqual(modes, ['caret', 'beginning', undefined]);
});
