import { isProjectId, normalizeCachedProjectId } from './project-route.ts';

export const PROJECT_NAMES_STORAGE_KEY = 'chatPanelPlus.projectNames';

export interface ProjectNamesStorageAreaLike {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ProjectNamesLockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export type ProjectNamesLoadResult =
  | { readonly ok: true; readonly names: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly reason: 'corrupt-data' | 'storage-failed' };

export type ProjectNameSaveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'invalid-entry' | 'corrupt-data' | 'storage-failed' };

interface NormalizedProjectNames {
  readonly names: Readonly<Record<string, string>>;
  readonly storageNames: Readonly<Record<string, string>>;
  readonly needsMigration: boolean;
}

function normalizeName(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function normalizeProjectNames(value: unknown): NormalizedProjectNames | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const names: Record<string, string> = {};
  const storageNames: Record<string, string> = {};
  const canonicalNames = new Map<string, string>();
  const legacyNames = new Map<string, Array<{ storedId: string; name: string }>>();
  let needsMigration = false;

  for (const [storedId, projectName] of Object.entries(value)) {
    const projectId = normalizeCachedProjectId(storedId);
    if (!projectId || typeof projectName !== 'string' || !normalizeName(projectName)) return null;
    const normalizedName = normalizeName(projectName);
    if (normalizedName !== projectName) needsMigration = true;
    if (storedId === projectId) {
      canonicalNames.set(projectId, normalizedName);
    } else {
      const entries = legacyNames.get(projectId) ?? [];
      entries.push({ storedId, name: normalizedName });
      legacyNames.set(projectId, entries);
    }
  }

  const projectIds = new Set([...canonicalNames.keys(), ...legacyNames.keys()]);
  for (const projectId of projectIds) {
    const canonicalName = canonicalNames.get(projectId);
    const legacyEntries = legacyNames.get(projectId) ?? [];
    if (canonicalName !== undefined) {
      names[projectId] = canonicalName;
      storageNames[projectId] = canonicalName;
      if (legacyEntries.length > 0) needsMigration = true;
      continue;
    }

    const legacyValues = new Set(legacyEntries.map(({ name }) => name));
    if (legacyValues.size === 1) {
      const name = [...legacyValues][0]!;
      names[projectId] = name;
      storageNames[projectId] = name;
      needsMigration = true;
    } else {
      // Different old slugs are kept until a matching project DOM confirms the current name.
      for (const entry of legacyEntries) storageNames[entry.storedId] = entry.name;
    }
  }
  return { names, storageNames, needsMigration };
}

export class ProjectNamesRepository {
  private readonly area: ProjectNamesStorageAreaLike;
  private readonly locks?: ProjectNamesLockManagerLike;

  constructor(area: ProjectNamesStorageAreaLike, locks?: ProjectNamesLockManagerLike) {
    this.area = area;
    this.locks = locks;
  }

  async loadNames(): Promise<ProjectNamesLoadResult> {
    const load = async (): Promise<ProjectNamesLoadResult> => {
      try {
        const stored = await this.area.get([PROJECT_NAMES_STORAGE_KEY]);
        if (!(PROJECT_NAMES_STORAGE_KEY in stored)) return { ok: true, names: {} };
        const normalized = normalizeProjectNames(stored[PROJECT_NAMES_STORAGE_KEY]);
        if (!normalized) return { ok: false, reason: 'corrupt-data' };
        if (normalized.needsMigration) {
          try {
            await this.area.set({ [PROJECT_NAMES_STORAGE_KEY]: normalized.storageNames });
          } catch {
            // Keep the validated cache usable even if the best-effort migration write fails.
          }
        }
        return { ok: true, names: normalized.names };
      } catch {
        return { ok: false, reason: 'storage-failed' };
      }
    };

    try {
      return this.locks
        ? await this.locks.request(`${PROJECT_NAMES_STORAGE_KEY}.write`, load)
        : await load();
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }

  async saveName(projectId: string, projectName: string): Promise<ProjectNameSaveResult> {
    const normalizedName = normalizeName(projectName);
    if (!isProjectId(projectId) || !normalizedName) return { ok: false, reason: 'invalid-entry' };
    const canonicalId = projectId.toLowerCase();
    const save = () => this.saveUnderLock(canonicalId, normalizedName);
    try {
      return this.locks ? await this.locks.request(`${PROJECT_NAMES_STORAGE_KEY}.write`, save) : await save();
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }

  private async saveUnderLock(projectId: string, projectName: string): Promise<ProjectNameSaveResult> {
    try {
      const stored = await this.area.get([PROJECT_NAMES_STORAGE_KEY]);
      const current = PROJECT_NAMES_STORAGE_KEY in stored
        ? normalizeProjectNames(stored[PROJECT_NAMES_STORAGE_KEY])
        : { names: {}, storageNames: {}, needsMigration: false };
      if (!current) return { ok: false, reason: 'corrupt-data' };
      if (current.names[projectId] === projectName && !current.needsMigration) return { ok: true };
      const updatedNames: Record<string, string> = { ...current.storageNames };
      for (const storedId of Object.keys(updatedNames)) {
        if (normalizeCachedProjectId(storedId) === projectId) delete updatedNames[storedId];
      }
      updatedNames[projectId] = projectName;
      await this.area.set({
        [PROJECT_NAMES_STORAGE_KEY]: updatedNames,
      });
      return { ok: true };
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }
}

export function createChromeProjectNamesRepository(): ProjectNamesRepository {
  const locks = typeof navigator !== 'undefined' && navigator.locks
    ? { request: <T>(name: string, callback: () => Promise<T>) => navigator.locks.request(name, callback) }
    : undefined;
  return new ProjectNamesRepository(chrome.storage.local, locks);
}
