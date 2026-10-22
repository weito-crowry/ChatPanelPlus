import { DEFAULT_BUTTONS, DEFAULT_TABS, type ButtonGroupId, type TabId } from './default-ui.ts';
import {
  DEFAULT_SETTINGS,
  validateExtensionSettings,
  type ExtensionSettings,
} from './settings.ts';

export const CONFIG_STORAGE_KEY = 'chatPanelPlus.config';
export const VIEW_STATE_STORAGE_KEY = 'chatPanelPlus.viewState';

export interface StorageAreaLike {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface StorageChangesLike {
  addListener(listener: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void): void;
  removeListener(listener: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void): void;
}

export interface SettingsLockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface StoredViewState {
  readonly selectedTabId: TabId | null;
  readonly minimized: boolean;
}

export type SettingsLoadResult =
  | { readonly ok: true; readonly settings: ExtensionSettings }
  | { readonly ok: false; readonly reason: 'storage-failed' | 'corrupt-settings' };
export type SaveSettingsResult =
  | { readonly ok: true; readonly settings: ExtensionSettings }
  | { readonly ok: false; readonly reason: 'conflict' | 'storage-failed' | 'corrupt-settings' | 'invalid-draft'; readonly fields?: readonly string[] };

type Patch = { readonly path: readonly string[]; readonly before: unknown; readonly after: unknown };

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pathValue(settings: ExtensionSettings, path: readonly string[]): unknown {
  let value: unknown = settings;
  for (const segment of path) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function settingPaths(): string[][] {
  const paths: string[][] = [];
  for (const button of DEFAULT_BUTTONS) {
    for (const field of ['visible', 'label', 'color', ...(button.kind === 'insert' ? ['text'] : [])]) {
      paths.push(['buttonOverrides', button.id, field]);
    }
  }
  for (const tab of DEFAULT_TABS) paths.push(['tabOverrides', tab.id, 'visible']);
  const groups: ButtonGroupId[] = ['always', ...DEFAULT_TABS.map(({ id }) => id)];
  for (const group of groups) paths.push(['buttonOrder', group]);
  paths.push(['tabOrder']);
  return paths;
}

function patchesBetween(base: ExtensionSettings, draft: ExtensionSettings): Patch[] {
  return settingPaths().flatMap((path) => {
    const before = pathValue(base, path);
    const after = pathValue(draft, path);
    return same(before, after) ? [] : [{ path, before, after }];
  });
}

function replacementPatches(base: ExtensionSettings, draft: ExtensionSettings): Patch[] {
  return settingPaths().map((path) => ({
    path,
    before: pathValue(base, path),
    after: pathValue(draft, path),
  }));
}

function cloneSettings(settings: ExtensionSettings): Record<string, unknown> {
  return structuredClone(settings) as Record<string, unknown>;
}

function setPath(root: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let current = root;
  const parents: Array<{ object: Record<string, unknown>; key: string }> = [];
  for (const segment of path.slice(0, -1)) {
    const child = current[segment];
    if (typeof child !== 'object' || child === null || Array.isArray(child)) current[segment] = {};
    parents.push({ object: current, key: segment });
    current = current[segment] as Record<string, unknown>;
  }
  const leaf = path.at(-1);
  if (!leaf) return;
  if (value === undefined) delete current[leaf];
  else current[leaf] = structuredClone(value);
  for (const { object, key } of parents.reverse()) {
    const child = object[key];
    if (typeof child === 'object' && child !== null && !Array.isArray(child) && Object.keys(child).length === 0) delete object[key];
    else break;
  }
}

function readViewState(value: unknown): StoredViewState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  if (typeof state.minimized !== 'boolean') return null;
  const knownTabs = new Set(DEFAULT_TABS.map(({ id }) => id));
  const selected = state.selectedTabId;
  if (selected !== null && (typeof selected !== 'string' || !knownTabs.has(selected as TabId))) return null;
  return { selectedTabId: selected as TabId | null, minimized: state.minimized };
}

export class SettingsRepository {
  private readonly area: StorageAreaLike;
  private readonly changes?: StorageChangesLike;
  private readonly locks?: SettingsLockManagerLike;

  constructor(area: StorageAreaLike, changes?: StorageChangesLike, locks?: SettingsLockManagerLike) {
    this.area = area;
    this.changes = changes;
    this.locks = locks;
  }

