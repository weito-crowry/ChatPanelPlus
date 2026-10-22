import { DEFAULT_BUTTONS, DEFAULT_TABS, type ButtonGroupId, type TabId } from './default-ui.ts';

export const SETTINGS_SCHEMA_VERSION = 1 as const;

export type ButtonOverride = Readonly<{
  visible?: boolean;
  label?: string;
  color?: string;
  text?: string;
  [key: string]: unknown;
}>;

export type ExtensionSettings = Readonly<{
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  buttonOverrides?: Readonly<Record<string, ButtonOverride>>;
  tabOverrides?: Readonly<Record<string, Readonly<{ visible?: boolean; [key: string]: unknown }>>>;
  buttonOrder?: Readonly<Record<string, readonly string[]>>;
  tabOrder?: readonly string[];
  [key: string]: unknown;
}>;

export type SettingsValidationError = 'malformed' | 'unsupported-schema' | 'invalid-settings';
export type SettingsValidationResult =
  | { readonly ok: true; readonly settings: ExtensionSettings }
  | { readonly ok: false; readonly reason: SettingsValidationError };

export const DEFAULT_SETTINGS: ExtensionSettings = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
});

const BUTTON_IDS = new Set<string>(DEFAULT_BUTTONS.map(({ id }) => id));
const INSERT_BUTTON_IDS = new Set<string>(DEFAULT_BUTTONS.filter(({ kind }) => kind === 'insert').map(({ id }) => id));
const TAB_IDS = new Set<string>(DEFAULT_TABS.map(({ id }) => id));
const GROUP_IDS = new Set<ButtonGroupId>(['always', ...DEFAULT_TABS.map(({ id }) => id)]);

function plainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function orderedIds(defaults: readonly string[], value: unknown): string[] | null {
  if (value === undefined) return [...defaults];
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) return null;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const id of value) {
    if (defaults.includes(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  for (const id of defaults) if (!seen.has(id)) result.push(id);
  return result;
}

function settingsError(reason: SettingsValidationError): SettingsValidationResult {
  return { ok: false, reason };
}

export function validateExtensionSettings(value: unknown): SettingsValidationResult {
  if (!plainObject(value) || !('schemaVersion' in value)) return settingsError('malformed');
  if (value.schemaVersion !== SETTINGS_SCHEMA_VERSION) return settingsError('unsupported-schema');

  const buttonOverrides: Record<string, ButtonOverride> = {};
  if (value.buttonOverrides !== undefined) {
    if (!plainObject(value.buttonOverrides)) return settingsError('invalid-settings');
    for (const [rawId, rawOverride] of Object.entries(value.buttonOverrides)) {
      if (!BUTTON_IDS.has(rawId)) continue;
      if (!plainObject(rawOverride)) return settingsError('invalid-settings');
      const override = { ...rawOverride } as Record<string, unknown>;
      for (const [field, fieldValue] of Object.entries(rawOverride)) {
        if (field === 'visible' && typeof fieldValue !== 'boolean') return settingsError('invalid-settings');
        if (field === 'label' && typeof fieldValue !== 'string') return settingsError('invalid-settings');
        if (field === 'color' && (typeof fieldValue !== 'string' || !/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(fieldValue))) {
          return settingsError('invalid-settings');
        }
        if (field === 'text' && (!INSERT_BUTTON_IDS.has(rawId) || typeof fieldValue !== 'string')) {
          return settingsError('invalid-settings');
        }
      }
      buttonOverrides[rawId] = override as ButtonOverride;
    }
  }

  const tabOverrides: Record<string, Readonly<{ visible?: boolean; [key: string]: unknown }>> = {};
  if (value.tabOverrides !== undefined) {
    if (!plainObject(value.tabOverrides)) return settingsError('invalid-settings');
    for (const [rawId, rawOverride] of Object.entries(value.tabOverrides)) {
      if (!TAB_IDS.has(rawId)) continue;
      if (!plainObject(rawOverride)) return settingsError('invalid-settings');
      if ('visible' in rawOverride && typeof rawOverride.visible !== 'boolean') return settingsError('invalid-settings');
      tabOverrides[rawId] = { ...rawOverride };
    }
  }

  const buttonOrder: Record<string, readonly string[]> = {};
  if (value.buttonOrder !== undefined) {
    if (!plainObject(value.buttonOrder)) return settingsError('invalid-settings');
    for (const [rawGroup, rawOrder] of Object.entries(value.buttonOrder)) {
      if (!GROUP_IDS.has(rawGroup as ButtonGroupId)) continue;
      const defaults = DEFAULT_BUTTONS.filter(({ groupId }) => groupId === rawGroup).map(({ id }) => id);
      const order = orderedIds(defaults, rawOrder);
      if (!order) return settingsError('invalid-settings');
      buttonOrder[rawGroup] = order;
    }
  }

  const tabOrder = orderedIds(DEFAULT_TABS.map(({ id }) => id), value.tabOrder);
  if (!tabOrder) return settingsError('invalid-settings');

  return {
    ok: true,
    settings: {
      ...value,
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      ...(value.buttonOverrides === undefined ? {} : { buttonOverrides }),
      ...(value.tabOverrides === undefined ? {} : { tabOverrides }),
      ...(value.buttonOrder === undefined ? {} : { buttonOrder }),
      ...(value.tabOrder === undefined ? {} : { tabOrder: tabOrder as TabId[] }),
    } as ExtensionSettings,
  };
}

export function isExtensionSettings(value: unknown): value is ExtensionSettings {
  return validateExtensionSettings(value).ok;
}

export function parseSettingsJson(json: string): SettingsValidationResult {
  try {
    return validateExtensionSettings(JSON.parse(json));
  } catch {
    return settingsError('malformed');
  }
}

export function serializeSettings(value: unknown): string {
  const result = validateExtensionSettings(value);
  if (!result.ok) throw new TypeError(`Invalid settings: ${result.reason}`);
  return `${JSON.stringify(result.settings, null, 2)}\n`;
}
