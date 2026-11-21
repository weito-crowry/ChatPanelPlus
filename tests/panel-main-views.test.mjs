import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('通常画面は現在会話のBridge2件数だけを示し、未取得を0と見せない', async () => {
  const view = await read('../src/content/PanelView.tsx');
  const summary = view.match(/<section className="panel-bridge-summary"[\s\S]*?<\/section>/)?.[0];

  assert.ok(summary, 'Bridge summary region should exist');
  assert.equal([...summary.matchAll(/<dt>/g)].length, 2);
  assert.match(summary, /監視中/);
  assert.match(summary, /監視スレッドが終了した未確認/);
  assert.match(summary, /currentBridgeSummary\?\.watchingCount \?\? '—'/);
  assert.match(summary, /currentBridgeSummary\?\.unacknowledgedThreadCount \?\? '—'/);
  assert.match(summary, /この会話の監視件数/);
  assert.match(summary, /この会話の未確認終了件数/);
  assert.doesNotMatch(summary, /0件|実行中|要対応|新着/);
});

test('Bridge詳細は会話stateで開閉し、ARIA・owner filter・route raceを保つ', async () => {
  const [view, controller, stateHook] = await Promise.all([
    read('../src/content/PanelView.tsx'),
    read('../src/content/usePanelController.ts'),
    read('../src/content/useConversationPanelState.ts'),
  ]);
  assert.match(view, /bridgeExpanded,/);
  const toggleMarker = view.indexOf('className="codex-bridge-button panel-bridge-details-toggle"');
  const toggleStart = view.lastIndexOf('<button', toggleMarker);
  const toggleEnd = view.indexOf('</button>', toggleMarker);
  assert.ok(toggleMarker >= 0 && toggleStart >= 0 && toggleEnd >= 0, 'Bridge details disclosure should exist');
  const toggle = view.slice(toggleStart, toggleEnd + '</button>'.length);
  assert.match(toggle, /type="button"/);
  assert.match(toggle, /aria-expanded=\{bridgeExpanded\}/);
  assert.match(toggle, /aria-controls="panel-bridge-details"/);
  assert.match(view, /<div id="panel-bridge-details" className="panel-bridge-details" hidden=\{!bridgeExpanded\}>/);
  assert.match(view, /onClick=\{onToggleBridgeExpanded\}/);
  assert.equal([...view.matchAll(/<CodexBridgeList\b/g)].length, 1);
  assert.match(view, /<CodexBridgeList[\s\S]*?foregroundEnabled=\{!currentViewState\.minimized\}[\s\S]*?conversationId=\{conversationId\}[\s\S]*?bridgeWatchSelection=\{bridgeWatchSelection\}[\s\S]*?bridgeEventSelection=\{bridgeEventSelection\}[\s\S]*?onSelectBridgeWatch=\{onSelectBridgeWatch\}[\s\S]*?onSelectBridgeEvent=\{onSelectBridgeEvent\}[\s\S]*?onSummaryChange=\{updateBridgeSummary\}[\s\S]*?\/>/);
  assert.match(controller, /useConversationPanelState\(model\.tabs\)/);
  assert.match(controller, /bridgeExpanded: conversationPanel\.bridgeExpanded/);
  assert.doesNotMatch(controller, /loadViewState\(|saveViewState\(/);
  assert.match(stateHook, /conversationIdFromPath\(window\.location\.pathname\) !== id/);
  assert.match(stateHook, /routeGeneration\.current !== generation/);
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
  assert.match(watch, /未確認の終了通知を確認/);
  assert.match(watch, /event\.ownerConversationId !== currentConversationId/);
  assert.match(watch, /conversationIdFromPath\(window\.location\.pathname\) !== conversationId/);
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
  assert.match(main, /style\.textContent = `\$\{panelStyles\}\\n\$\{panelMainViewsStyles\}\\n\$\{codexBridgeWatchStyles\}\\n\$\{codexBridgeThreadFilterStyles\}`/);
});
