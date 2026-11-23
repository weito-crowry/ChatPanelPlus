import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourcePath = fileURLToPath(new URL('../src/content/CodexBridgeList.tsx', import.meta.url));
const modePath = fileURLToPath(new URL('../src/content/CodexBridgeThreadModePicker.tsx', import.meta.url));
const mainPath = fileURLToPath(new URL('../src/content/main.tsx', import.meta.url));
const labelsPath = fileURLToPath(new URL('../src/content/codexbridge-thread-status-labels.ts', import.meta.url));

test('Bridge取得モードは実行中を既定にし、通常一覧とaccessibleな説明を持つradioを表示する', async () => {
  const [source, picker] = await Promise.all([readFile(sourcePath, 'utf8'), readFile(modePath, 'utf8')]);
  assert.match(source, /const \[listMode, setListMode\] = useState<CodexBridgeThreadListMode>\('running'\)/);
  assert.match(picker, /<fieldset className="codex-bridge-list-mode" aria-describedby=\{descriptionId\}>/);
  assert.match(picker, /value="running" checked=\{mode === 'running'\}/);
  assert.match(picker, /value="normal" checked=\{mode === 'normal'\}/);
  assert.match(picker, /Bridgeの実行中一覧APIが返したthreadを表示します/);
  assert.match(picker, /通常一覧は20件ずつ取得します/);
});

test('running_onlyと通常cursor要求を分け、切替は選択と監視を保持する', async () => {
  const [source, filter] = await Promise.all([
    readFile(sourcePath, 'utf8'), readFile(new URL('../src/content/CodexBridgeProjectFolderFilter.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(source, /\.\.\.\(terminalContext\.current\.mode === 'running' \? \{ runningOnly: true \} : \{\}\)/);
  assert.match(source, /const displayedThreads = sortCodexBridgeThreadsByActivity\(threads\)/);
  assert.doesNotMatch(source, /filterCodexBridgeThreads\(threads/);
  assert.match(filter, /visibleThreads\.map\(\(thread, index\) =>/);
  assert.match(filter, /const isSelected = selected\?\.targetId === thread\.targetId/);
  assert.match(source, /<CodexBridgeWatchPanel[\s\S]*?selected=\{selected \? \{/);
  const nextPage = source.match(/\{listMode === 'normal' && nextCursor && \([\s\S]*?次ページ[\s\S]*?\)\}/)?.[0];
  assert.ok(nextPage, 'next-page control remains available');
  assert.match(source, /requestTracker\.current\?\.selectMode\(mode\)/);
  assert.match(source, /requestTracker\.current\?\.selectTarget\(value\)/);
  assert.match(source, /function changeListMode\(mode: CodexBridgeThreadListMode\)/);
  assert.match(source, /onTerminalEvents=\{handleTerminalEvents\}/);
  assert.match(source, /if \(action === 'threads' && context\) void loadThreads\(false, false, context\);[\s\S]*?else if \(action === 'summary' && requestedTargetId && context\) void loadRunningSummary\(requestedTargetId, context\)/);
  assert.match(source, /setThreads\(updated\);[\s\S]*?reportRunningSummary\(\{ targetId: requestedTargetId, count: updated\.length, status: 'ready' \}\)/);
  assert.match(source, /reconcileCodexBridgeThreadSelection\(selectedRef\.current, updated, loadMore\)/);
  assert.match(source, /if \(selectionUpdate\) \{ updateSelected\(selectionUpdate\.thread\); setSelectedMissing\(selectionUpdate\.missing\); \}/);
});

test('未読込・実行中0件・通常ページ0件・要求失敗の案内を区別する', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /!threadsLoaded && <p className="codex-bridge-empty">thread一覧は未読込です。/);
  assert.match(source, /Bridgeが返した実行中threadはありません。/);
  assert.match(source, /この通常一覧ページにthreadはありません。/);
  assert.match(source, /threadsError && <p className="codex-bridge-error" role="alert">/);
});

test('filter stylesheetを既存Shadow DOMのstyle要素へ注入する', async () => {
  const main = await readFile(mainPath, 'utf8');
  assert.match(main, /import codexBridgeThreadFilterStyles from '\.\/codexbridge-thread-filter\.css\?inline'/);
  assert.match(main, /style\.textContent = `\$\{panelStyles\}[\s\S]*?\$\{codexBridgeThreadFilterStyles\}[\s\S]*?\$\{panelPhase6Styles\}`/);
});

test('推定中は推定ラベルを表示し、確定中のstateは実行中と表示する', async () => {
  const [labels, filter] = await Promise.all([
    readFile(labelsPath, 'utf8'), readFile(new URL('../src/content/CodexBridgeProjectFolderFilter.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(filter, /activity === 'estimated' \? '実行中の推定'/);
  assert.match(filter, /className=\{`phase6-thread-state is-\$\{activity\}`\}/);
  assert.match(labels, /value === 'in_progress' \|\| value === 'running'\) return '実行中'/);
});
