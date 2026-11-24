import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('OptionsにprojectId別のフォルダパターン設定が独立セクションで追加される', async () => {
  const [page, component, repository] = await Promise.all([
    read('../options/src/OptionsPage.tsx'),
    read('../options/src/ProjectFolderPatternsSettings.tsx'),
    read('../src/shared/project-folder-patterns.ts'),
  ]);
  assert.match(page, /<ProjectFolderPatternsSettings\s*\/>/);
  assert.match(component, /createChromeProjectNamesRepository/);
  assert.match(component, /createChromeProjectFolderPatternsRepository/);
  assert.match(component, /projectId/);
  assert.match(component, /名称未記録/);
  assert.match(repository, /PROJECT_FOLDER_PATTERNS_STORAGE_KEY/);
  assert.match(repository, /chatPanelPlus\.projectFolderPatterns\.v1/);
  assert.doesNotMatch(component, /serializeSettings|parseSettingsJson/);
});

test('プロジェクトごとに複数パターンを追加・編集・削除・保存し、競合時は再読込を案内する', async () => {
  const component = await read('../options/src/ProjectFolderPatternsSettings.tsx');
  assert.match(component, /パターンを追加/);
  assert.match(component, /パターンを削除/);
  assert.match(component, /savePatterns\(/);
  assert.match(component, /conflict/);
  assert.match(component, /保存値を再読み込み/);
  assert.match(component, /navigator\.locks|external|同じプロジェクト/);
  assert.match(component, /D:\\Projects/);
});

test('Optionsの既存JSON import/exportとカスタムボタン設定契約は残る', async () => {
  const [page, editor] = await Promise.all([
    read('../options/src/OptionsPage.tsx'),
    read('../options/src/OptionsPanelEditor.tsx'),
  ]);
  assert.match(page, /validateExtensionSettings\(draft\)/);
  assert.match(page, /serializeSettings\(validated\.settings\)/);
  assert.match(page, /parseSettingsJson\(json\)/);
  assert.match(editor, /CustomButtonCreator/);
});
