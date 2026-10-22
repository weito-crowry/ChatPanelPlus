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