  async loadSettings(): Promise<SettingsLoadResult> {
    try {
      const stored = await this.area.get([CONFIG_STORAGE_KEY]);
      if (!(CONFIG_STORAGE_KEY in stored)) return { ok: true, settings: DEFAULT_SETTINGS };
      const result = validateExtensionSettings(stored[CONFIG_STORAGE_KEY]);
      return result.ok ? { ok: true, settings: result.settings } : { ok: false, reason: 'corrupt-settings' };
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }

  async loadViewState(): Promise<{ readonly ok: true; readonly viewState: StoredViewState } | { readonly ok: false; readonly reason: 'storage-failed' | 'corrupt-view-state' }> {
    try {
      const stored = await this.area.get([VIEW_STATE_STORAGE_KEY]);
      if (!(VIEW_STATE_STORAGE_KEY in stored)) return { ok: true, viewState: { selectedTabId: null, minimized: false } };
      const viewState = readViewState(stored[VIEW_STATE_STORAGE_KEY]);
      return viewState ? { ok: true, viewState } : { ok: false, reason: 'corrupt-view-state' };
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }

  async saveViewState(viewState: StoredViewState): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: 'invalid-view-state' | 'storage-failed' }> {
    if (!readViewState(viewState)) return { ok: false, reason: 'invalid-view-state' };
    try {
      await this.area.set({ [VIEW_STATE_STORAGE_KEY]: viewState });
      return { ok: true };
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }

  async saveSettings(
    baseValue: unknown,
    draftValue: unknown,
    options: { readonly resetViewState?: StoredViewState; readonly replaceKnownFields?: boolean } = {},
  ): Promise<SaveSettingsResult> {
    const base = validateExtensionSettings(baseValue);
    const draft = validateExtensionSettings(draftValue);
    if (!base.ok || !draft.ok) return { ok: false, reason: 'invalid-draft' };
    try {
      // Web Locks serialize callers sharing this manager; chrome.storage has no CAS for writers outside it.
      const save = () => this.saveSettingsUnderLock(base.settings, draft.settings, options);
      return this.locks ? await this.locks.request('chatPanelPlus.config.write', save) : await save();
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }

  private async saveSettingsUnderLock(
    base: ExtensionSettings,
    draft: ExtensionSettings,
    options: { readonly resetViewState?: StoredViewState; readonly replaceKnownFields?: boolean },
  ): Promise<SaveSettingsResult> {
    try {
      const stored = await this.area.get([CONFIG_STORAGE_KEY]);
      const latestValue = CONFIG_STORAGE_KEY in stored ? stored[CONFIG_STORAGE_KEY] : DEFAULT_SETTINGS;
      const latest = validateExtensionSettings(latestValue);
      if (!latest.ok) return { ok: false, reason: 'corrupt-settings' };
      const patches = options.replaceKnownFields
        ? replacementPatches(base, draft)
        : patchesBetween(base, draft);
      const conflicts = patches.filter((patch) => {
        const current = pathValue(latest.settings, patch.path);
        return !same(current, patch.before) && !same(current, patch.after);
      });
      if (conflicts.length) {
        return { ok: false, reason: 'conflict', fields: conflicts.map(({ path }) => path.join('.')) };
      }
      const merged = cloneSettings(latest.settings);
      for (const patch of patches) setPath(merged, patch.path, patch.after);
      const validated = validateExtensionSettings(merged);
      if (!validated.ok) return { ok: false, reason: 'invalid-draft' };
      // resetViewState is a deliberate second-key write and may be last-writer-wins with saveViewState.
      await this.area.set({
        [CONFIG_STORAGE_KEY]: validated.settings,
        ...(options.resetViewState ? { [VIEW_STATE_STORAGE_KEY]: options.resetViewState } : {}),
      });
      return { ok: true, settings: validated.settings };
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }

  subscribeSettings(listener: (settings: ExtensionSettings) => void): () => void {
    if (!this.changes) return () => {};
    const handler = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local' || !(CONFIG_STORAGE_KEY in changes)) return;
      const value = changes[CONFIG_STORAGE_KEY]?.newValue;
      if (value === undefined) {
        listener(DEFAULT_SETTINGS);
        return;
      }
      const result = validateExtensionSettings(value);
      if (result.ok) listener(result.settings);
    };
    this.changes.addListener(handler);
    return () => this.changes?.removeListener(handler);
  }

  subscribeViewState(listener: (viewState: StoredViewState) => void): () => void {
    if (!this.changes) return () => {};
    const handler = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local' || !(VIEW_STATE_STORAGE_KEY in changes)) return;
      const value = changes[VIEW_STATE_STORAGE_KEY]?.newValue;
      if (value === undefined) listener({ selectedTabId: null, minimized: false });
      else {
        const viewState = readViewState(value);
        if (viewState) listener(viewState);
      }
    };
    this.changes.addListener(handler);
    return () => this.changes?.removeListener(handler);
  }

}

export function createChromeSettingsRepository(): SettingsRepository {
  const locks = typeof navigator !== 'undefined' && navigator.locks
    ? { request: <T>(name: string, callback: () => Promise<T>) => navigator.locks.request(name, () => callback()) }
    : undefined;
  return new SettingsRepository(chrome.storage.local, chrome.storage.onChanged, locks);
}
