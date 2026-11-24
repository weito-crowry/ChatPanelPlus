import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as presentation from '../src/content/codexbridge-watch-presentation.ts';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const countCurrentOwnerTargetWatches = presentation.countCurrentOwnerTargetWatches;

const items = [
  { ownerConversationId: 'conversation-a', connectionId: 'connection-a', targetId: 'target-a' },
  { ownerConversationId: 'conversation-a', connectionId: 'connection-a', targetId: 'target-a' },
  { ownerConversationId: 'conversation-a', connectionId: 'connection-a', targetId: 'target-b' },
  { ownerConversationId: 'conversation-a', connectionId: 'connection-b', targetId: 'target-a' },
  { ownerConversationId: 'conversation-b', connectionId: 'connection-a', targetId: 'target-a' },
];

test('current watch count is scoped to the exact owner, connection, and target', () => {
  assert.equal(typeof countCurrentOwnerTargetWatches, 'function');
  const current = {
    items,
    ownerConversationId: 'conversation-a',
    connectionId: 'connection-a',
    targetId: 'target-a',
    snapshotIsCurrent: true,
    listFailure: false,
  };
  assert.equal(countCurrentOwnerTargetWatches(current), 2);
  assert.equal(countCurrentOwnerTargetWatches({ ...current, targetId: 'target-b' }), 1);
  assert.equal(countCurrentOwnerTargetWatches({ ...current, connectionId: 'connection-b' }), 1);
  assert.equal(countCurrentOwnerTargetWatches({ ...current, ownerConversationId: 'conversation-b' }), 1);
});

test('current watch count is unknown until the owner list and identity are available', () => {
  assert.equal(typeof countCurrentOwnerTargetWatches, 'function');
  const current = {
    items,
    ownerConversationId: 'conversation-a',
    connectionId: 'connection-a',
    targetId: 'target-a',
    snapshotIsCurrent: true,
    listFailure: false,
  };
  for (const incomplete of [
    { ...current, snapshotIsCurrent: false },
    { ...current, listFailure: true },
    { ...current, ownerConversationId: null },
    { ...current, connectionId: null },
    { ...current, targetId: null },
  ]) {
    assert.equal(countCurrentOwnerTargetWatches(incomplete), null);
  }
});

test('B passes its current watch snapshot count to the auto-watch setting', async () => {
  const [panel, control] = await Promise.all([
    read('../src/content/CodexBridgeWatchPanel.tsx'),
    read('../src/content/CodexBridgeAutoWatchControl.tsx'),
  ]);
  assert.match(panel, /countCurrentOwnerTargetWatches\(\{[\s\S]*?items: currentItems,[\s\S]*?ownerConversationId: conversationId,[\s\S]*?connectionId: currentConnectionId,[\s\S]*?targetId: target\?\.id \?\? null,[\s\S]*?snapshotIsCurrent: listIsCurrent,[\s\S]*?listFailure: listFailure !== null/);
  assert.match(panel, /conversationId=\{conversationId\} watchingThreadCount=\{autoWatchCount\}/);
  assert.match(control, /watchingThreadCount: number \| null/);
  assert.match(control, /watchingThreadCount === null \? '未確認'/);
  assert.doesNotMatch(control, /currentStatus\.watchingThreadCount/);
});

test('auto-watch clearly names conversation-wide ON/OFF and retries recovery or startup failures', async () => {
  const [control, presentation] = await Promise.all([
    read('../src/content/CodexBridgeAutoWatchControl.tsx'),
    read('../src/content/codexbridge-auto-watch-presentation.ts'),
  ]);
  assert.match(control, /この会話全体の自動登録をOFF/);
  assert.match(control, /この会話全体の自動登録をON/);
  assert.match(control, /owner再確認中・自動復帰待ち/);
  assert.match(control, /next\?\.state === 'recovering' \|\| retryableFailure/);
  assert.match(presentation, /同じ会話の別タブが自動登録を所有中です。このtabは処理しません。/);
  assert.match(presentation, /ownerの応答を確認中です。状態を再確認します。/);
});
