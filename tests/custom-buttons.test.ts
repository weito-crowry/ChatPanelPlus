import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDefaultUI } from '../src/shared/default-ui.ts';
import { parseSettingsJson, serializeSettings, validateExtensionSettings } from '../src/shared/settings.ts';

const textId = 'custom-123e4567-e89b-42d3-a456-426614174000';
const pasteId = 'custom-123e4567-e89b-42d3-a456-426614174001';

const textButton = {
  groupId: 'directive', label: '空の定型文', color: '#abc', visible: true, kind: 'insert', text: '',
};

test('schema v1 keeps custom buttons and merges their stable IDs with built-in order', () => {
  const legacy = validateExtensionSettings({ schemaVersion: 1, futureOptions: { enabled: true } });
  assert.equal(legacy.ok, true);
  if (legacy.ok) assert.equal(legacy.settings.customButtons, undefined);

  const result = validateExtensionSettings({
    schemaVersion: 1,
    futureOptions: { enabled: true },
    customButtons: {
      [textId]: textButton,
      [pasteId]: { groupId: 'always', label: '貼付', color: '#123456', visible: false, kind: 'action', action: 'paste' },
    },
    buttonOrder: { directive: [textId, 'full-btn', textId], always: [pasteId] },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.settings.buttonOrder?.directive, [textId, 'full-btn', 'summary-btn', 'translate-btn', 'search-btn']);
  assert.deepEqual(result.settings.buttonOrder?.always, [pasteId, 'now-btn', 'paste-btn', 'clear-btn', 'chat-btn']);
  assert.deepEqual(result.settings.customButtons?.[textId], textButton);
  assert.deepEqual(result.settings.futureOptions, { enabled: true });
});

test('settings JSON round trip resolves custom action and empty insert text without dropping IDs', () => {
  const serialized = serializeSettings({
    schemaVersion: 1,
    customButtons: { [textId]: textButton },
    buttonOrder: { directive: [textId] },
  });
  const parsed = parseSettingsJson(serialized);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const button = resolveDefaultUI(parsed.settings).buttons.find(({ id }) => id === textId);
  assert.deepEqual(button, {
    id: textId,
    groupId: 'directive',
    order: 0,
    label: '空の定型文',
    color: '#abc',
    kind: 'insert',
    text: '',
    visible: true,
  });
});

test('custom definitions reject invalid IDs, groups, operation tuples, types, colors, and extra action fields', () => {
  const invalidDefinitions = [
    ['button-id', textButton],
    ['custom-123e4567-e89b-12d3-a456-426614174000', textButton],
    [textId, { ...textButton, groupId: 'missing' }],
    [textId, { ...textButton, visible: 'yes' }],
    [textId, { ...textButton, color: 'red' }],
    [textId, { ...textButton, action: 'paste' }],
    [textId, { ...textButton, kind: 'action', action: 'unknown', text: undefined }],
    [textId, { groupId: 'directive', label: '本文なし', color: '#abc', visible: true, kind: 'insert' }],
    [textId, { groupId: 'directive', label: '余計な本文', color: '#abc', visible: true, kind: 'action', action: 'clear', text: 'x' }],
    [textId, { ...textButton, onClick: 'alert(1)' }],
  ] as const;

  for (const [id, definition] of invalidDefinitions) {
    assert.equal(validateExtensionSettings({ schemaVersion: 1, customButtons: { [id]: definition } }).ok, false, id);
  }
});

test('custom order references to unknown IDs or another group are rejected while ordinary ghost IDs stay compatible', () => {
  assert.equal(validateExtensionSettings({
    schemaVersion: 1,
    buttonOrder: { directive: ['custom-123e4567-e89b-42d3-a456-426614174099'] },
  }).ok, false);
  assert.equal(validateExtensionSettings({
    schemaVersion: 1,
    customButtons: { [pasteId]: { groupId: 'always', label: '貼付', color: '#123', visible: true, kind: 'action', action: 'paste' } },
    buttonOrder: { directive: [pasteId] },
  }).ok, false);
  assert.equal(validateExtensionSettings({
    schemaVersion: 1,
    customButtons: { [textId]: textButton },
    buttonOrder: { futureGroup: [textId] },
  }).ok, false);

  const compatible = validateExtensionSettings({ schemaVersion: 1, buttonOrder: { directive: ['legacy-ghost'] } });
  assert.equal(compatible.ok, true);
  if (compatible.ok) assert.deepEqual(compatible.settings.buttonOrder?.directive, ['full-btn', 'summary-btn', 'translate-btn', 'search-btn']);
});
