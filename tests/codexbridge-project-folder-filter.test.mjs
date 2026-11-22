import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('A一覧は取得済みthreadにだけproject cwd filterを適用し、すべてが初期値', async () => {
  const [list, filter] = await Promise.all([
    read('../src/content/CodexBridgeList.tsx'),
    read('../src/content/CodexBridgeProjectFolderFilter.tsx'),
  ]);
  assert.match(list, /<CodexBridgeProjectFolderFilter/);
  assert.match(list, /threads=\{threadsLoaded \? displayedThreads : \[\]\}/);
  assert.match(list, /onSelectThread=\{/);
  assert.match(filter, /useState\(''\)/);
  assert.match(filter, /filterThreadsByFolderPatterns/);
  assert.match(filter, /一致.*取得済み/s);
  assert.match(filter, /パターン未登録/);
});

test('フォルダ設定storage変更を世代番号で反映し、filter操作でwatch選択やBridge要求を変更しない', async () => {
  const [list, filter] = await Promise.all([
    read('../src/content/CodexBridgeList.tsx'),
    read('../src/content/CodexBridgeProjectFolderFilter.tsx'),
  ]);
  assert.match(filter, /chrome\.storage\.onChanged/);
  assert.match(filter, /generation\.current/);
  assert.match(list, /CODEX_BRIDGE_MCP_GET_THREADS/);
  assert.match(filter, /onSelectThread/);
  assert.doesNotMatch(filter, /CODEX_BRIDGE_WATCH_START|CODEX_BRIDGE_WATCH_STOP|sendMessage/);
});
