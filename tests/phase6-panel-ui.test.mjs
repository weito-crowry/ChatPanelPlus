import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('Phase6ヘッダーは設定操作を維持し、最小化時も3件数を表示する', async () => {
  const [view, summary] = await Promise.all([
    read('../src/content/PanelView.tsx'),
    read('../src/content/BridgeSummaryBar.tsx'),
  ]);
  assert.match(view, /ChatPanelPlus/);
  assert.match(view, /<ProjectPanelTitle\s*\/>/);
  assert.match(view, /<CodexWorkModeToggle/);
  assert.match(view, /<ConversationStatistics/);
  assert.match(view, /onOpenSettings/);
  assert.match(view, /panel-minimize-toggle/);
  assert.match(view, /panel-content" hidden=\{currentViewState\.minimized\}/);
  assert.match(view, /<BridgeSummaryBar[\s\S]*?compact/);
  assert.match(view, /<BridgeSummaryBar compact[\s\S]*?runningSummary=\{runningSummary\}/);
  assert.match(view, /<BridgeSummaryBar conversationId=\{conversationId\}[\s\S]*?runningSummary=\{runningSummary\}/);
  assert.match(summary, /実行中/);
  assert.match(summary, /監視中/);
  assert.match(summary, /通知/);
  assert.match(summary, /runningCount\.value/);
  assert.match(summary, /formatRunningThreadCount\(/);
  assert.match(view, /runningSummary=\{runningSummary\}/);
});

test('A/B/Cカードは既存のowner・ACK・最終回答契約を保つ', async () => {
  const [list, watch, notifications] = await Promise.all([
    read('../src/content/CodexBridgeList.tsx'),
    read('../src/content/CodexBridgeWatchPanel.tsx'),
    read('../src/content/CodexBridgeNotificationCard.tsx'),
  ]);
  assert.match(list, /phase6-bridge-columns/);
  assert.match(list, /phase6-card-a/);
  assert.match(list, /<CodexBridgeWatchPanel[\s\S]*?conversationId=\{conversationId\}/);
  assert.match(list, /CODEX_BRIDGE_MCP_GET_THREADS/);
  assert.doesNotMatch(list, /running_only\s*:/);
  assert.match(list, /runningOnly: true/);
  assert.match(list, /loadRunningSummary\(targetId\)/);
  assert.match(list, /connection !== 'connected' \|\| !targetId/);
  assert.match(watch, /phase6-card-b/);
  assert.match(notifications, /phase6-card-c/);
  assert.match(watch, /CODEX_BRIDGE_WATCH_ACK_EVENTS/);
  assert.match(watch, /CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER/);
  assert.match(watch, /event\.ownerConversationId !== currentConversationId/);
  assert.match(watch, /選択threadの監視を開始/);
  assert.match(watch, /選択threadの監視を解除/);
  assert.match(notifications, /未確認の終了通知を確認/);
  assert.match(notifications, /ChatGPT入力欄へ挿入/);
});

test('新規watch snapshotだけがAの対象connectionを更新し、running行と件数は同じ応答で反映する', async () => {
  const [list, watch, storageListener, additions] = await Promise.all([
    read('../src/content/CodexBridgeList.tsx'), read('../src/content/CodexBridgeWatchPanel.tsx'),
    read('../src/content/codexbridge-watch-storage-listener.ts'),
    read('../src/content/codexbridge-watch-addition-observer.ts'),
  ]);
  assert.match(storageListener, /CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY/);
  assert.match(storageListener, /chrome\.storage\.onChanged\.addListener/);
  assert.match(watch, /collectCodexBridgeWatchAdditionBatch\(/);
  assert.match(additions, /observeSuccessfulSnapshot\(ownerConversationId, connectionId, items\)/);
  assert.match(watch, /onWatchAdditions\?:/);
  assert.match(list, /onWatchAdditions=\{handleWatchAdditions\}/);
  assert.match(list, /observeWatchAdditions\(batch\.additions/);
  assert.match(list, /loadThreads\(false, false, context\)/);
  assert.match(list, /loadRunningSummary\(context\.targetId, context\)/);
  assert.match(list, /reportRunningSummary\(\{ targetId: requestedTargetId, count: updated\.length, status: 'ready' \}\)/);
  assert.doesNotMatch(list, /setInterval\(/);
});

test('Bの名前fallbackは空白を避け、IDをtooltipとkeyboard説明で得られる', async () => {
  const [{ codexBridgeThreadDisplayName }, watchList, folderFilter, presentation, selectedDetails] = await Promise.all([
    import('../src/content/codexbridge-thread-presentation.ts'),
    read('../src/content/CodexBridgeWatchList.tsx'),
    read('../src/content/CodexBridgeProjectFolderFilter.tsx'),
    read('../src/content/codexbridge-thread-presentation.ts'),
    read('../src/content/CodexBridgeSelectedThreadDetails.tsx'),
  ]);
  assert.equal(codexBridgeThreadDisplayName('  タイトル  ', 'thread-1'), 'タイトル');
  assert.equal(codexBridgeThreadDisplayName('  ', 'thread-2'), 'thread-2');
  assert.match(watchList, /title=\{item\.threadId\}/);
  assert.match(watchList, /aria-describedby=\{threadIdDescriptionId\}/);
  assert.match(watchList, /スレッドID：\{item\.threadId\}/);
  assert.match(watchList, /codexBridgeWatchThreadLabel\(threadCandidates, item\.targetId, item\.threadId, true\)/);
  assert.match(folderFilter, /title=\{thread\.id\}/);
  assert.match(folderFilter, /thread\.title\?\.trim\(\) \|\| thread\.preview\?\.trim\(\) \|\| 'タイトル未取得'/);
  assert.match(folderFilter, /aria-describedby=\{idDescription\}/);
  assert.match(folderFilter, /スレッドID：\{thread\.id\}/);
  assert.match(selectedDetails, /phase6-technical-details/);
  assert.match(presentation, /return candidate\.title\?\.trim\(\) \|\| '表示名未取得'/);
  assert.match(watchList, /phase6-technical-details/);
});

test('Phase6 CSSはShadow DOMへ入り、狭幅・ダーク配色・focus表示を定義する', async () => {
  const [styles, main] = await Promise.all([
    read('../src/content/panel-phase6.css'),
    read('../src/content/main.tsx'),
  ]);
  assert.match(main, /panelPhase6Styles from '\.\/panel-phase6\.css\?inline'/);
  assert.match(main, /\$\{panelPhase6Styles\}/);
  assert.match(styles, /@container\s*\(max-width:\s*900px\)/);
  assert.match(styles, /@container\s*\(max-width:\s*640px\)/);
  assert.match(styles, /prefers-color-scheme:\s*dark/);
  assert.match(styles, /:focus-visible/);
  assert.doesNotMatch(styles, /overflow-x:\s*auto/);
});
