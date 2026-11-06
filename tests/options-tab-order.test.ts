import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getLayoutPreview,
  getOptionsGroups,
  moveButtonOrder,
  moveTabOrder,
  reorderButtonBefore,
  reorderTabBefore,
  createCustomTab,
  deleteCustomTab,
  moveButtonGroup,
  renameTab,
  resetSettingsPreservingCustomButtons,
  mergeImportedSettings,
  getCustomTabImportDeletions,
} from '../options/src/options-state.ts';
import { DEFAULT_SETTINGS, parseSettingsJson, serializeSettings } from '../src/shared/settings.ts';
import { resolveDefaultUI } from '../src/shared/default-ui.ts';

test('tab sections immediately follow the unsaved draft order and keep hidden tabs', () => {
  const initial = {
    ...DEFAULT_SETTINGS,
    tabOverrides: { wall: { visible: false } },
  };
  const draft = moveTabOrder(initial, 'control', -1);

  assert.deepEqual(draft.tabOrder, ['control', 'directive', 'wall', 'binary', 'quad']);
  assert.deepEqual(getOptionsGroups(draft).map(({ id }) => id), [
    'always', 'control', 'directive', 'wall', 'binary', 'quad',
  ]);
  assert.equal(draft.tabOverrides?.wall?.visible, false);
});

test('tab section order and stable IDs survive save and reload', () => {
  let draft = moveTabOrder(DEFAULT_SETTINGS, 'wall', 1);
  draft = moveTabOrder(draft, 'wall', 1);
  const saved = parseSettingsJson(serializeSettings(draft));

  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.deepEqual(getOptionsGroups(saved.settings).map(({ id }) => id), [
    'always', 'directive', 'control', 'binary', 'quad', 'wall',
  ]);
  assert.deepEqual(saved.settings.tabOrder, ['directive', 'control', 'binary', 'quad', 'wall']);
});

test('drag reorder moves buttons only within the selected group', () => {
  const initial = {
    ...DEFAULT_SETTINGS,
    buttonOrder: {
      directive: ['full-btn', 'summary-btn', 'translate-btn', 'search-btn'],
      wall: ['wall-start-btn', 'wall-task-btn', 'wall-sum-btn', 'wall-resume-btn'],
    },
  };
  const reordered = reorderButtonBefore(initial, 'directive', 'search-btn', 'summary-btn');

  assert.deepEqual(reordered.buttonOrder?.directive, ['full-btn', 'search-btn', 'summary-btn', 'translate-btn']);
  assert.deepEqual(reordered.buttonOrder?.wall, initial.buttonOrder.wall);
  assert.equal(reorderButtonBefore(initial, 'directive', 'wall-start-btn', 'full-btn'), initial);
});

test('keyboard movement and tab drag reorder share normalized order state', () => {
  const keyboardMoved = moveButtonOrder(DEFAULT_SETTINGS, 'always', 'chat-btn', -1);
  assert.deepEqual(keyboardMoved.buttonOrder?.always, ['now-btn', 'paste-btn', 'chat-btn', 'clear-btn']);

  const dragged = reorderTabBefore(DEFAULT_SETTINGS, 'quad', 'control');
  assert.deepEqual(dragged.tabOrder, ['directive', 'quad', 'control', 'wall', 'binary']);
  assert.equal(reorderTabBefore(DEFAULT_SETTINGS, 'ghost' as never, 'control'), DEFAULT_SETTINGS);
});

test('layout preview reflects draft order, labels, colors, and visible items only', () => {
  const draft = {
    ...DEFAULT_SETTINGS,
    tabOrder: ['wall', 'directive', 'control', 'binary', 'quad'],
    tabOverrides: { directive: { visible: false } },
    buttonOrder: { wall: ['wall-sum-btn', 'wall-task-btn', 'wall-start-btn', 'wall-resume-btn'] },
    buttonOverrides: {
      'wall-sum-btn': { label: '要点', color: '#abc' },
      'wall-task-btn': { visible: false },
      'now-btn': { visible: false },
    },
  };
  const preview = getLayoutPreview(draft);

  assert.deepEqual(preview.alwaysButtons.map(({ id }) => id), ['paste-btn', 'clear-btn', 'chat-btn']);
  assert.deepEqual(preview.tabs.map(({ id }) => id), ['wall', 'control', 'binary', 'quad']);
  assert.deepEqual(preview.tabs[0]?.buttons.map(({ id }) => id), ['wall-sum-btn', 'wall-start-btn', 'wall-resume-btn']);
  assert.deepEqual(preview.tabs[0]?.buttons[0], { id: 'wall-sum-btn', label: '要点', color: '#abc' });
});

test('custom tabs can be renamed, reordered, moved with buttons, and deleted to a chosen group', () => {
  const tabId = 'custom-tab-123e4567-e89b-42d3-a456-426614174000' as const;
  const created = createCustomTab(DEFAULT_SETTINGS, tabId, '  新規  ');
  const renamed = renameTab(created, tabId, '長い名前');
  assert.equal(resolveDefaultUI(renamed).tabs.find(({ id }) => id === tabId)?.label, '長い名前');
  const moved = moveButtonGroup(renamed, 'full-btn', tabId);
  assert.equal(resolveDefaultUI(moved).buttons.find(({ id }) => id === 'full-btn')?.groupId, tabId);
  const deleted = deleteCustomTab(moved, tabId, 'always');
  assert.equal(resolveDefaultUI(deleted).tabs.some(({ id }) => id === tabId), false);
  assert.equal(resolveDefaultUI(deleted).buttons.find(({ id }) => id === 'full-btn')?.groupId, 'always');
});

test('reset preserves custom tabs and custom buttons while restoring default tabs first', () => {
  const tabId = 'custom-tab-123e4567-e89b-42d3-a456-426614174000' as const;
  const settings = createCustomTab(DEFAULT_SETTINGS, tabId, 'Keep');
  const reset = resetSettingsPreservingCustomButtons(settings);
  assert.deepEqual(reset.tabOrder, ['directive', 'control', 'wall', 'binary', 'quad', tabId]);
  assert.equal(reset.customTabs?.[tabId]?.label, 'Keep');
});

test('legacy JSON without customTabs preserves saved custom tabs and explicit empty set reports deletions', () => {
  const tabId = 'custom-tab-123e4567-e89b-42d3-a456-426614174000' as const;
  const secondId = 'custom-tab-123e4567-e89b-42d3-a456-426614174002' as const;
  const current = moveButtonGroup(reorderTabBefore(createCustomTab(createCustomTab(DEFAULT_SETTINGS, tabId, 'Keep'), secondId, 'Keep 2'), secondId, tabId), 'full-btn', tabId);
  const legacy = mergeImportedSettings(DEFAULT_SETTINGS, current);
  assert.equal(legacy.customTabs?.[tabId]?.label, 'Keep');
  assert.deepEqual(resolveDefaultUI(legacy).tabs.slice(-2).map(({ id }) => id), [secondId, tabId]);
  const deletion = getCustomTabImportDeletions(current, { ...DEFAULT_SETTINGS, customTabs: {} });
  assert.deepEqual(deletion, [{ id: tabId, buttonCount: 1 }, { id: secondId, buttonCount: 0 }]);
});
