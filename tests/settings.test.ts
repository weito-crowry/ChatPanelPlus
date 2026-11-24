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
import { CUSTOM_BUTTON_IDS, CUSTOM_TAB_ID, customTabSettings } from './fixtures/custom-tabs.ts';

test('the default settings use the current schema version', () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    schemaVersion: 1,
    answerCompletionSoundVolumePercent: 60,
    codexBridgeTerminalAnswerTemplate: '##Codex最終回答##',
    codexBridgeTerminalSoundEnabled: false,
    codexBridgeTerminalSoundId: 'two-tone',
    codexBridgeTerminalSoundVolumePercent: 60,
  });
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
  if (parsed.ok) assert.deepEqual(parsed.settings, {
    ...settings, codexBridgeTerminalSoundEnabled: false, codexBridgeTerminalSoundId: 'tone-660',
    codexBridgeTerminalSoundVolumePercent: 60, codexBridgeTerminalAnswerTemplate: '##Codex最終回答##',
  });
  assert.equal(parseSettingsJson('{').ok, false);
  assert.equal(parseSettingsJson('{"schemaVersion":2}').ok, false);
});

test('旧schema 1設定は最終回答token単独へ正規化し、JSON exportにも含める', () => {
  const oldSettings = validateExtensionSettings({ schemaVersion: 1 });
  assert.equal(oldSettings.ok, true);
  if (!oldSettings.ok) return;
  assert.equal(oldSettings.settings.codexBridgeTerminalAnswerTemplate, '##Codex最終回答##');
  const exported = JSON.parse(serializeSettings({ schemaVersion: 1 })) as Record<string, unknown>;
  assert.equal(exported.codexBridgeTerminalAnswerTemplate, '##Codex最終回答##');
  const imported = parseSettingsJson('{"schemaVersion":1}');
  assert.equal(imported.ok, true);
  if (imported.ok) assert.equal(imported.settings.codexBridgeTerminalAnswerTemplate, '##Codex最終回答##');
});

test('旧回答完了音からCodex音をfieldごとに移行し、保存後は互いに独立する', () => {
  const legacy = validateExtensionSettings({
    schemaVersion: 1, answerCompletionSoundEnabled: true,
    answerCompletionSoundId: 'soft-chime', answerCompletionSoundVolumePercent: 38,
  });
  assert.equal(legacy.ok, true);
  if (!legacy.ok) return;
  assert.equal(legacy.settings.codexBridgeTerminalSoundEnabled, true);
  assert.equal(legacy.settings.codexBridgeTerminalSoundId, 'soft-chime');
  assert.equal(legacy.settings.codexBridgeTerminalSoundVolumePercent, 38);

  const partial = parseSettingsJson(JSON.stringify({
    schemaVersion: 1, answerCompletionSoundEnabled: true,
    answerCompletionSoundId: 'soft-chime', answerCompletionSoundVolumePercent: 38,
    codexBridgeTerminalSoundEnabled: false, codexBridgeTerminalSoundVolumePercent: 0,
  }));
  assert.equal(partial.ok, true);
  if (!partial.ok) return;
  assert.equal(partial.settings.codexBridgeTerminalSoundEnabled, false);
  assert.equal(partial.settings.codexBridgeTerminalSoundId, 'soft-chime');
  assert.equal(partial.settings.codexBridgeTerminalSoundVolumePercent, 0);

  const exported = serializeSettings(legacy.settings);
  const independent = parseSettingsJson(exported);
  assert.equal(independent.ok, true);
  if (!independent.ok) return;
  const changed = validateExtensionSettings({
    ...independent.settings, answerCompletionSoundEnabled: false,
    answerCompletionSoundId: 'tone-660', answerCompletionSoundVolumePercent: 81,
  });
  assert.equal(changed.ok, true);
  if (changed.ok) {
    assert.equal(changed.settings.codexBridgeTerminalSoundEnabled, true);
    assert.equal(changed.settings.codexBridgeTerminalSoundId, 'soft-chime');
    assert.equal(changed.settings.codexBridgeTerminalSoundVolumePercent, 38);
  }

  const missingLegacyFields = validateExtensionSettings({ schemaVersion: 1 });
  assert.equal(missingLegacyFields.ok, true);
  if (missingLegacyFields.ok) {
    assert.equal(missingLegacyFields.settings.codexBridgeTerminalSoundEnabled, false);
    assert.equal(missingLegacyFields.settings.codexBridgeTerminalSoundId, 'tone-660');
    assert.equal(missingLegacyFields.settings.codexBridgeTerminalSoundVolumePercent, 60);
  }
});

