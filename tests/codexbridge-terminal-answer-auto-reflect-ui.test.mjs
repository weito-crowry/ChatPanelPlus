import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../src/content/', import.meta.url);

test('C欄に会話別ON/OFFと状態を置き、event owner会話を渡す', async () => {
  const [card, watchPanel, control] = await Promise.all([
    readFile(new URL('CodexBridgeNotificationCard.tsx', root), 'utf8'),
    readFile(new URL('CodexBridgeWatchPanel.tsx', root), 'utf8'),
    readFile(new URL('CodexBridgeTerminalAnswerAutoReflectControl.tsx', root), 'utf8'),
  ]);
  assert.match(card, /CodexBridgeTerminalAnswerAutoReflectControl conversationId=\{conversationId\}/);
  assert.match(watchPanel, /CodexBridgeNotificationCard conversationId=\{conversationId\}/);
  assert.match(control, /監視終了時に最終回答を入力欄へ自動反映/);
  assert.match(control, /role="status"/);
  assert.match(control, /autoReflectTerminalAnswer/);
  assert.match(control, /CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER/);
});

test('自動反映はC欄の新規event listenerで動き、最小化時もcomponentをunmountしない', async () => {
  const [control, panel] = await Promise.all([
    readFile(new URL('CodexBridgeTerminalAnswerAutoReflectControl.tsx', root), 'utf8'),
    readFile(new URL('PanelView.tsx', root), 'utf8'),
  ]);
  assert.match(control, /chrome\.runtime\.onMessage\.addListener\(onMessage\)/);
  assert.match(control, /isCodexBridgeTerminalEventSavedMessage\(value\)/);
  assert.match(panel, /<div id="panel-bridge-details" className="panel-bridge-details" hidden=\{!bridgeExpanded\}>[\s\S]*?<CodexBridgeList/);
  assert.match(panel, /<div className="panel-content" hidden=\{currentViewState\.minimized\}>/);
});

test('自動反映は追記adapterだけを使い、送信・Enter・clipboard経路を呼ばない', async () => {
  const [control, pipeline, adapter] = await Promise.all([
    readFile(new URL('CodexBridgeTerminalAnswerAutoReflectControl.tsx', root), 'utf8'),
    readFile(new URL('codexbridge-terminal-answer-auto-reflect.ts', root), 'utf8'),
    readFile(new URL('editor/append-text.ts', root), 'utf8'),
  ]);
  assert.match(control, /appendTextAtEnd\(text, getBrowserEditorEnvironment\(\)\)/);
  assert.match(pipeline, /answer\.completeness !== 'confirmed'/);
  assert.doesNotMatch(control + pipeline + adapter, /insertAtCaret|navigator\.clipboard|\.click\(|key(?:down|up)|send button/i);
  assert.match(control, /送信はしていません/);
});
