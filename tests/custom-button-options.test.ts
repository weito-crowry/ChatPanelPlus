import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changeCustomButtonOperation,
  createCustomButton,
  deleteCustomButton,
  getCustomButtonImportDeletions,
  getCustomTabImportDeletions,
  mergeImportedSettings,
  reorderButtonBefore,
  resetSettingsPreservingCustomButtons,
  updateCustomButton,
  updateCustomTabLabel,
  updateTabVisibility,
} from '../options/src/options-state.ts';
import { resolveDefaultUI } from '../src/shared/default-ui.ts';
import type { CustomButtonId } from '../src/shared/default-ui.ts';
import { DEFAULT_SETTINGS, parseSettingsJson, serializeSettings } from '../src/shared/settings.ts';
import { CUSTOM_BUTTON_IDS, CUSTOM_TAB_ID, customTabSettings } from './fixtures/custom-tabs.ts';

const firstId = 'custom-123e4567-e89b-42d3-a456-426614174020';
const secondId = 'custom-123e4567-e89b-42d3-a456-426614174021';
const first = { groupId: 'directive', label: '一番', color: '#123456', visible: true, kind: 'insert', text: '改行\n本文', insertionMode: 'caret' } as const;
const second = { groupId: 'directive', label: '二番', color: '#654321', visible: false, kind: 'action', action: 'paste' } as const;

test('4操作のボタン作成をグループ末尾に追加し、保存JSON後もIDと定義を保つ', () => {
  const definitions = [
    { groupId: 'directive', label: '定型文', color: '#123', visible: true, kind: 'insert', text: '' },
    { groupId: 'directive', label: '時刻', color: '#123', visible: true, kind: 'action', action: 'insert-jst' },
    { groupId: 'directive', label: '貼付', color: '#123', visible: true, kind: 'action', action: 'paste' },
    { groupId: 'directive', label: 'クリア', color: '#123', visible: true, kind: 'action', action: 'clear' },
  ] as const;
  let settings = DEFAULT_SETTINGS;
  for (const [index, definition] of definitions.entries()) {
    const id = `custom-123e4567-e89b-42d3-a456-42661417402${index}` as CustomButtonId;
    settings = createCustomButton(settings, id, definition);
  }

  const parsed = parseSettingsJson(serializeSettings(settings));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.settings.buttonOrder?.directive, [
    'full-btn', 'summary-btn', 'translate-btn', 'search-btn',
    'custom-123e4567-e89b-42d3-a456-426614174020',
    'custom-123e4567-e89b-42d3-a456-426614174021',
    'custom-123e4567-e89b-42d3-a456-426614174022',
    'custom-123e4567-e89b-42d3-a456-426614174023',
  ]);
  assert.deepEqual(parsed.settings.customButtons?.['custom-123e4567-e89b-42d3-a456-426614174020'], definitions[0]);
});

test('customボタン編集は項目を保ち、操作切替で古いactionとtextを一括除去する', () => {
  const initial = createCustomButton(DEFAULT_SETTINGS, firstId, first);
  const edited = updateCustomButton(initial, firstId, 'label', '変更名');
  assert.equal(edited.customButtons?.[firstId]?.insertionMode, 'caret');
  const editedFields = updateCustomButton(
    updateCustomButton(updateCustomButton(edited, firstId, 'color', '#abcdef'), firstId, 'visible', false),
    firstId,
    'text',
    '編集後の本文',
  );
  assert.equal(editedFields.customButtons?.[firstId]?.insertionMode, 'caret');
  const action = changeCustomButtonOperation(edited, firstId, 'paste');
  assert.deepEqual(action.customButtons?.[firstId], {
    groupId: 'directive', label: '変更名', color: '#123456', visible: true, kind: 'action', action: 'paste',
  });
  const insert = changeCustomButtonOperation(action, firstId, 'insert');
  assert.deepEqual(insert.customButtons?.[firstId], {
    groupId: 'directive', label: '変更名', color: '#123456', visible: true, kind: 'insert', text: '',
  });
  assert.equal(updateCustomButton(insert, firstId, 'text', '次の本文').customButtons?.[firstId]?.kind, 'insert');
  assert.deepEqual(updateCustomButton(action, firstId, 'insertionMode', 'caret'), action);
  assert.deepEqual(changeCustomButtonOperation(initial, firstId, 'clear').customButtons?.[firstId], {
    groupId: 'directive', label: '一番', color: '#123456', visible: true, kind: 'action', action: 'clear',
  });
});

test('insertionModeはJSON出力・読込で維持し、新しい挿入ボタンには従来の既定動作を使う', () => {
  const initial = createCustomButton(DEFAULT_SETTINGS, firstId, first);
  const parsed = parseSettingsJson(serializeSettings(initial));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.settings.customButtons?.[firstId]?.insertionMode, 'caret');

  const freshId = 'custom-123e4567-e89b-42d3-a456-426614174022' as CustomButtonId;
  const fresh = createCustomButton(DEFAULT_SETTINGS, freshId, {
    groupId: 'directive', label: '新規', color: '#123456', visible: true, kind: 'insert', text: '',
  });
  assert.equal('insertionMode' in (fresh.customButtons?.[freshId] ?? {}), false);
  assert.equal(resolveDefaultUI(fresh).buttons.find(({ id }) => id === freshId)?.insertionMode, undefined);
});

