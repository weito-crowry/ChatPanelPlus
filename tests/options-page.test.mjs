import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const pagePath = resolve(fileURLToPath(new URL('../options/src/OptionsPage.tsx', import.meta.url)));
const soundSettingsPath = resolve(fileURLToPath(new URL('../options/src/AnswerCompletionSoundSettings.tsx', import.meta.url)));
const creatorPath = resolve(fileURLToPath(new URL('../options/src/CustomButtonCreator.tsx', import.meta.url)));

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
