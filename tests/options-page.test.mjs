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
const editorPath = resolve(fileURLToPath(new URL('../options/src/OptionsPanelEditor.tsx', import.meta.url)));

test('Optionsに表示切替・上下並べ替え・ドラフト保存・確認付きimport/reset・exportがある', async () => {
  const [source, editor, soundSettings] = await Promise.all([readFile(pagePath, 'utf8'), readFile(editorPath, 'utf8'), readFile(soundSettingsPath, 'utf8')]);
  for (const behavior of [
    '保存', 'window.confirm', 'この設定をドラフトに適用', 'application/json', 'serializeSettings',
    'AnswerCompletionSoundSettings', 'ProjectFolderPatternsSettings', 'OptionsDataManager',
  ]) assert.ok(source.includes(behavior), `OptionsPage missing ${behavior}`);
  for (const behavior of ['type="checkbox"', '上へ', '下へ', 'type="color"', '<textarea', 'CustomButtonCreator']) {
    assert.ok(editor.includes(behavior), `OptionsPanelEditor missing ${behavior}`);
  }
  assert.ok(soundSettings.includes('回答完了音'));
  assert.ok(source.includes('enabled={draft.answerCompletionSoundEnabled === true}'));
});

test('カスタムボタン作成・操作変更・削除確認・旧JSON保持と削除予定を表示する', async () => {
  const [page, editor, creator] = await Promise.all([readFile(pagePath, 'utf8'), readFile(editorPath, 'utf8'), readFile(creatorPath, 'utf8')]);
  for (const behavior of [
    'window.confirm', 'crypto.randomUUID()', 'changeCustomButtonOperation',
    'このカスタムボタンを削除', '保存後の復元にはJSONバックアップ',
    '保存済みカスタムボタン:', '削除予定ID', 'mergeImportedSettings',
    'resetSettingsPreservingCustomButtons',
  ]) assert.ok(editor.includes(behavior) || page.includes(behavior), `Options V2 editor missing ${behavior}`);
  for (const operation of ['定型文を挿入', '現在時刻を挿入', 'クリップボードを貼り付け', '入力欄をクリア']) {
    assert.ok(creator.includes(operation), `CustomButtonCreator missing ${operation}`);
  }
  assert.ok(creator.includes('取り消す'), 'CustomButtonCreator needs a form cancel action');
});

test('Optionsのcustom tab編集は保存済みIDの表示切替・ラベル・順序・button groupを使う', async () => {
  const [page, editor, state, creator, controls] = await Promise.all([
    readFile(pagePath, 'utf8'),
    readFile(editorPath, 'utf8'),
    readFile(resolve(fileURLToPath(new URL('../options/src/options-state.ts', import.meta.url))), 'utf8'),
    readFile(creatorPath, 'utf8'),
    readFile(tabControlsPath, 'utf8'),
  ]);
  assert.ok(controls.includes("tab.id.startsWith('custom-tab-')"));
  assert.ok(controls.includes('onLabelChange(tab.id as CustomTabId'));
  assert.ok(editor.includes('updateTabVisibility'));
  assert.ok(editor.includes('CustomButtonCreator groupId={group.id}'));
  assert.ok(editor.includes('OptionsTabControls'));
  assert.ok(page.includes('deletedCustomTabCount'));
  assert.ok(state.includes('function updateCustomTabLabel'));
  assert.ok(state.includes('function updateTabVisibility'));
  assert.ok(creator.includes('const common = { groupId, label, color, visible: true }'));
  assert.ok(!page.includes('このカスタムタブを削除') && !controls.includes('このカスタムタブを削除'), 'custom tab deletion UI must remain out of scope');
});

test('Options V2 keeps section contents mounted and provides accessible hash navigation', async () => {
  const [page, navigation, stylesheet] = await Promise.all([
    readFile(pagePath, 'utf8'),
    readFile(resolve(fileURLToPath(new URL('../options/src/OptionsNavigation.tsx', import.meta.url))), 'utf8'),
    readFile(resolve(fileURLToPath(new URL('../options/src/options-v2.css', import.meta.url))), 'utf8'),
  ]);
  for (const id of ['panel', 'connection', 'projects', 'audio', 'data']) assert.ok(page.includes(`id="${id}"`));
  assert.ok(page.includes('hidden={section !=='));
  assert.ok(page.includes('ProjectFolderPatternsSettings') && page.includes('McpConnectionSettings'));
  assert.ok(navigation.includes('aria-label="目次"') && navigation.includes('aria-current'));
  assert.ok(navigation.includes('event.preventDefault()') && navigation.includes('onNavigate(id)'));
  assert.ok(stylesheet.includes('.options-section[hidden]') && stylesheet.includes('max-width: 720px'));
});

