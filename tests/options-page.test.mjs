import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const pagePath = resolve(fileURLToPath(new URL('../options/src/OptionsPage.tsx', import.meta.url)));
const soundSettingsPath = resolve(fileURLToPath(new URL('../options/src/AnswerCompletionSoundSettings.tsx', import.meta.url)));
const mcpSettingsPath = resolve(fileURLToPath(new URL('../options/src/McpConnectionSettings.tsx', import.meta.url)));
const creatorPath = resolve(fileURLToPath(new URL('../options/src/CustomButtonCreator.tsx', import.meta.url)));
const tabControlsPath = resolve(fileURLToPath(new URL('../options/src/OptionsTabControls.tsx', import.meta.url)));

test('Optionsに表示切替・上下並べ替え・ドラフト保存・確認付きimport/reset・exportがある', async () => {
  const [source, soundSettings] = await Promise.all([readFile(pagePath, 'utf8'), readFile(soundSettingsPath, 'utf8')]);
  for (const behavior of [
    'type="checkbox"', '上へ', '下へ', '保存', 'window.confirm',
    'この設定をドラフトに適用', 'application/json', 'serializeSettings',
    'type="color"', '<textarea', 'AnswerCompletionSoundSettings',
  ]) assert.ok(source.includes(behavior), `OptionsPage missing ${behavior}`);
  assert.ok(soundSettings.includes('回答完了音'));
  assert.ok(source.includes('enabled={draft.answerCompletionSoundEnabled === true}'));
});

test('カスタムボタン作成・操作変更・削除確認・旧JSON保持と削除予定を表示する', async () => {
  const [page, creator] = await Promise.all([readFile(pagePath, 'utf8'), readFile(creatorPath, 'utf8')]);
  for (const behavior of [
    'CustomButtonCreator', 'crypto.randomUUID()', 'changeCustomButtonOperation',
    'このカスタムボタンを削除', '保存後の復元にはJSONバックアップ',
    '保存済みカスタムボタン:', '削除予定ID', 'mergeImportedSettings',
    'resetSettingsPreservingCustomButtons',
  ]) assert.ok(page.includes(behavior), `OptionsPage missing ${behavior}`);
  for (const operation of ['定型文を挿入', '現在時刻を挿入', 'クリップボードを貼り付け', '入力欄をクリア']) {
    assert.ok(creator.includes(operation), `CustomButtonCreator missing ${operation}`);
  }
  assert.ok(creator.includes('取り消す'), 'CustomButtonCreator needs a form cancel action');
});

test('Optionsのcustom tab編集は保存済みIDの表示切替・ラベル・順序・button groupを使う', async () => {
  const [page, state, creator, controls] = await Promise.all([
    readFile(pagePath, 'utf8'),
    readFile(resolve(fileURLToPath(new URL('../options/src/options-state.ts', import.meta.url))), 'utf8'),
    readFile(creatorPath, 'utf8'),
    readFile(tabControlsPath, 'utf8'),
  ]);
  assert.ok(controls.includes("tab.id.startsWith('custom-tab-')"));
  assert.ok(controls.includes('onLabelChange(tab.id as CustomTabId'));
  assert.ok(page.includes('updateTabVisibility'));
  assert.ok(page.includes('CustomButtonCreator groupId={group.id}'));
  assert.ok(page.includes('OptionsTabControls'));
  assert.ok(page.includes('deletedCustomTabCount'));
  assert.ok(state.includes('function updateCustomTabLabel'));
  assert.ok(state.includes('function updateTabVisibility'));
  assert.ok(creator.includes('const common = { groupId, label, color, visible: true }'));
  assert.ok(!page.includes('このカスタムタブを削除') && !controls.includes('このカスタムタブを削除'), 'custom tab deletion UI must remain out of scope');
});

test('MCP接続確認はホスト権限を明示要求し、tokenをsession storageに閉じ込める', async () => {
  const [page, connection] = await Promise.all([readFile(pagePath, 'utf8'), readFile(mcpSettingsPath, 'utf8')]);
  assert.ok(page.includes('McpConnectionSettings'));
  for (const behavior of [
    'type="url"', 'type="password"', 'chrome.storage.session.set',
    'chrome.storage.session.remove', 'chrome.permissions.request({ origins: [parsed.originPattern] })',
    'CODEX_BRIDGE_MCP_TEST_MESSAGE', '接続確認', 'codex_targets',
  ]) assert.ok(connection.includes(behavior), `MCP connection settings missing ${behavior}`);
  assert.ok(!connection.includes('chrome.storage.local'));
  assert.ok(!connection.includes('console.'));
  assert.ok(connection.includes('endpoint: parsed.url'));
  assert.ok(!connection.includes('endpoint: token'));
});
