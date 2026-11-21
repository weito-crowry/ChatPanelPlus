import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourcePath = fileURLToPath(new URL('../src/content/CodexBridgeWatchPanel.tsx', import.meta.url));
const stylePath = fileURLToPath(new URL('../src/content/codexbridge-watch.css', import.meta.url));
const presentationPath = fileURLToPath(new URL('../src/content/codexbridge-watch-presentation.ts', import.meta.url));

test('watch UI selects terminal events and fetches only after an explicit click', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /終了イベント/);
  assert.match(source, /最終回答を取得/);
  assert.match(source, /onClick=\{\(\) => \{ void fetchSelectedAnswer\(\); \}\}/);
  assert.match(source, /type: CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER,[\s\S]*?eventId: event\.eventId/);
  assert.match(source, /event\.connectionId !== currentConnectionId/);
  assert.match(source, /answerGeneration\.current/);
});

test('copy and insertion are independent user actions and the answer is rendered as text', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /onClick=\{\(\) => \{ void copyAnswer\(selectedEvent, displayedAnswer\.text\); \}\}/);
  assert.match(source, /onClick=\{\(\) => insertAnswer\(selectedEvent, displayedAnswer\.text\)\}/);
  assert.match(source, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(source, /insertAtCaret\(text, environment, snapshot\)/);
  assert.match(source, /<pre className="codex-bridge-answer-text">\{displayedAnswer\.text\}<\/pre>/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(source, /CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER[\s\S]{0,300}CODEX_BRIDGE_MCP_GET_STATUS/);
});

test('conversation owner is required for watch data, final-answer actions, and ACK; raw shared storage is never rendered', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /conversationIdFromPath\(window\.location\.pathname\) !== requestConversationId/);
  assert.match(source, /conversationIdFromPath\(window\.location\.pathname\) !== event\.ownerConversationId/);
  assert.match(source, /type: CODEX_BRIDGE_WATCH_ACK_EVENTS,[\s\S]*?conversationId: currentConversationId,[\s\S]*?eventIds/);
  assert.match(source, /filterOwnedWatchData\(data, ownerConversationId\)/);
  assert.match(source, /summaryCallbackRef\.current\?\.\(owned\.summary\)/);
  assert.doesNotMatch(source, /acceptStoredItems|setEvents\(.*newValue/);
});

test('ACK snapshots visible IDs and uses bounded serial batches with a partial-failure result', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /acknowledgeCodexBridgeEventIds\(/);
  assert.match(source, /confirmedCount/);
  assert.match(source, /未確認分は再試行できます/);
});

test('watch and event selection are conversation-owned persisted props and only owner items can select', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /bridgeWatchSelection: ConversationPanelWatchSelection \| null/);
  assert.match(source, /bridgeEventSelection: string \| null/);
  assert.match(source, /item\.ownerConversationId !== ownerConversationId/);
  assert.match(source, /event\.ownerConversationId === conversationId/);
  assert.match(source, /onSelectBridgeWatch/);
  assert.match(source, /onSelectBridgeEvent/);
});

test('retrieved body completeness is labeled and Markdown whitespace remains visible', async () => {
  const [source, styles, presentation] = await Promise.all([
    readFile(sourcePath, 'utf8'), readFile(stylePath, 'utf8'), readFile(presentationPath, 'utf8'),
  ]);
  assert.match(presentation, /完全性は未確認です/);
  assert.match(source, /Bridge応答には切詰め情報がない/);
  assert.match(styles, /\.codex-bridge-answer-text[^{]*\{[^}]*white-space:\s*pre-wrap/s);
});
