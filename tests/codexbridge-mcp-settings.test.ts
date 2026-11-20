import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeImportedSettings, resetSettingsPreservingCustomButtons } from '../options/src/options-state.ts';
import { CONFIG_STORAGE_KEY, SettingsRepository } from '../src/shared/settings-repository.ts';
import { DEFAULT_SETTINGS, validateExtensionSettings } from '../src/shared/settings.ts';

test('MCP URL is a string setting, survives reset and legacy JSON import', () => {
  const stored = validateExtensionSettings({ schemaVersion: 1, codexBridgeMcpUrl: 'http://127.0.0.1:18000/mcp' });
  const legacy = validateExtensionSettings({ schemaVersion: 1 });
  assert.equal(stored.ok, true);
  assert.equal(legacy.ok, true);
  if (!stored.ok || !legacy.ok) return;

  assert.equal(validateExtensionSettings({ schemaVersion: 1, codexBridgeMcpUrl: 42 }).ok, false);
  assert.equal(resetSettingsPreservingCustomButtons(stored.settings).codexBridgeMcpUrl, stored.settings.codexBridgeMcpUrl);
  assert.equal(mergeImportedSettings(legacy.settings, stored.settings).codexBridgeMcpUrl, stored.settings.codexBridgeMcpUrl);
  assert.equal(mergeImportedSettings({ ...legacy.settings, codexBridgeMcpUrl: 'https://bridge.example/mcp' }, stored.settings)
    .codexBridgeMcpUrl, 'https://bridge.example/mcp');
});

test('MCP URL is saved through the existing settings repository path', async () => {
  const values: Record<string, unknown> = {};
  const repository = new SettingsRepository({
    async get(keys) {
      return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
    },
    async set(items) { Object.assign(values, items); },
  });
  const base = DEFAULT_SETTINGS;
  const draft = { ...base, codexBridgeMcpUrl: 'http://127.0.0.1:18000/mcp' };

  const result = await repository.saveSettings(base, draft);

  assert.equal(result.ok, true);
  assert.equal((values[CONFIG_STORAGE_KEY] as { codexBridgeMcpUrl?: string }).codexBridgeMcpUrl, draft.codexBridgeMcpUrl);
});
