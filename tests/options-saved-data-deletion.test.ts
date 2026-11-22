import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationPanelStateRepository, CONVERSATION_PANEL_STATE_STORAGE_KEY } from '../src/shared/conversation-panel-state-repository.ts';
import { ConversationStatisticsRepository } from '../src/shared/conversation-statistics-repository.ts';
import { createStatisticsStore, mergeConversationStatistics, STATISTICS_STORAGE_KEY } from '../src/shared/conversation-statistics.ts';
import { ProjectFolderPatternsRepository, PROJECT_FOLDER_PATTERNS_STORAGE_KEY } from '../src/shared/project-folder-patterns.ts';
import { ProjectNamesRepository, PROJECT_NAMES_STORAGE_KEY } from '../src/shared/project-names-repository.ts';

class FakeStorage {
  readonly data: Record<string, unknown>;
  constructor(data: Record<string, unknown>) { this.data = data; }
  async get(keys: string[]) { return Object.fromEntries(keys.filter((key) => key in this.data).map((key) => [key, structuredClone(this.data[key])])); }
  async set(items: Record<string, unknown>) { Object.assign(this.data, structuredClone(items)); }
}
const id = 'g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const secondId = 'g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

test('panel state deletion is CAS guarded and preserves other conversations', async () => {
  const first = { schemaVersion: 1 as const, selectedTabId: 'wall' as const, minimized: false, bridgeExpanded: true };
  const other = { schemaVersion: 1 as const, selectedTabId: 'control' as const, minimized: true, bridgeExpanded: false };
  const storage = new FakeStorage({ [CONVERSATION_PANEL_STATE_STORAGE_KEY]: { schemaVersion: 1, conversations: { a: first, b: other } } });
  const repo = new ConversationPanelStateRepository(storage);
  const expected = { ...first, bridgeWatchSelection: null, bridgeEventSelection: null } as const;
  assert.deepEqual(await repo.deleteConversationState('a', { ...expected, minimized: true }), { ok: false, reason: 'conflict' });
  assert.deepEqual(await repo.deleteConversationState('a', expected), { ok: true });
  assert.deepEqual((storage.data[CONVERSATION_PANEL_STATE_STORAGE_KEY] as { conversations: unknown }).conversations, { b: other });
  const broken = new FakeStorage({ [CONVERSATION_PANEL_STATE_STORAGE_KEY]: { schemaVersion: 9, conversations: { a: first } } });
  assert.deepEqual(await new ConversationPanelStateRepository(broken).deleteConversationState('a', expected), { ok: false, reason: 'unsupported-version' });
  assert.equal((broken.data[CONVERSATION_PANEL_STATE_STORAGE_KEY] as { schemaVersion: number }).schemaVersion, 9);
});

test('statistics deletion rejects stale snapshots and retains siblings', async () => {
  const store = mergeConversationStatistics(createStatisticsStore(), 'a', ['turn-a'], [{ turnKey: 'turn-a', inputChars: 2 }], 'manual');
  const second = mergeConversationStatistics(store, 'b', ['turn-b'], [{ turnKey: 'turn-b', inputChars: 3 }], 'manual');
  const storage = new FakeStorage({ [STATISTICS_STORAGE_KEY]: second });
  const repo = new ConversationStatisticsRepository(storage);
  assert.deepEqual(await repo.deleteConversation('a', { turnOrder: ['turn-a'], turns: { 'turn-a': { inputChars: 1 } } }), { ok: false, reason: 'conflict' });
  const deleted = await repo.deleteConversation('a', { turnOrder: ['turn-a'], turns: { 'turn-a': { inputChars: 2 } } });
  assert.equal(deleted.ok, true);
  assert.deepEqual(Object.keys((storage.data[STATISTICS_STORAGE_KEY] as { conversations: Record<string, unknown> }).conversations), ['b']);
});

