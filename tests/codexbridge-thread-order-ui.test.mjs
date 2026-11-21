import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourcePath = fileURLToPath(new URL('../src/content/CodexBridgeList.tsx', import.meta.url));
const mainPath = fileURLToPath(new URL('../src/content/main.tsx', import.meta.url));

test('読み込み済み対象と説明を持つaccessibleなnative checkboxを表示する', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /const \[runningOnly, setRunningOnly\] = useState\(true\)/);
  assert.match(source, /<label>\s*<input type="checkbox" checked=\{runningOnly\}/);
  assert.match(source, /aria-label="読み込み済みthreadを実行中だけ表示"/);
  assert.match(source, /aria-describedby="codex-bridge-running-filter-note"/);
  assert.match(source, /<span>実行中のみ<\/span>/);
  assert.match(source, /id="codex-bridge-running-filter-note">読み込み済みthreadが対象です。次ページを取得すると再判定します。/);
  assert.match(source, /onChange=\{\(event\) => setRunningOnly\(event\.currentTarget\.checked\)\}/);
});

test('filterは表示配列だけを切替え、選択・監視・次ページ要求を変更しない', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /const displayedThreads = filterCodexBridgeThreads\(threads, runningOnly\)/);
  assert.match(source, /displayedThreads\.map\(\(thread, index\) =>/);
  assert.match(source, /const isSelected = selected\?\.targetId === thread\.targetId/);
  assert.match(source, /<CodexBridgeWatchPanel[\s\S]*?selected=\{selected \? \{/);
  const nextPage = source.match(/\{nextCursor && \([\s\S]*?次ページ[\s\S]*?\)\}/)?.[0];
  assert.ok(nextPage, 'next-page control remains available');
  assert.doesNotMatch(nextPage, /runningOnly/);
  const toggle = source.match(/onChange=\{\(event\) => setRunningOnly\(event\.currentTarget\.checked\)\}/)?.[0];
  assert.ok(toggle);
  assert.doesNotMatch(toggle, /updateSelected|requestTracker|setThreads/);
});

test('未読込・実一覧空・filter結果空の案内を区別する', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /!threadsLoaded && <p className="codex-bridge-empty">thread一覧は未読込です。/);
  assert.match(source, /threadsLoaded && threads\.length === 0 && <p className="codex-bridge-empty">threadはありません。/);
  assert.match(source, /threadsLoaded && threads\.length > 0 && runningOnly && displayedThreads\.length === 0/);
  assert.match(source, /読み込み済みthreadに実行中または推定実行中はありません。/);
  assert.match(source, /threadsError && <p className="codex-bridge-error" role="alert">/);
});

test('filter stylesheetを既存Shadow DOMのstyle要素へ注入する', async () => {
  const main = await readFile(mainPath, 'utf8');
  assert.match(main, /import codexBridgeThreadFilterStyles from '\.\/codexbridge-thread-filter\.css\?inline'/);
  assert.match(main, /style\.textContent = `\$\{panelStyles\}[\s\S]*?\$\{codexBridgeThreadFilterStyles\}[\s\S]*?\$\{panelPhase6Styles\}`/);
});

test('推定中は推定ラベルを表示し、確定中のstateは実行中と表示する', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /activity === 'estimated' \? '実行中の推定'/);
  assert.match(source, /className=\{`phase6-thread-state is-\$\{activity\}`\}/);
  assert.match(source, /value === 'in_progress' \|\| value === 'running'\) return '実行中'/);
});
