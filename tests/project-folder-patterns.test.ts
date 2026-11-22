import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROJECT_FOLDER_PATTERNS_STORAGE_KEY,
  ProjectFolderPatternsRepository,
  filterThreadsByFolderPatterns,
  matchesProjectFolderPattern,
  normalizeProjectFolderPattern,
} from '../src/shared/project-folder-patterns.ts';
import { PROJECT_ALPHA_ID, PROJECT_BETA_ID } from './project-dom-fixture.ts';

class FakeStorage {
  readonly data: Record<string, unknown>;
  constructor(data: Record<string, unknown> = {}) { this.data = data; }
  async get(keys: string[]) { return Object.fromEntries(keys.filter((key) => key in this.data).map((key) => [key, this.data[key]])); }
  async set(items: Record<string, unknown>) { Object.assign(this.data, items); }
}

test('Windows drive paths normalize separators and wildcard patterns match directory descendants by boundary', () => {
  assert.equal(normalizeProjectFolderPattern(' d:/Projects/FX-* '), 'D:\\Projects\\FX-*');
  assert.equal(matchesProjectFolderPattern('d:/projects/fx-*', 'D:\\Projects\\FX-LLM\\src'), true);
  assert.equal(matchesProjectFolderPattern('D:\\Projects\\FX', 'D:\\Projects\\FX-LLM'), false);
  assert.equal(matchesProjectFolderPattern('D:\\Projects\\FX', 'd:/projects/fx/src'), true);
});

test('double-star matches zero or more path segments and question-mark matches one character', () => {
  assert.equal(matchesProjectFolderPattern('D:\\Work\\**\\src', 'D:\\Work\\src\\main'), true);
  assert.equal(matchesProjectFolderPattern('D:\\Work\\**\\src', 'D:\\Work\\A\\B\\src'), true);
  assert.equal(matchesProjectFolderPattern('D:\\Work\\A?\\src', 'D:\\Work\\AB\\src'), true);
  assert.equal(matchesProjectFolderPattern('D:\\Work\\A?\\src', 'D:\\Work\\AAB\\src'), false);
});

test('UNC paths work and null cwd never matches', () => {
  assert.equal(matchesProjectFolderPattern('\\\\server\\share\\repo-*', '\\\\SERVER\\SHARE\\Repo-One\\src'), true);
  assert.equal(matchesProjectFolderPattern('\\\\server\\share\\repo-*', null), false);
});

test('relative paths, traversal, device paths, malformed glob segments, and long patterns are rejected', () => {
  for (const pattern of ['relative\\repo', 'D:\\A\\..\\B', 'D:\\A\\.\\B', '\\\\?\\D:\\secret', 'D:\\Work\\ab**cd']) {
    assert.equal(normalizeProjectFolderPattern(pattern), null, pattern);
  }
  assert.equal(normalizeProjectFolderPattern(`D:\\${'x'.repeat(520)}`), null);
});

test('thread filtering is OR across patterns, works only on acquired cwd values, and leaves source rows intact', () => {
  const rows = [
    { id: 'a', cwd: 'D:\\Projects\\FX-LLM\\src' },
    { id: 'b', cwd: '\\\\server\\share\\Other' },
    { id: 'c', cwd: null },
  ];
  const result = filterThreadsByFolderPatterns(rows, ['D:\\Projects\\FX-*', '\\\\server\\share\\Allowed']);
  assert.deepEqual(result.map(({ id }) => id), ['a']);
  assert.deepEqual(rows.map(({ id }) => id), ['a', 'b', 'c']);
  assert.deepEqual(filterThreadsByFolderPatterns(rows, []), []);
});

test('folder patterns use a separate project-ID key and merge concurrent project saves without overwriting names', async () => {
  const storage = new FakeStorage({ 'chatPanelPlus.projectNames': { [PROJECT_ALPHA_ID]: 'Alpha' } });
  const repository = new ProjectFolderPatternsRepository(storage);
  assert.deepEqual(await repository.savePatterns(PROJECT_ALPHA_ID, [], ['D:\\A', 'D:\\B']), { ok: true });
  assert.deepEqual(await repository.savePatterns(PROJECT_BETA_ID, [], ['\\\\server\\share\\Beta']), { ok: true });
  assert.deepEqual(storage.data['chatPanelPlus.projectNames'], { [PROJECT_ALPHA_ID]: 'Alpha' });
  assert.deepEqual(await repository.loadPatterns(), {
    ok: true,
    patternsByProject: { [PROJECT_ALPHA_ID]: ['D:\\A', 'D:\\B'], [PROJECT_BETA_ID]: ['\\\\server\\share\\Beta'] },
  });
  assert.equal(PROJECT_FOLDER_PATTERNS_STORAGE_KEY, 'chatPanelPlus.projectFolderPatterns.v1');
});

test('same-project stale Options drafts conflict and corrupt storage is never overwritten', async () => {
  const storage = new FakeStorage();
  const repository = new ProjectFolderPatternsRepository(storage);
  assert.deepEqual(await repository.savePatterns(PROJECT_ALPHA_ID, [], ['D:\\A']), { ok: true });
  assert.deepEqual(await repository.savePatterns(PROJECT_ALPHA_ID, [], ['D:\\B']), { ok: false, reason: 'conflict' });
  storage.data[PROJECT_FOLDER_PATTERNS_STORAGE_KEY] = { version: 1, projects: 'broken' };
  assert.deepEqual(await repository.savePatterns(PROJECT_ALPHA_ID, ['D:\\A'], ['D:\\C']), { ok: false, reason: 'corrupt-data' });
  assert.deepEqual(storage.data[PROJECT_FOLDER_PATTERNS_STORAGE_KEY], { version: 1, projects: 'broken' });
});
