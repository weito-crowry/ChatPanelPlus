import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const panelPath = resolve(fileURLToPath(new URL('../src/content/PanelView.tsx', import.meta.url)));
const controllerPath = resolve(fileURLToPath(new URL('../src/content/usePanelController.ts', import.meta.url)));

test('常時表示・タブ内ボタンを同一ディスパッチャーで実行し、caret挿入と貼付の選択位置を保存する', async () => {
  const [source, controller] = await Promise.all([readFile(panelPath, 'utf8'), readFile(controllerPath, 'utf8')]);
  assert.equal(source.match(/onClick=\{\(event\) => onButtonClick\(button, event\.detail > 0\)\}/g)?.length, 2);
  assert.equal(source.match(/onPointerDown=\{button\.action === 'paste' \|\| \(button\.kind === 'insert' && button\.insertionMode === 'caret'\) \? \(\) => onButtonPointerDown\(button\.id\) : undefined\}/g)?.length, 2);
  assert.ok(controller.includes('snapshot ?? captureSelectionForPaste()'));
  assert.ok(controller.includes('dispatchPanelButton(button'));
  assert.ok(controller.includes('isPointerClick && pointerCapture?.buttonId === button.id'));
  assert.ok(!controller.includes('function activate('));
});
