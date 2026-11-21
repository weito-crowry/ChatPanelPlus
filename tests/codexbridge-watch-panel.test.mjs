import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourcePath = fileURLToPath(new URL('../src/content/CodexBridgeWatchPanel.tsx', import.meta.url));
const stylePath = fileURLToPath(new URL('../src/content/codexbridge-watch.css', import.meta.url));

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
  assert.match(source, /summaryCallbackRef\.current\?\.\(data\.summary\)/);
  assert.doesNotMatch(source, /acceptStoredItems|setEvents\(.*newValue/);
});

test('retrieved body completeness is labeled and Markdown whitespace remains visible', async () => {
  const [source, styles] = await Promise.all([readFile(sourcePath, 'utf8'), readFile(stylePath, 'utf8')]);
  assert.match(source, /完全性は未確認です/);
  assert.match(source, /Bridge応答には切詰め情報がない/);
  assert.match(styles, /\.codex-bridge-answer-text[^{]*\{[^}]*white-space:\s*pre-wrap/s);
});
