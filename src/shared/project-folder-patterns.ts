import { isProjectId } from './project-route.ts';

export const PROJECT_FOLDER_PATTERNS_STORAGE_KEY = 'chatPanelPlus.projectFolderPatterns.v1';
export const PROJECT_FOLDER_PATTERN_MAX_LENGTH = 512;
export const PROJECT_FOLDER_PATTERNS_PER_PROJECT_LIMIT = 64;

export type ProjectFolderPatternsLoadResult =
  | Readonly<{ ok: true; patternsByProject: Readonly<Record<string, readonly string[]>> }>
  | Readonly<{ ok: false; reason: 'corrupt-data' | 'storage-failed' }>;
export type ProjectFolderPatternsSaveResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: 'invalid-project' | 'invalid-pattern' | 'conflict' | 'corrupt-data' | 'storage-failed' }>;

type ParsedPath = Readonly<{ root: string; segments: readonly string[] }>;
export interface ProjectFolderPatternsStorageLike {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
export interface ProjectFolderPatternsLockLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

function invalidSegment(segment: string): boolean {
  return !segment || segment === '.' || segment === '..' || segment.endsWith('.') || segment.endsWith(' ')
    || segment.length > 255 || /[<>:"|]/u.test(segment) || hasControlCharacter(segment);
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
}

function parseAbsolutePath(value: unknown, allowWildcards: boolean): ParsedPath | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replaceAll('/', '\\');
  if (!raw || raw.length > PROJECT_FOLDER_PATTERN_MAX_LENGTH || hasControlCharacter(raw)
    || raw.startsWith('\\\\?\\') || raw.startsWith('\\\\.\\')) return null;

  let root: string;
  let tail: string;
  const drive = /^([a-z]):\\/iu.exec(raw);
  if (drive) {
    root = `${drive[1]!.toUpperCase()}:`;
    tail = raw.slice(3);
  } else if (raw.startsWith('\\\\')) {
    const parts = raw.slice(2).split('\\').filter(Boolean);
    const server = parts[0];
    const share = parts[1];
    if (!server || !share || invalidSegment(server) || invalidSegment(share)
      || /[*?]/u.test(server) || /[*?]/u.test(share)) return null;
    root = `\\\\${server}\\${share}`;
    tail = parts.slice(2).join('\\');
  } else return null;

  const segments = tail.split('\\').filter(Boolean);
  for (const segment of segments) {
    if (invalidSegment(segment)) return null;
    if (!allowWildcards && /[*?]/u.test(segment)) return null;
    if (allowWildcards && segment !== '**' && segment.includes('**')) return null;
  }
  return { root, segments };
}

export function normalizeProjectFolderPattern(value: unknown): string | null {
  const parsed = parseAbsolutePath(value, true);
  if (!parsed) return null;
  const path = `${parsed.root}\\${parsed.segments.join('\\')}`;
  return parsed.segments.length === 0 ? `${parsed.root}\\` : path;
}

function segmentMatches(pattern: string, value: string): boolean {
  const patternChars = Array.from(pattern.toLowerCase());
  const valueChars = Array.from(value.toLowerCase());
  let p = 0;
  let v = 0;
  let star = -1;
  let retry = -1;
  while (v < valueChars.length) {
    if (patternChars[p] === '?' || patternChars[p] === valueChars[v]) { p += 1; v += 1; }
    else if (patternChars[p] === '*') { star = p; p += 1; retry = v; }
    else if (star >= 0) { p = star + 1; retry += 1; v = retry; }
    else return false;
  }
  while (patternChars[p] === '*') p += 1;
  return p === patternChars.length;
}

function prefixMatches(pattern: readonly string[], path: readonly string[]): boolean {
  const memo = new Map<string, boolean>();
  const visit = (p: number, i: number): boolean => {
    const key = `${p}:${i}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let matched: boolean;
    if (p === pattern.length) matched = true;
    else if (pattern[p] === '**') matched = visit(p + 1, i) || (i < path.length && visit(p, i + 1));
    else matched = i < path.length && segmentMatches(pattern[p]!, path[i]!) && visit(p + 1, i + 1);
    memo.set(key, matched);
    return matched;
  };
  return visit(0, 0);
}

export function matchesProjectFolderPattern(pattern: string, cwd: string | null | undefined): boolean {
  const expected = parseAbsolutePath(pattern, true);
  const actual = parseAbsolutePath(cwd, false);
  return Boolean(expected && actual && expected.root.toLowerCase() === actual.root.toLowerCase()
    && prefixMatches(expected.segments, actual.segments));
}

export function filterThreadsByFolderPatterns<T extends Readonly<{ cwd?: string | null }>>(
  threads: readonly T[], patterns: readonly string[],
): readonly T[] {
  if (patterns.length === 0) return [];
  return threads.filter((thread) => patterns.some((pattern) => matchesProjectFolderPattern(pattern, thread.cwd)));
}

function normalizePatternList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > PROJECT_FOLDER_PATTERNS_PER_PROJECT_LIMIT) return null;
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const pattern = normalizeProjectFolderPattern(raw);
    if (!pattern) return null;
    const key = pattern.toLowerCase();
    if (!seen.has(key)) { seen.add(key); normalized.push(pattern); }
  }
  return normalized;
}

function normalizeStoredPatterns(value: unknown): Record<string, readonly string[]> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const stored = value as Record<string, unknown>;
  if (stored.version !== 1 || typeof stored.projects !== 'object' || stored.projects === null || Array.isArray(stored.projects)) return null;
  const result: Record<string, readonly string[]> = {};
  for (const [projectId, patternsValue] of Object.entries(stored.projects)) {
    if (!isProjectId(projectId)) return null;
    const patterns = normalizePatternList(patternsValue);
    if (!patterns) return null;
    const id = projectId.toLowerCase();
    if (result[id] && JSON.stringify(result[id]) !== JSON.stringify(patterns)) return null;
    result[id] = patterns;
  }
  return result;
}

function samePatterns(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((pattern, index) => pattern === right[index]);
}

export class ProjectFolderPatternsRepository {
  private readonly area: ProjectFolderPatternsStorageLike;
  private readonly locks?: ProjectFolderPatternsLockLike;
  private tail: Promise<void> = Promise.resolve();

  constructor(area: ProjectFolderPatternsStorageLike, locks?: ProjectFolderPatternsLockLike) {
    this.area = area;
    this.locks = locks;
  }

  async loadPatterns(): Promise<ProjectFolderPatternsLoadResult> {
    try {
      const stored = await this.area.get([PROJECT_FOLDER_PATTERNS_STORAGE_KEY]);
      const raw = stored[PROJECT_FOLDER_PATTERNS_STORAGE_KEY];
      if (raw === undefined) return { ok: true, patternsByProject: {} };
      const normalized = normalizeStoredPatterns(raw);
      return normalized ? { ok: true, patternsByProject: normalized } : { ok: false, reason: 'corrupt-data' };
    } catch { return { ok: false, reason: 'storage-failed' }; }
  }

  async savePatterns(projectId: string, expectedValue: readonly string[], nextValue: readonly string[]): Promise<ProjectFolderPatternsSaveResult> {
    if (!isProjectId(projectId)) return { ok: false, reason: 'invalid-project' };
    const expected = normalizePatternList(expectedValue);
    const next = normalizePatternList(nextValue);
    if (!expected || !next) return { ok: false, reason: 'invalid-pattern' };
    const save = () => this.saveUnderLock(projectId.toLowerCase(), expected, next);
    try {
      if (this.locks) return await this.locks.request(`${PROJECT_FOLDER_PATTERNS_STORAGE_KEY}.write`, save);
      const result = this.tail.then(save, save);
      this.tail = result.then(() => undefined, () => undefined);
      return await result;
    } catch { return { ok: false, reason: 'storage-failed' }; }
  }

  private async saveUnderLock(projectId: string, expected: readonly string[], next: readonly string[]): Promise<ProjectFolderPatternsSaveResult> {
    try {
      const stored = await this.area.get([PROJECT_FOLDER_PATTERNS_STORAGE_KEY]);
      const raw = stored[PROJECT_FOLDER_PATTERNS_STORAGE_KEY];
      const current = raw === undefined ? {} : normalizeStoredPatterns(raw);
      if (!current) return { ok: false, reason: 'corrupt-data' };
      const existing = current[projectId] ?? [];
      if (!samePatterns(existing, expected)) return { ok: false, reason: 'conflict' };
      await this.area.set({ [PROJECT_FOLDER_PATTERNS_STORAGE_KEY]: { version: 1, projects: { ...current, [projectId]: next } } });
      return { ok: true };
    } catch { return { ok: false, reason: 'storage-failed' }; }
  }
}

export function createChromeProjectFolderPatternsRepository(): ProjectFolderPatternsRepository {
  const locks = typeof navigator !== 'undefined' && navigator.locks
    ? { request: <T>(name: string, callback: () => Promise<T>) => navigator.locks.request(name, callback) }
    : undefined;
  return new ProjectFolderPatternsRepository(chrome.storage.local, locks);
}
