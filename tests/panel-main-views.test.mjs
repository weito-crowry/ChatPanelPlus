import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('通常画面はBridgeの計画済み2件数だけを示し、未接続値を0と見せない', async () => {
  const view = await read('../src/content/PanelView.tsx');
  const summary = view.match(/<section className="panel-bridge-summary"[\s\S]*?<\/section>/)?.[0];

  assert.ok(summary, 'Bridge summary region should exist');
  assert.equal([...summary.matchAll(/<dt>/g)].length, 2);
  assert.match(summary, /監視中/);
  assert.match(summary, /監視スレッドが終了した未確認/);
  assert.equal([...summary.matchAll(/aria-label="Phase 4で接続"/g)].length, 2);
  assert.match(summary, /会話別件数はPhase 4で接続します/);
  assert.doesNotMatch(summary, /0件|実行中|要対応|新着/);
});

test('Bridge詳細は既定で閉じ、開閉をARIAに反映し、共有一覧と明示する', async () => {
  const [view, controller] = await Promise.all([
    read('../src/content/PanelView.tsx'),
    read('../src/content/usePanelController.ts'),
  ]);
  assert.match(view, /const \[bridgeExpanded, setBridgeExpanded\] = useState\(false\);/);
  const toggleMarker = view.indexOf('className="codex-bridge-button panel-bridge-details-toggle"');
  const toggleStart = view.lastIndexOf('<button', toggleMarker);
  const toggleEnd = view.indexOf('</button>', toggleMarker);
  assert.ok(toggleMarker >= 0 && toggleStart >= 0 && toggleEnd >= 0, 'Bridge details disclosure should exist');
  const toggle = view.slice(toggleStart, toggleEnd + '</button>'.length);
  assert.match(toggle, /type="button"/);
  assert.match(toggle, /aria-expanded=\{bridgeExpanded\}/);
  assert.match(toggle, /aria-controls="panel-bridge-details"/);
  assert.match(view, /<div id="panel-bridge-details" className="panel-bridge-details" hidden=\{!bridgeExpanded\}>/);
  assert.match(view, /onClick=\{\(\) => setBridgeExpanded\(\(open\) => !open\)\}/);
  assert.match(view, /この一覧は現行の共有表示です。会話別の絞り込みはPhase 4で接続します。/);
  assert.equal([...view.matchAll(/<CodexBridgeList\b/g)].length, 1);
  assert.match(view, /<CodexBridgeList foregroundEnabled=\{!currentViewState\.minimized\} \/>/);
  assert.doesNotMatch(controller, /bridgeExpanded|panel-bridge-details/);
});

test('Bridge詳細の順序はthread一覧、監視登録、終了通知を保つ', async () => {
  const [list, watch] = await Promise.all([
    read('../src/content/CodexBridgeList.tsx'),
    read('../src/content/CodexBridgeWatchPanel.tsx'),
  ]);
  const threadListIndex = list.indexOf('className="codex-bridge-thread-list"');
  const watchPanelIndex = list.indexOf('<CodexBridgeWatchPanel');
  const watchListIndex = watch.indexOf('className="codex-bridge-watch-list"');
  const eventListIndex = watch.indexOf('className="codex-bridge-event-list"');
  assert.ok(threadListIndex >= 0 && threadListIndex < watchPanelIndex);
  assert.ok(watchListIndex >= 0 && watchListIndex < eventListIndex);
  assert.match(watch, /選択threadの監視を開始/);
  assert.match(watch, /選択threadの監視を解除/);
  assert.match(watch, /監視終了イベント一覧/);
});

test('表示ボタンはOptionsで解決した一覧を使い、最小化は既存本文領域を隠す', async () => {
  const view = await read('../src/content/PanelView.tsx');
  assert.match(view, /model\.utilityButtons\.map\(/);
  assert.match(view, /activeButtons\.map\(/);
  assert.doesNotMatch(view, /全文|要約|翻訳|調べて/);
  assert.match(view, /className="panel-content" hidden=\{currentViewState\.minimized\}/);
  assert.match(view, /aria-expanded=\{!currentViewState\.minimized\}/);
});

test('Bridge件数は既存の900pxパネルに合わせ、狭い幅で1列へ折り返す', async () => {
  const [styles, baseStyles, main] = await Promise.all([
    read('../src/content/panel-main-views.css'),
    read('../src/content/panel.css'),
    read('../src/content/main.tsx'),
  ]);
  assert.match(baseStyles, /width:\s*min\(900px,\s*100%\)/);
  assert.match(styles, /\.panel-bridge-summary-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(styles, /@container\s*\(max-width:\s*640px\)[\s\S]*?\.panel-bridge-summary-list\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(main, /import panelMainViewsStyles from '\.\/panel-main-views\.css\?inline'/);
  assert.match(main, /style\.textContent = `\$\{panelStyles\}\\n\$\{panelMainViewsStyles\}\\n\$\{codexBridgeWatchStyles\}`/);
});
