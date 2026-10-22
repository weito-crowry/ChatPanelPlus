import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const panelPath = resolve(fileURLToPath(new URL('../src/content/Panel.tsx', import.meta.url)));

test('ダイアログのTab循環はShadowRootのactiveElementを優先しDocumentへフォールバックする', async () => {
  const source = await readFile(panelPath, 'utf8');
  assert.match(source, /const root = event\.currentTarget\.getRootNode\(\);/);
  assert.match(source, /root instanceof ShadowRoot \? root\.activeElement \?\? document\.activeElement : document\.activeElement/);
});