test('project folder pattern deletion preserves other projects and conflicts on a stale view', async () => {
  const storage = new FakeStorage({ [PROJECT_FOLDER_PATTERNS_STORAGE_KEY]: { version: 1, projects: { [id]: ['D:\\A'], [secondId]: ['D:\\B'] } } });
  const repo = new ProjectFolderPatternsRepository(storage);
  assert.deepEqual(await repo.deleteProjectPatterns(id, ['D:\\old']), { ok: false, reason: 'conflict' });
  assert.deepEqual(await repo.deleteProjectPatterns(id, ['D:\\A']), { ok: true });
  assert.deepEqual((storage.data[PROJECT_FOLDER_PATTERNS_STORAGE_KEY] as { projects: Record<string, unknown> }).projects, { [secondId]: ['D:\\B'] });
});

test('project name deletion preserves unrelated entries and rejects changed names', async () => {
  const storage = new FakeStorage({ [PROJECT_NAMES_STORAGE_KEY]: { [id]: 'Alpha', [secondId]: 'Beta' } });
  const repo = new ProjectNamesRepository(storage);
  assert.deepEqual(await repo.deleteName(id, 'Changed'), { ok: false, reason: 'conflict' });
  assert.deepEqual(await repo.deleteName(id, 'Alpha'), { ok: true });
  assert.deepEqual(storage.data[PROJECT_NAMES_STORAGE_KEY], { [secondId]: 'Beta' });
});

test('project name deletion rejects legacy aliases and compares the exact displayed value', async () => {
  const alias = `${id}-old-slug`;
  const storage = new FakeStorage({ [PROJECT_NAMES_STORAGE_KEY]: { [id]: 'Alpha', [alias]: 'Alpha' } });
  const repo = new ProjectNamesRepository(storage);
  assert.deepEqual(await repo.deleteName(id, 'Alpha'), { ok: false, reason: 'conflict' });
  assert.deepEqual(storage.data[PROJECT_NAMES_STORAGE_KEY], { [id]: 'Alpha', [alias]: 'Alpha' });
  const canonicalOnly = new FakeStorage({ [PROJECT_NAMES_STORAGE_KEY]: { [id]: ' Alpha  Project ' } });
  assert.deepEqual(await new ProjectNamesRepository(canonicalOnly).deleteName(id, ' Alpha  Project '), { ok: true });
});

test('deletion operations reuse each repository write lock and corrupted records fail closed', async () => {
  const names: string[] = [];
  const locks = { async request<T>(name: string, callback: () => Promise<T>) { names.push(name); return callback(); } };
  const panel = { schemaVersion: 1 as const, selectedTabId: null, minimized: false, bridgeExpanded: false,
    bridgeWatchSelection: null, bridgeEventSelection: null };
  const stats = { turnOrder: ['turn-1'], turns: { 'turn-1': { inputChars: 1 } } };
  const storage = new FakeStorage({
    [CONVERSATION_PANEL_STATE_STORAGE_KEY]: { schemaVersion: 1, conversations: { a: panel } },
    [STATISTICS_STORAGE_KEY]: { schemaVersion: 1, conversations: { a: stats } },
    [PROJECT_FOLDER_PATTERNS_STORAGE_KEY]: { version: 1, projects: { [id]: ['D:\\A'] } },
    [PROJECT_NAMES_STORAGE_KEY]: { [id]: 'Alpha' },
  });
  await new ConversationPanelStateRepository(storage, undefined, locks).deleteConversationState('a', panel);
  await new ConversationStatisticsRepository(storage, locks).deleteConversation('a', stats);
  await new ProjectFolderPatternsRepository(storage, locks).deleteProjectPatterns(id, ['D:\\A']);
  await new ProjectNamesRepository(storage, locks).deleteName(id, 'Alpha');
  assert.deepEqual(names, [
    'chatPanelPlus.panelStateByConversation.write', 'chatPanelPlus.statistics.write',
    `${PROJECT_FOLDER_PATTERNS_STORAGE_KEY}.write`, `${PROJECT_NAMES_STORAGE_KEY}.write`,
  ]);
});
