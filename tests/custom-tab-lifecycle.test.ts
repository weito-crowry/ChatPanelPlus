import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCustomButton, createCustomTab, deleteCustomTab, mergeImportedSettings,
  moveButtonGroup, resetSettingsPreservingCustomButtons, setTabVisibility,
} from '../options/src/options-state.ts';
import { createPanelViewModel, reconcilePanelViewState } from '../src/content/panel-view.ts';
import { resolveDefaultUI } from '../src/shared/default-ui.ts';
import { DEFAULT_SETTINGS, parseSettingsJson, serializeSettings } from '../src/shared/settings.ts';

const tabId = 'custom-tab-123e4567-e89b-42d3-a456-426614174020';
const buttonId = 'custom-123e4567-e89b-42d3-a456-426614174021';
const definition = {
  groupId: 'directive', label: '保持する本文', color: '#123abc', visible: false,
  kind: 'insert', text: '  本文\n\n  次の行\n', insertionMode: 'caret',
} as const;

test('ボタン移動とタブ削除では本文・挿入位置・色・表示状態を保持し移動先末尾へ加える', () => {
  const initial = createCustomButton(createCustomTab(DEFAULT_SETTINGS, tabId, '移動先'), buttonId, definition);
  const moved = moveButtonGroup(moveButtonGroup(initial, 'full-btn', tabId), buttonId, tabId);
  assert.deepEqual(moved.customButtons?.[buttonId], { ...definition, groupId: tabId });
  assert.deepEqual(moved.buttonOrder?.[tabId], ['full-btn', buttonId]);
  assert.equal(moved.buttonOrder?.directive?.includes(buttonId), false);
  const deleted = deleteCustomTab(moved, tabId, 'always');
  assert.deepEqual(deleted.customButtons?.[buttonId], { ...definition, groupId: 'always' });
  assert.deepEqual(deleted.buttonOrder?.always, ['now-btn', 'paste-btn', 'clear-btn', 'chat-btn', 'full-btn', buttonId]);
  assert.equal(deleted.buttonOrder?.[tabId], undefined);
  assert.equal(deleted.customTabs?.[tabId], undefined);
  assert.equal(resolveDefaultUI(deleted).buttons.length, 21);
});

test('旧JSONの適用とJSON往復で追加タブ・カスタム本文・既定ボタン所属を保持する', () => {
  const initial = createCustomButton(createCustomTab(DEFAULT_SETTINGS, tabId, '保持タブ'), buttonId, definition);
  const current = moveButtonGroup(moveButtonGroup(initial, buttonId, tabId), 'full-btn', tabId);
  const imported = mergeImportedSettings({ ...DEFAULT_SETTINGS, futureOptions: { keep: true } }, current);
  const roundTrip = parseSettingsJson(serializeSettings(imported));
  assert.equal(roundTrip.ok, true);
  if (!roundTrip.ok) return;
  assert.deepEqual(roundTrip.settings.customTabs, { [tabId]: { label: '保持タブ', visible: true } });
  assert.deepEqual(roundTrip.settings.customButtons?.[buttonId], { ...definition, groupId: tabId });
  assert.equal(roundTrip.settings.builtinButtonGroupOverrides?.['full-btn'], tabId);
  assert.deepEqual(roundTrip.settings.futureOptions, { keep: true });
});

test('既定値復元はカスタムタブ・所属する本文を保持して既定ボタンだけ元の所属へ戻す', () => {
  const initial = createCustomButton(createCustomTab(DEFAULT_SETTINGS, tabId, '保持タブ'), buttonId, definition);
  const current = moveButtonGroup(moveButtonGroup(initial, buttonId, tabId), 'full-btn', tabId);
  const reset = resetSettingsPreservingCustomButtons(setTabVisibility(current, tabId, false));
  assert.deepEqual(reset.customTabs?.[tabId], { label: '保持タブ', visible: false });
  assert.deepEqual(reset.customButtons?.[buttonId], { ...definition, groupId: tabId });
  assert.equal(resolveDefaultUI(reset).buttons.find(({ id }) => id === 'full-btn')?.groupId, 'directive');
  assert.deepEqual(reset.buttonOrder?.[tabId], [buttonId]);
  assert.equal(parseSettingsJson(serializeSettings(reset)).ok, true);
});

test('選択中の追加タブを隠す・削除すると最初の可視タブへ移り全非表示でも常時ボタンを残す', () => {
  const initial = createCustomTab(DEFAULT_SETTINGS, tabId, '選択中');
  const selected = { selectedTabId: tabId, minimized: true } as const;
  for (const settings of [setTabVisibility(initial, tabId, false), deleteCustomTab(initial, tabId, 'always')]) {
    assert.deepEqual(reconcilePanelViewState(selected, createPanelViewModel(settings).tabs), {
      selectedTabId: 'directive', minimized: true,
    });
  }
  let hidden = initial;
  for (const tab of resolveDefaultUI(initial).tabs) hidden = setTabVisibility(hidden, tab.id, false);
  const model = createPanelViewModel(hidden);
  assert.deepEqual(model.tabs, []);
  assert.deepEqual(reconcilePanelViewState(selected, model.tabs), { selectedTabId: null, minimized: true });
  assert.deepEqual(model.utilityButtons.map(({ id }) => id), ['now-btn', 'paste-btn', 'clear-btn', 'chat-btn']);
});
