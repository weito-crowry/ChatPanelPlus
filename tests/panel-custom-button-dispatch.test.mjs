import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const panelPath = resolve(fileURLToPath(new URL('../src/content/Panel.tsx', import.meta.url)));

test('常時表示・タブ内ボタンを同一ディスパッチャーで実行し、caret挿入と貼付の選択位置を保存する', async () => {
  const source = await readFile(panelPath, 'utf8');
  assert.equal(source.match(/onClick=\{\(event\) => dispatchButton\(button, event\.detail > 0\)\}/g)?.length, 2);
  assert.equal(source.match(/onPointerDown=\{button\.action === 'paste' \|\| \(button\.kind === 'insert' && button\.insertionMode === 'caret'\) \? \(\) => captureSelectionPointer\(button\.id\) : undefined\}/g)?.length, 2);
  assert.ok(source.includes('snapshot ?? captureSelectionForPaste()'));
  assert.ok(source.includes('dispatchPanelButton(button'));
  assert.ok(!source.includes('function activate('));
});
