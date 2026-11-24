import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('3 counters share summary snapshots in normal and compact bars; hover adds no Bridge request', async () => {
  const [bar, counter, panel, list, watch, acknowledger] = await Promise.all([
    read('../src/content/BridgeSummaryBar.tsx'), read('../src/content/BridgeSummaryCounter.tsx'),
    read('../src/content/PanelView.tsx'), read('../src/content/CodexBridgeList.tsx'),
    read('../src/content/CodexBridgeWatchPanel.tsx'), read('../src/content/useCodexBridgeEventAcknowledger.ts'),
  ]);
  assert.equal([...bar.matchAll(/<BridgeSummaryCounter\b/g)].length, 3);
  assert.match(panel, /<BridgeSummaryBar compact[\s\S]*?watchSummary=\{currentBridgeSummary\}/);
  assert.match(panel, /<BridgeSummaryBar conversationId=\{routeConversationId\}[\s\S]*?watchSummary=\{currentBridgeSummary\}/);
  assert.match(panel, /onAcknowledgeEvents=\{acknowledgeEvents \?\? undefined\}/);
  assert.match(list, /onAcknowledgeEvents=\{onAcknowledgeEvents\}/);
  assert.match(watch, /onAcknowledgeEvents\s*,?\s*\}\s*\)/);
  assert.match(acknowledger, /onAcknowledgeEvents\?\.\(handler\)/);
  assert.doesNotMatch(counter, /chrome\.runtime\.sendMessage|CODEX_BRIDGE_MCP_GET_THREADS|CODEX_BRIDGE_WATCH_LIST/);
  assert.match(counter, /HOVER_OPEN_DELAY_MS\s*=\s*200/);
  assert.match(counter, /onFocus/);
  assert.match(counter, /onPointerEnter/);
  assert.match(counter, /Escape/);
  assert.match(counter, /function handlePointerLeave\(\) \{ scheduleClose\(\); \}/);
  assert.match(counter, /createPortal/);
  assert.doesNotMatch(bar, /title=\{/);
});

test('通知counterは0・loading・operation中に無効、detailとcounterはowner-scoped snapshot由来', async () => {
  const [bar, watch, summary, presentation, card, acknowledger] = await Promise.all([
    read('../src/content/BridgeSummaryBar.tsx'), read('../src/content/CodexBridgeWatchPanel.tsx'),
    read('../src/content/codexbridge-watch-summary.ts'), read('../src/content/codexbridge-watch-presentation.ts'),
    read('../src/content/CodexBridgeNotificationCard.tsx'),
    read('../src/content/useCodexBridgeEventAcknowledger.ts'),
  ]);
  assert.match(bar, /currentSummary\?\.status === 'ready'/);
  assert.match(bar, /unacknowledgedThreadCount === 0/);
  assert.match(bar, /operationBusy/);
  assert.match(bar, /currentSummary\?\.error && <p className="phase6-bridge-ack-error" role="alert">/);
  assert.match(watch, /acknowledgeVisibleEvents/);
  assert.match(watch, /onAcknowledgeEvents/);
  assert.match(acknowledger, /CODEX_BRIDGE_WATCH_ACK_EVENTS/);
  assert.match(watch, /CODEX_BRIDGE_WATCH_CLEAR_EVENTS/);
  assert.match(watch, /CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER/);
  assert.match(presentation, /groupUnacknowledgedCodexBridgeEvents/);
  assert.match(summary, /input\.listConversationId !== conversationId/);
  assert.match(card, /onAcknowledge/);
  assert.match(card, /onClear/);
});

test('popoverはviewport内固定配置・内部scrollを使いShadow DOMのoverflowを越える', async () => {
  const [counter, styles, view] = await Promise.all([
    read('../src/content/BridgeSummaryCounter.tsx'), read('../src/content/panel-phase6.css'),
    read('../src/content/PanelView.tsx'),
  ]);
  assert.match(counter, /calculateBridgeSummaryPopoverPlacement/);
  assert.match(counter, /getRootNode\(\)/);
  assert.match(styles, /\.phase6-counter-popover\s*\{[^}]*position:\s*fixed/s);
  assert.match(styles, /\.phase6-counter-popover-body\s*\{[^}]*overflow:\s*auto/s);
  assert.match(styles, /max-height:\s*min\(360px,\s*calc\(100dvh\s*-\s*24px\)\)/);
  assert.match(view, /foregroundEnabled=\{!currentViewState\.minimized\}/);
  assert.match(view, /hidden=\{!bridgeExpanded\}/);
});

test('Codex通知●の状態更新は既存TabCompletionIndicatorに集約し回答未読挙動を残す', async () => {
  const [stats, indicator, panel] = await Promise.all([
    read('../src/content/ConversationStatistics.tsx'), read('../src/content/tab-completion-indicator.ts'),
    read('../src/content/PanelView.tsx'),
  ]);
  assert.match(panel, /codexUnreadCount/);
  assert.match(stats, /setCodexUnreadNotifications\(/);
  assert.match(indicator, /answerUnread/);
  assert.match(indicator, /codexUnread/);
  assert.match(indicator, /answerUnread \|\| this\.codexUnread/);
  assert.match(indicator, /onVisibilityChange[\s\S]*?clearAnswerUnreadState/);
  assert.match(indicator, /if \(this\.answerUnread\) this\.ensureAttentionIcon/);
});
