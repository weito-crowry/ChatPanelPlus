import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('Bridgeバーは実行中・監視中・通知の3項目を示し、未取得を0と見せない', async () => {
  const view = await read('../src/content/PanelView.tsx');
  const summary = await read('../src/content/BridgeSummaryBar.tsx');

  assert.ok(summary, 'Bridge summary region should exist');
  assert.equal([...summary.matchAll(/<dt>/g)].length, 3);
  assert.match(summary, /実行中/);
  assert.match(summary, /監視中/);
  assert.match(summary, /通知/);
  assert.match(summary, /runningCount\.value/);
  assert.match(summary, /watchingCount \?\? '—'/);
  assert.match(summary, /unacknowledgedThreadCount \?\? '—'/);
  assert.match(summary, /この会話の監視件数/);
  assert.match(summary, /この会話の未確認終了件数/);
  assert.match(summary, /formatRunningThreadCount\(/);
  assert.doesNotMatch(summary, /0件|要対応|新着/);
  assert.match(view, /<BridgeSummaryBar[\s\S]*?compact/);
});

test('Bridge詳細は会話stateで開閉し、ARIA・owner filter・route raceを保つ', async () => {
  const [view, summary, controller, stateHook] = await Promise.all([
    read('../src/content/PanelView.tsx'),
    read('../src/content/BridgeSummaryBar.tsx'),
    read('../src/content/usePanelController.ts'),
    read('../src/content/useConversationPanelState.ts'),
  ]);
  assert.match(view, /bridgeExpanded,/);
  const toggleMarker = summary.indexOf('className="phase6-details-toggle"');
  const toggleStart = summary.lastIndexOf('<button', toggleMarker);
  const toggleEnd = summary.indexOf('</button>', toggleMarker);
  assert.ok(toggleMarker >= 0 && toggleStart >= 0 && toggleEnd >= 0, 'Bridge details disclosure should exist');
  const toggle = summary.slice(toggleStart, toggleEnd + '</button>'.length);
  assert.match(toggle, /type="button"/);
  assert.match(toggle, /aria-expanded=\{expanded\}/);
  assert.match(toggle, /aria-controls="panel-bridge-details"/);
  assert.match(view, /<div id="panel-bridge-details" className="panel-bridge-details" hidden=\{!bridgeExpanded\}>/);
  assert.match(summary, /onClick=\{onToggle\}/);
  assert.equal([...view.matchAll(/<CodexBridgeList\b/g)].length, 1);
  assert.match(view, /<CodexBridgeList[\s\S]*?foregroundEnabled=\{!currentViewState\.minimized\}[\s\S]*?conversationId=\{conversationId\}[\s\S]*?bridgeWatchSelection=\{bridgeWatchSelection\}[\s\S]*?bridgeEventSelection=\{bridgeEventSelection\}[\s\S]*?onSelectBridgeWatch=\{onSelectBridgeWatch\}[\s\S]*?onSelectBridgeEvent=\{onSelectBridgeEvent\}[\s\S]*?onSummaryChange=\{updateBridgeSummary\}[\s\S]*?onConnectionChange=\{updateBridgeConnection\}[\s\S]*?onRunningSummaryChange=\{updateRunningSummary\}[\s\S]*?\/>/);
  assert.match(controller, /useConversationPanelState\(model\.tabs\)/);
  assert.match(controller, /bridgeExpanded: conversationPanel\.bridgeExpanded/);
  assert.doesNotMatch(controller, /loadViewState\(|saveViewState\(/);
  assert.match(stateHook, /conversationIdFromPath\(window\.location\.pathname\) !== id/);
  assert.match(stateHook, /routeGeneration\.current !== generation/);
});

test('Bridge詳細の順序はthread一覧、監視登録、終了通知を保つ', async () => {
  const [list, filter, watch, notifications] = await Promise.all([
    read('../src/content/CodexBridgeList.tsx'),
    read('../src/content/CodexBridgeProjectFolderFilter.tsx'),
    read('../src/content/CodexBridgeWatchPanel.tsx'),
    read('../src/content/CodexBridgeNotificationCard.tsx'),
  ]);
  const threadListIndex = filter.indexOf('className="codex-bridge-thread-list"');
  const filterIndex = list.indexOf('<CodexBridgeProjectFolderFilter');
  const watchPanelIndex = list.indexOf('<CodexBridgeWatchPanel');
  const watchListIndex = watch.indexOf('className="codex-bridge-watch-list"');
  assert.ok(filterIndex >= 0 && filterIndex < watchPanelIndex);
  assert.ok(threadListIndex >= 0);
  assert.ok(watchListIndex >= 0);
  assert.ok(notifications.indexOf('className="codex-bridge-event-list"') >= 0);
  assert.match(watch, /選択threadの監視を開始/);
  assert.match(watch, /選択threadの監視を解除/);
  assert.match(notifications, /監視終了イベント一覧/);
  assert.match(notifications, /未確認の終了通知を確認/);
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

test('Bridgeバーの3件数と詳細カードはShadow DOM内で幅に応じて折り返す', async () => {
  const [styles, baseStyles, main] = await Promise.all([
    read('../src/content/panel-phase6.css'),
    read('../src/content/panel.css'),
    read('../src/content/main.tsx'),
  ]);
  assert.match(baseStyles, /container-type:\s*inline-size/);
  assert.match(styles, /\.phase6-bridge-counters\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(styles, /\.phase6-bridge-columns\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(styles, /@container\s*\(max-width:\s*900px\)[\s\S]*?\.phase6-bridge-columns\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(styles, /@container\s*\(max-width:\s*640px\)[\s\S]*?\.phase6-bridge-columns\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(main, /import panelPhase6Styles from '\.\/panel-phase6\.css\?inline'/);
  assert.match(main, /\$\{panelPhase6Styles\}/);
});