test('削除は定義と全グループの順序参照をドラフトから一緒に除去する', () => {
  const initial = createCustomButton(createCustomButton(DEFAULT_SETTINGS, firstId, first), secondId, second);
  const deleted = deleteCustomButton(initial, firstId);
  assert.equal(deleted.customButtons?.[firstId], undefined);
  assert.ok(!deleted.buttonOrder?.directive?.includes(firstId));
  assert.deepEqual(resolveDefaultUI(deleted).buttons.filter(({ id }) => id === secondId).map(({ id }) => id), [secondId]);
});

test('既定値復元はカスタム定義と同一グループ内の相対順を保持し既定順の後ろへ置く', () => {
  let settings = createCustomButton(createCustomButton(DEFAULT_SETTINGS, firstId, first), secondId, second);
  settings = { ...settings, buttonOverrides: { 'full-btn': { label: '変更' } }, buttonOrder: { directive: [secondId, 'summary-btn', firstId] } };
  const reset = resetSettingsPreservingCustomButtons(settings);
  assert.deepEqual(reset.customButtons, settings.customButtons);
  assert.deepEqual(reset.buttonOrder?.directive, ['full-btn', 'summary-btn', 'translate-btn', 'search-btn', secondId, firstId]);
  assert.equal(reset.buttonOverrides, undefined);
});

test('旧JSONは保存済みカスタムを保持し、明示されたJSONだけ削除IDを列挙する', () => {
  const current = createCustomButton(createCustomButton(DEFAULT_SETTINGS, firstId, first), secondId, second);
  const legacyImport = { schemaVersion: 1 as const, buttonOrder: { directive: ['search-btn'] } };
  const merged = mergeImportedSettings(legacyImport, current);
  assert.deepEqual(merged.customButtons, current.customButtons);
  assert.deepEqual(merged.buttonOrder?.directive, ['search-btn', 'full-btn', 'summary-btn', 'translate-btn', firstId, secondId]);

  const explicitImport = { schemaVersion: 1 as const, customButtons: { [firstId]: first } };
  assert.deepEqual(getCustomButtonImportDeletions(current, explicitImport), [secondId]);
  assert.deepEqual(getCustomButtonImportDeletions(current, { schemaVersion: 1, customButtons: {} }), [firstId, secondId]);
});

test('custom tabのlabel・visible・button編集はgroupと将来metadataを保持する', () => {
  const settings = customTabSettings();
  const renamed = updateCustomTabLabel(settings, CUSTOM_TAB_ID, 'Renamed synthetic tab');
  assert.equal(renamed.customTabs?.[CUSTOM_TAB_ID]?.label, 'Renamed synthetic tab');
  assert.deepEqual(renamed.customTabs?.[CUSTOM_TAB_ID]?.futureField, { retained: true });
  const hidden = updateTabVisibility(renamed, CUSTOM_TAB_ID, false);
  assert.equal(hidden.customTabs?.[CUSTOM_TAB_ID]?.visible, false);
  assert.equal(hidden.tabOverrides?.[CUSTOM_TAB_ID]?.visible, false);
  const reordered = reorderButtonBefore(hidden, CUSTOM_TAB_ID, CUSTOM_BUTTON_IDS[1] as never, CUSTOM_BUTTON_IDS[0] as never);
  assert.deepEqual(reordered.buttonOrder?.[CUSTOM_TAB_ID]?.slice(0, 2), [CUSTOM_BUTTON_IDS[1], CUSTOM_BUTTON_IDS[0]]);
  const added = createCustomButton(hidden, 'custom-123e4567-e89b-42d3-a456-426614174099', {
    groupId: CUSTOM_TAB_ID, label: 'Synthetic new button', color: '#123456', visible: true, kind: 'insert', text: '',
  });
  assert.equal(added.customButtons?.['custom-123e4567-e89b-42d3-a456-426614174099' as `custom-${string}`]?.groupId, CUSTOM_TAB_ID);
  assert.ok(added.buttonOrder?.[CUSTOM_TAB_ID]?.includes('custom-123e4567-e89b-42d3-a456-426614174099'));
});

test('resetとlegacy importはcustom tab依存を保ち、明示置換の削除を識別する', () => {
  const settings = customTabSettings();
  const reset = resetSettingsPreservingCustomButtons(settings);
  assert.deepEqual(reset.customTabs, settings.customTabs);
  assert.equal(reset.customButtons?.[CUSTOM_BUTTON_IDS[0]! as `custom-${string}`]?.groupId, CUSTOM_TAB_ID);
  assert.equal(reset.buttonOrder?.[CUSTOM_TAB_ID]?.length, 7);
  assert.ok(reset.tabOrder?.includes(CUSTOM_TAB_ID));

  const legacyImport = { schemaVersion: 1 as const, answerCompletionSoundEnabled: true };
  const merged = mergeImportedSettings(legacyImport, settings);
  assert.deepEqual(merged.customTabs, settings.customTabs);
  assert.deepEqual(merged.customButtons, settings.customButtons);
  assert.equal(serializeSettings(merged).includes('custom-tab-'), true);

  const explicitRemoval = { schemaVersion: 1 as const, customTabs: {}, customButtons: {} };
  assert.deepEqual(getCustomTabImportDeletions(settings, explicitRemoval), [CUSTOM_TAB_ID]);
});
