import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getLayoutPreview,
  getOptionsGroups,
  moveButtonOrder,
  moveTabOrder,
  reorderButtonBefore,
  reorderTabBefore,
} from '../options/src/options-state.ts';
import { DEFAULT_SETTINGS, parseSettingsJson, serializeSettings } from '../src/shared/settings.ts';

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
