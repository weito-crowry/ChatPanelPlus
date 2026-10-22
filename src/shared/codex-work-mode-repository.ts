export const CODEX_WORK_MODE_STORAGE_KEY = 'chatPanelPlus.codexWorkMode';

export type CodexWorkModeValue = Readonly<{
  schemaVersion: 1;
  enabled: boolean;
}>;

export type CodexWorkModeReadResult =
  | { readonly ok: true; readonly value: CodexWorkModeValue; readonly saved: boolean }
  | { readonly ok: false; readonly reason: 'invalid-data' | 'storage-error' };

export type CodexWorkModeWriteResult =
  | { readonly ok: true; readonly value: CodexWorkModeValue }
  | { readonly ok: false; readonly reason: 'storage-error' };

export interface CodexWorkModeStorageAreaLike {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface CodexWorkModeChangesLike {
  addListener(listener: (changes: Record<string, { readonly oldValue?: unknown; readonly newValue?: unknown }>, areaName: string) => void): void;
  removeListener(listener: (changes: Record<string, { readonly oldValue?: unknown; readonly newValue?: unknown }>, areaName: string) => void): void;
}

const OFF_VALUE: CodexWorkModeValue = Object.freeze({ schemaVersion: 1, enabled: false });

export function validateCodexWorkMode(value: unknown):
  | { readonly ok: true; readonly value: CodexWorkModeValue }
  | { readonly ok: false; readonly reason: 'invalid-data' } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'invalid-data' };
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 || typeof candidate.enabled !== 'boolean') {
    return { ok: false, reason: 'invalid-data' };
  }
  return { ok: true, value: { schemaVersion: 1, enabled: candidate.enabled } };
}

export class CodexWorkModeRepository {
  private readonly subscribers = new Set<(result: CodexWorkModeReadResult) => void>();
  private readonly area: CodexWorkModeStorageAreaLike;
  private readonly changes: CodexWorkModeChangesLike;

  constructor(
    area: CodexWorkModeStorageAreaLike,
    changes: CodexWorkModeChangesLike,
  ) {
    this.area = area;
    this.changes = changes;
  }

  async load(): Promise<CodexWorkModeReadResult> {
    try {
      const stored = await this.area.get(CODEX_WORK_MODE_STORAGE_KEY);
      if (!(CODEX_WORK_MODE_STORAGE_KEY in stored)) return { ok: true, value: OFF_VALUE, saved: false };
      const result = validateCodexWorkMode(stored[CODEX_WORK_MODE_STORAGE_KEY]);
      return result.ok ? { ...result, saved: true } : result;
    } catch {
      return { ok: false, reason: 'storage-error' };
    }
  }

  async setEnabled(enabled: boolean): Promise<CodexWorkModeWriteResult> {
    if (typeof enabled !== 'boolean') return { ok: false, reason: 'storage-error' };
    const value: CodexWorkModeValue = { schemaVersion: 1, enabled };
    try {
      await this.area.set({ [CODEX_WORK_MODE_STORAGE_KEY]: value });
      return { ok: true, value };
    } catch {
      return { ok: false, reason: 'storage-error' };
    }
  }

  subscribe(listener: (result: CodexWorkModeReadResult) => void): () => void {
    const firstSubscriber = this.subscribers.size === 0;
    this.subscribers.add(listener);
    if (firstSubscriber) this.changes.addListener(this.handleStorageChange);
    return () => {
      this.subscribers.delete(listener);
      if (this.subscribers.size === 0) this.changes.removeListener(this.handleStorageChange);
    };
  }

  private readonly handleStorageChange = (
    changed: Record<string, { readonly oldValue?: unknown; readonly newValue?: unknown }>,
    areaName: string,
  ) => {
    if (areaName !== 'local' || !(CODEX_WORK_MODE_STORAGE_KEY in changed)) return;
    const value = changed[CODEX_WORK_MODE_STORAGE_KEY]?.newValue;
    const result = value === undefined
      ? { ok: true as const, value: OFF_VALUE, saved: false }
      : (() => {
        const validated = validateCodexWorkMode(value);
        return validated.ok ? { ...validated, saved: true } : validated;
      })();
    this.subscribers.forEach((subscriber) => subscriber(result));
  };
}

export function createChromeCodexWorkModeRepository(): CodexWorkModeRepository {
  return new CodexWorkModeRepository(chrome.storage.local, chrome.storage.onChanged);
}