test('saved-data manager only requests known keys and never renders session token or audio payload', async () => {
  const [manager, model, refreshState] = await Promise.all([
    readFile(resolve(fileURLToPath(new URL('../options/src/OptionsDataManager.tsx', import.meta.url))), 'utf8'),
    readFile(resolve(fileURLToPath(new URL('../options/src/saved-data-manager.ts', import.meta.url))), 'utf8'),
    readFile(resolve(fileURLToPath(new URL('../options/src/saved-data-refresh-state.ts', import.meta.url))), 'utf8'),
  ]);
  assert.ok(manager.includes('chrome.storage.local.get([...KNOWN_LOCAL_DATA_KEYS])'));
  assert.ok(manager.includes('chrome.storage.session.get([CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY])'));
  assert.ok(!manager.includes('chrome.storage.local.get(null)'));
  assert.ok(!manager.includes('chrome.storage.local.clear') && !manager.includes('chrome.storage.local.remove'));
  assert.ok(!manager.includes('chrome.storage.session.set') && !manager.includes('chrome.storage.session.remove'));
  assert.ok(model.includes('KNOWN_LOCAL_DATA_KEYS') && model.includes('sizeBytes'));
  assert.ok(!model.includes('asset.data'));
  assert.ok(model.includes('getOldEventCandidates'));
  assert.ok(manager.includes('window.confirm') && manager.includes('deleteConversationState') && manager.includes('deleteProjectPatterns'));
  assert.ok(manager.includes('if (!approved || !isSavedDataDeletionAllowed(refreshStateRef.current)) return;'));
  assert.ok(manager.includes('finishSavedDataRefresh') && manager.includes('isSavedDataDeletionAllowed'));
  assert.ok(manager.includes('deletionSnapshots.current = EMPTY_DELETE_SNAPSHOTS'));
  assert.ok(manager.includes('setSelected(new Set()); setPreview(null)'));
  assert.ok(refreshState.includes("'superseded' | 'failed' | 'fresh' | 'changed-during-read'"));
});

test('MCP接続確認はホスト権限を明示要求し、tokenをsession storageに閉じ込める', async () => {
  const [page, connection] = await Promise.all([readFile(pagePath, 'utf8'), readFile(mcpSettingsPath, 'utf8')]);
  assert.ok(page.includes('McpConnectionSettings'));
  for (const behavior of [
    'type="url"', 'type="password"', 'chrome.storage.session.set',
    'chrome.storage.session.remove', 'chrome.permissions.request(permissions)',
    'CODEX_BRIDGE_MCP_TEST_MESSAGE', '接続確認', 'codex_targets',
  ]) assert.ok(connection.includes(behavior), `MCP connection settings missing ${behavior}`);
  assert.ok(!connection.includes('chrome.storage.local'));
  assert.ok(!connection.includes('console.'));
  assert.ok(connection.includes('endpoint: parsed.url'));
  assert.ok(!connection.includes('endpoint: token'));
});

test('MCP Optionsはホスト権限とLNAを分けて表示し、明示クリック時だけローカルprobeを送る', async () => {
  const [connection, networkAccess, protocol] = await Promise.all([
    readFile(mcpSettingsPath, 'utf8'),
    readFile(resolve(fileURLToPath(new URL('../options/src/mcp-network-access.ts', import.meta.url))), 'utf8'),
    readFile(resolve(fileURLToPath(new URL('../src/shared/codexbridge-mcp-protocol.ts', import.meta.url))), 'utf8'),
  ]);
  assert.ok(connection.includes('chrome.permissions.contains'));
  assert.ok(connection.includes('navigator.permissions.query'));
  assert.ok(connection.includes('Chromeのサイト設定で許可を変更してください'));
  assert.ok(connection.includes('API非対応または状態を確認できません'));
  assert.ok(connection.includes('HTTP応答の読み取り中に通信が中断しました'));
  assert.ok(connection.includes('Service Workerから接続確認応答を受け取れませんでした'));
  assert.ok(connection.includes('listener登録、Optionsの拡張context'));
  assert.ok(connection.includes('原因はこの結果だけでは特定できません'));
  assert.ok(!connection.includes('サーバーの起動状態を確認してください'));
  assert.ok(networkAccess.includes('loopback-network'));
  assert.ok(networkAccess.includes('local-network'));
  assert.ok(connection.includes('ローカル接続を確認'));
  assert.ok(connection.includes('probeVerifiedEndpoint !== parsed.url'));
  assert.ok(connection.includes('MCP要求はまだ送信していません'));
  assert.ok(connection.includes('probeMcpLocalNetwork'));
  assert.ok(connection.includes('(permissions) => chrome.permissions.request(permissions)'));
  assert.ok(networkAccess.includes("'/__cpp_lna_probe__'"));
  assert.ok(networkAccess.includes("credentials: 'omit'"));
  assert.ok(networkAccess.includes("cache: 'no-store'"));
  assert.ok(networkAccess.includes("mode: 'cors'"));
  assert.ok(!connection.includes('console.'));
  assert.ok(!connection.includes('navigator.permissions.request'));
  assert.ok(!connection.includes('chrome.permissions.request') || connection.includes('onClick={() => void testConnection()}'));
  assert.ok(!protocol.includes('local-network-access'));
});