test('Codex音設定はboolean・builtin/custom ID・整数音量だけを受け入れる', () => {
  for (const [field, value] of [
    ['codexBridgeTerminalSoundEnabled', 'true'],
    ['codexBridgeTerminalSoundId', 'unknown'],
    ['codexBridgeTerminalSoundVolumePercent', 20.5],
    ['codexBridgeTerminalSoundVolumePercent', 101],
  ] as const) {
    assert.equal(validateExtensionSettings({ schemaVersion: 1, [field]: value }).ok, false);
  }
  assert.equal(validateExtensionSettings({
    schemaVersion: 1, codexBridgeTerminalSoundEnabled: false,
    codexBridgeTerminalSoundId: 'user-00000000-0000-4000-8000-000000000001',
    codexBridgeTerminalSoundVolumePercent: 0,
  }).ok, true);
});

test('templateはplaceholderなし・不正型・8192 UTF-16 code units超過を拒否する', () => {
  const token = '##Codex最終回答##';
  const atLimit = `${token}${'x'.repeat(8_192 - token.length)}`;
  assert.equal(atLimit.length, 8_192);
  assert.equal(validateExtensionSettings({ schemaVersion: 1, codexBridgeTerminalAnswerTemplate: atLimit }).ok, true);
  for (const value of ['固定文だけ', 42, null, `##Codex最終回答##${'x'.repeat(8192)}`]) {
    assert.equal(validateExtensionSettings({ schemaVersion: 1, codexBridgeTerminalAnswerTemplate: value }).ok, false);
  }
  const emojiOverLimit = `${token}${'😀'.repeat(Math.ceil((8_192 - token.length) / 2))}`;
  assert.equal(emojiOverLimit.length > 8_192, true);
  assert.equal(validateExtensionSettings({ schemaVersion: 1, codexBridgeTerminalAnswerTemplate: emojiOverLimit }).ok, false);
  const invalidImport = parseSettingsJson('{"schemaVersion":1,"codexBridgeTerminalAnswerTemplate":"固定文だけ"}');
  assert.equal(invalidImport.ok, false);
  if (!invalidImport.ok) assert.equal(invalidImport.reason, 'invalid-terminal-answer-template');
});

test('回答完了音はschema 1の旧設定でOFFとなり、boolean値だけをJSON往復する', () => {
  const oldSettings = validateExtensionSettings({ schemaVersion: 1 });
  assert.equal(oldSettings.ok, true);
  if (oldSettings.ok) {
    assert.equal(oldSettings.settings.answerCompletionSoundEnabled ?? false, false);
    assert.equal(oldSettings.settings.answerCompletionSoundVolumePercent ?? DEFAULT_SETTINGS.answerCompletionSoundVolumePercent, 60);
  }

  const enabled = parseSettingsJson(serializeSettings({ schemaVersion: 1, answerCompletionSoundEnabled: true }));
  assert.equal(enabled.ok, true);
  if (enabled.ok) assert.equal(enabled.settings.answerCompletionSoundEnabled, true);
  assert.equal(validateExtensionSettings({ schemaVersion: 1, answerCompletionSoundEnabled: 'yes' }).ok, false);
});

