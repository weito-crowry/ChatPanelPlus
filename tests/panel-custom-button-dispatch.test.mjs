import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const panelPath = resolve(fileURLToPath(new URL('../src/content/Panel.tsx', import.meta.url)));

test('常時表示・タブ内ボタンを同一ディスパッチャーで実行し、両群の貼付が選択位置を保存する', async () => {
  const source = await readFile(panelPath, 'utf8');
  assert.equal(source.match(/onClick=\{\(\) => dispatchButton\(button\)\}/g)?.length, 2);
  assert.equal(source.match(/onPointerDown=\{button\.action === 'paste' \? capturePastePointer : undefined\}/g)?.length, 2);
  assert.ok(source.includes('pointerSnapshot.current ?? captureSelectionForPaste()'));
  assert.ok(source.includes('dispatchPanelButton(button'));
  assert.ok(!source.includes('function activate('));
});
