import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const pagePath = resolve(fileURLToPath(new URL('../options/src/OptionsPage.tsx', import.meta.url)));

test('Optionsに表示切替・上下並べ替え・ドラフト保存・確認付きimport/reset・exportがある', async () => {
  const source = await readFile(pagePath, 'utf8');
  for (const behavior of [
    'type="checkbox"', '上へ', '下へ', '保存', 'window.confirm',
    'この設定をドラフトに適用', 'application/json', 'serializeSettings',
    'type="color"', '<textarea',
  ]) assert.ok(source.includes(behavior), `OptionsPage missing ${behavior}`);
});