test('選択音IDはschema 1の既存設定とJSONで往復し、不明なIDを拒否する', () => {
  const selected = { schemaVersion: 1, answerCompletionSoundId: 'soft-chime' };
  const parsed = parseSettingsJson(serializeSettings(selected));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.settings.answerCompletionSoundId, 'soft-chime');
  assert.equal(validateExtensionSettings({ schemaVersion: 1, answerCompletionSoundId: 'unknown' }).ok, false);
  assert.equal(validateExtensionSettings({ schemaVersion: 1, answerCompletionSoundId: 'user-00000000-0000-4000-8000-000000000001' }).ok, true);
});

test('回答完了音の音量は旧設定を保ちつつ整数0〜100だけを受け入れてJSON往復する', () => {
  const oldSettings = parseSettingsJson('{"schemaVersion":1}');
  assert.equal(oldSettings.ok, true);
  if (oldSettings.ok) assert.equal(oldSettings.settings.answerCompletionSoundVolumePercent, undefined);

  for (const volume of [0, 100]) {
    assert.equal(validateExtensionSettings({ schemaVersion: 1, answerCompletionSoundVolumePercent: volume }).ok, true);
  }
  for (const volume of [-1, 101, 40.5, Number.NaN, Number.POSITIVE_INFINITY, '40', null]) {
    assert.equal(validateExtensionSettings({ schemaVersion: 1, answerCompletionSoundVolumePercent: volume }).ok, false);
  }

  const parsed = parseSettingsJson(serializeSettings({ schemaVersion: 1, answerCompletionSoundVolumePercent: 37 }));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.settings.answerCompletionSoundVolumePercent, 37);
});

test('schema 1 accepts legacy settings and round-trips custom tabs with their button groups', () => {
  assert.equal(validateExtensionSettings({ schemaVersion: 1 }).ok, true);
  const settings = customTabSettings();
  const parsed = parseSettingsJson(serializeSettings(settings));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.settings.customTabs, settings.customTabs);
  assert.deepEqual(parsed.settings.customButtons, settings.customButtons);
  assert.deepEqual(parsed.settings.buttonOrder?.[CUSTOM_TAB_ID], CUSTOM_BUTTON_IDS.slice(0, 7));
  assert.ok(parsed.settings.tabOrder?.includes(CUSTOM_TAB_ID));
});

test('custom tabs reject malformed definitions and dangling custom references', () => {
  const settings = customTabSettings();
  const invalid: unknown[] = [
    { ...settings, customTabs: { 'custom-tab-not-a-uuid': { label: 'Synthetic', visible: true } } },
    { ...settings, customTabs: { [CUSTOM_TAB_ID]: { label: 1, visible: true } } },
    { ...settings, customTabs: { [CUSTOM_TAB_ID]: { label: 'Synthetic', visible: 'yes' } } },
    { ...settings, customButtons: { ...settings.customButtons, [CUSTOM_BUTTON_IDS[0]!]: { ...settings.customButtons![CUSTOM_BUTTON_IDS[0] as keyof typeof settings.customButtons]!, groupId: 'custom-tab-123e4567-e89b-42d3-a456-426614174099' } } },
    { ...settings, customTabs: {}, customButtons: settings.customButtons },
    { ...settings, buttonOrder: { ...settings.buttonOrder, 'custom-tab-123e4567-e89b-42d3-a456-426614174099': [CUSTOM_BUTTON_IDS[0]!] } },
    { ...settings, buttonOrder: { ...settings.buttonOrder, [CUSTOM_TAB_ID]: [...settings.buttonOrder![CUSTOM_TAB_ID]!, 'custom-123e4567-e89b-42d3-a456-426614174099'] } },
    { ...settings, tabOrder: [CUSTOM_TAB_ID, 'custom-tab-123e4567-e89b-42d3-a456-426614174099'] },
    { ...settings, tabOrder: [CUSTOM_TAB_ID, CUSTOM_TAB_ID] },
    { ...settings, tabOverrides: { 'custom-tab-123e4567-e89b-42d3-a456-426614174099': { visible: false } } },
    { ...settings, customTabs: { constructor: { label: 'Synthetic', visible: true } } },
  ];
  for (const value of invalid) {
    const result = validateExtensionSettings(value);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'invalid-settings');
  }
});
