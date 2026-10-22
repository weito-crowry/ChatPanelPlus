import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SETTINGS,
  isExtensionSettings,
  parseSettingsJson,
  serializeSettings,
  validateExtensionSettings,
} from '../src/shared/settings.ts';
import { DEFAULT_BUTTONS } from '../src/shared/default-ui.ts';

test('the default settings use the current schema version', () => {
  assert.deepEqual(DEFAULT_SETTINGS, { schemaVersion: 1 });
  assert.equal(isExtensionSettings(DEFAULT_SETTINGS), true);
});

test('settings validation rejects malformed and unsupported values', () => {
  assert.equal(isExtensionSettings(null), false);
  assert.equal(isExtensionSettings([]), false);
  assert.equal(isExtensionSettings({ schemaVersion: 2 }), false);
  assert.equal(isExtensionSettings({ schemaVersion: '1' }), false);
});

test('schema 1は有効な8項目を検証・正規化し、未知schemaと壊れた既知値を拒否する', () => {
  const validated = validateExtensionSettings({
    schemaVersion: 1,
    buttonOverrides: { 'full-btn': { visible: false, label: '', color: '#abc', text: ' x\n' } },
    tabOverrides: { wall: { visible: false } },
    buttonOrder: { directive: ['summary-btn', 'summary-btn', 'unknown'] },
    tabOrder: ['wall', 'wall', 'unknown'],
  });
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.deepEqual(validated.settings.buttonOrder?.directive, ['summary-btn', 'full-btn', 'translate-btn', 'search-btn']);
  assert.deepEqual(validated.settings.tabOrder, ['wall', 'directive', 'control', 'binary', 'quad']);
  assert.deepEqual(validated.settings.buttonOverrides?.['full-btn'], { visible: false, label: '', color: '#abc', text: ' x\n' });
  const unknownSchema = validateExtensionSettings({ schemaVersion: 2 });
  assert.equal(unknownSchema.ok, false);
  if (!unknownSchema.ok) assert.equal(unknownSchema.reason, 'unsupported-schema');
  assert.equal(validateExtensionSettings({ schemaVersion: 1, buttonOverrides: { 'full-btn': { color: 'url(x)' } } }).ok, false);
  assert.equal(validateExtensionSettings({ schemaVersion: 1, buttonOverrides: { 'now-btn': { text: 'not editable' } } }).ok, false);
  assert.equal(DEFAULT_BUTTONS.filter(({ kind }) => kind === 'insert').length, 17);
});

test('JSON import/exportは設定だけ往復し、不正JSONと未知schemaを拒否する', () => {
  const settings = { schemaVersion: 1, buttonOverrides: { 'wall-task-btn': { text: 'A\n\n B ' } } };
  const parsed = parseSettingsJson(serializeSettings(settings));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.settings, settings);
  assert.equal(parseSettingsJson('{').ok, false);
  assert.equal(parseSettingsJson('{"schemaVersion":2}').ok, false);
});
