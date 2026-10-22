import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STATISTICS_STORAGE_KEY,
  createStatisticsStore,
  mergeConversationStatistics,
} from '../src/shared/conversation-statistics.ts';
import {
  ConversationStatisticsRepository,
  type StatisticsStorageAreaLike,
} from '../src/shared/conversation-statistics-repository.ts';
import { ConversationStatisticsSession } from '../src/content/conversation-statistics-session.ts';

function createStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  let writes = 0;
  let failWrites = false;
  const area: StatisticsStorageAreaLike = {
    async get(keys) {
      return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(items) {
      writes += 1;
      if (failWrites) throw new Error('quota');
      Object.assign(data, items);
    },
  };
  return {
    area,
    data,
    get writes() { return writes; },
    set failWrites(value: boolean) { failWrites = value; },
  };
}

function statisticsFor(conversationId: string, turnKey: string, inputChars: number) {
  return mergeConversationStatistics(createStatisticsStore(), conversationId, [turnKey], [{ turnKey, inputChars }], 'manual')
    .conversations[conversationId]!;
}

test('新しい専用keyで保存・復元し、既存設定キーを変更しない', async () => {
  const fake = createStorage({ 'chatPanelPlus.config': { schemaVersion: 1, keep: true } });
  const repository = new ConversationStatisticsRepository(fake.area);
  assert.deepEqual(await repository.loadStore(), { ok: true, store: createStatisticsStore() });
  const initialConversation = statisticsFor('conversation-a', 'turn-1', 4);
  assert.deepEqual(await repository.saveConversation('conversation-a', initialConversation), { ok: true, conversation: initialConversation });

  assert.deepEqual(fake.data['chatPanelPlus.config'], { schemaVersion: 1, keep: true });
  assert.equal(STATISTICS_STORAGE_KEY in fake.data, true);
  const restored = await repository.loadStore();
  assert.equal(restored.ok, true);
  if (restored.ok) assert.equal(restored.store.conversations['conversation-a']?.turns['turn-1']?.inputChars, 4);
});

test('別会話への逐次保存で既存会話を保持し、同一値は再書込しない', async () => {
  const fake = createStorage();
  const repository = new ConversationStatisticsRepository(fake.area);
  await repository.saveConversation('conversation-a', statisticsFor('conversation-a', 'turn-a', 4));
  await repository.saveConversation('conversation-b', statisticsFor('conversation-b', 'turn-b', 9));
  const writesBeforeNoop = fake.writes;
  await repository.saveConversation('conversation-b', statisticsFor('conversation-b', 'turn-b', 9));

  assert.equal(fake.writes, writesBeforeNoop);
  const restored = await repository.loadStore();
  assert.equal(restored.ok, true);
  if (restored.ok) assert.deepEqual(Object.keys(restored.store.conversations).sort(), ['conversation-a', 'conversation-b']);
});

test('古い会話スナップショットの保存中に追加されたTurn Keyを保持する', async () => {
  const fake = createStorage();
  const seed = new ConversationStatisticsRepository(fake.area);
  await seed.saveConversation('conversation-a', statisticsFor('conversation-a', 'turn-old', 5));

  const staleRepository = new ConversationStatisticsRepository(fake.area);
  const stale = await staleRepository.loadStore();
  assert.equal(stale.ok, true);
  if (!stale.ok) return;

  const concurrentRepository = new ConversationStatisticsRepository(fake.area);
  const latest = await concurrentRepository.loadStore();
  assert.equal(latest.ok, true);
  if (!latest.ok) return;
  const updated = mergeConversationStatistics(latest.store, 'conversation-a', ['turn-old', 'turn-new'], [
    { turnKey: 'turn-old', inputChars: 5 },
    { turnKey: 'turn-new', inputChars: 4 },
  ], 'manual').conversations['conversation-a']!;
  assert.equal((await concurrentRepository.saveConversation('conversation-a', updated)).ok, true);
  assert.equal((await staleRepository.saveConversation('conversation-a', stale.store.conversations['conversation-a']!)).ok, true);

  const saved = await staleRepository.loadStore();
  assert.equal(saved.ok, true);
  if (saved.ok) {
    assert.equal(saved.store.conversations['conversation-a']?.turns['turn-new']?.inputChars, 4);
    assert.equal(saved.store.conversations['conversation-a']?.turns['turn-old']?.inputChars, 5);
  }
});

test('同じ基準から競合更新された同一Turn Keyは先にStorageへ確定した値を保持する', async () => {
  const fake = createStorage();
  const seed = new ConversationStatisticsRepository(fake.area);
  await seed.saveConversation('conversation-a', statisticsFor('conversation-a', 'turn-a', 5));

  const staleRepository = new ConversationStatisticsRepository(fake.area);
  const stale = await staleRepository.loadStore();
  const currentRepository = new ConversationStatisticsRepository(fake.area);
  const current = await currentRepository.loadStore();
  assert.equal(stale.ok, true);
  assert.equal(current.ok, true);
  if (!stale.ok || !current.ok) return;

  const newer = mergeConversationStatistics(current.store, 'conversation-a', ['turn-a'], [
    { turnKey: 'turn-a', inputChars: 9 },
  ], 'manual').conversations['conversation-a']!;
  const staleUpdate = mergeConversationStatistics(stale.store, 'conversation-a', ['turn-a'], [
    { turnKey: 'turn-a', inputChars: 8 },
  ], 'manual').conversations['conversation-a']!;
  assert.equal((await currentRepository.saveConversation('conversation-a', newer)).ok, true);
  assert.equal((await staleRepository.saveConversation('conversation-a', staleUpdate)).ok, true);

  const afterConflict = await staleRepository.loadStore();
  assert.equal(afterConflict.ok, true);
  if (afterConflict.ok) assert.equal(afterConflict.store.conversations['conversation-a']?.turns['turn-a']?.inputChars, 9);

  const corrected = mergeConversationStatistics(afterConflict.ok ? afterConflict.store : createStatisticsStore(), 'conversation-a', ['turn-a'], [
    { turnKey: 'turn-a', inputChars: 3 },
  ], 'manual').conversations['conversation-a']!;
  assert.equal((await staleRepository.saveConversation('conversation-a', corrected)).ok, true);

  const saved = await staleRepository.loadStore();
  assert.equal(saved.ok, true);
  if (saved.ok) assert.equal(saved.store.conversations['conversation-a']?.turns['turn-a']?.inputChars, 3);
});

test('競合後にSessionへ統合値を反映し、次ターンの保存で先行値を巻き戻さない', async () => {
  const fake = createStorage();
  const seed = new ConversationStatisticsRepository(fake.area);
  await seed.saveConversation('conversation-a', statisticsFor('conversation-a', 'turn-a', 5));

  const staleRepository = new ConversationStatisticsRepository(fake.area);
  const stale = await staleRepository.loadStore();
  const concurrentRepository = new ConversationStatisticsRepository(fake.area);
  const concurrent = await concurrentRepository.loadStore();
  assert.equal(stale.ok, true);
  assert.equal(concurrent.ok, true);
  if (!stale.ok || !concurrent.ok) return;

  const session = new ConversationStatisticsSession('conversation-a', stale.store, ['turn-a'], [
    { turnKey: 'turn-a', inputChars: 5 },
  ]);
  const newer = mergeConversationStatistics(concurrent.store, 'conversation-a', ['turn-a'], [
    { turnKey: 'turn-a', inputChars: 9 },
  ], 'manual').conversations['conversation-a']!;
  assert.equal((await concurrentRepository.saveConversation('conversation-a', newer)).ok, true);

  session.recount(['turn-a'], [{ turnKey: 'turn-a', inputChars: 8 }]);
  const firstSnapshot = session.conversation()!;
  const firstSave = await staleRepository.saveConversation('conversation-a', firstSnapshot);
  assert.equal(firstSave.ok, true);
  if (!firstSave.ok) return;
  session.confirmPersisted(firstSnapshot, firstSave.conversation);

  session.recount(['turn-a', 'turn-b'], [{ turnKey: 'turn-b', inputChars: 2 }]);
  assert.equal((await staleRepository.saveConversation('conversation-a', session.conversation()!)).ok, true);

  const saved = await new ConversationStatisticsRepository(fake.area).loadStore();
  assert.equal(saved.ok, true);
  if (saved.ok) {
    assert.equal(saved.store.conversations['conversation-a']?.turns['turn-a']?.inputChars, 9);
    assert.equal(saved.store.conversations['conversation-a']?.turns['turn-b']?.inputChars, 2);
  }
});

test('保存失敗を結果として返し、メモリ状態と保存済み状態を区別できる', async () => {
  const fake = createStorage();
  fake.failWrites = true;
  const repository = new ConversationStatisticsRepository(fake.area);
  assert.deepEqual(await repository.saveConversation('conversation-a', statisticsFor('conversation-a', 'turn-a', 3)), {
    ok: false, reason: 'storage-failed',
  });
  assert.equal(STATISTICS_STORAGE_KEY in fake.data, false);
});

test('既存データを含む保存が失敗してもStorageの内容を変更しない', async () => {
  const initial = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['turn-a'], [
    { turnKey: 'turn-a', inputChars: 5, assistantMessageId: 'answer-a', outputChars: 7 },
  ], 'manual');
  const fake = createStorage({ [STATISTICS_STORAGE_KEY]: initial });
  const previous = fake.data[STATISTICS_STORAGE_KEY];
  const repository = new ConversationStatisticsRepository(fake.area);
  await repository.loadStore();
  fake.failWrites = true;

  assert.deepEqual(await repository.saveConversation('conversation-a', statisticsFor('conversation-a', 'turn-b', 3)), {
    ok: false, reason: 'storage-failed',
  });
  assert.equal(fake.data[STATISTICS_STORAGE_KEY], previous);
});

test('容量エラー後の同一ID再試行は置換保存となり、文字数を重複加算しない', async () => {
  const fake = createStorage();
  const repository = new ConversationStatisticsRepository(fake.area);
  const conversation = statisticsFor('conversation-a', 'turn-a', 3);
  fake.failWrites = true;
  assert.equal((await repository.saveConversation('conversation-a', conversation)).ok, false);
  fake.failWrites = false;
  assert.equal((await repository.saveConversation('conversation-a', conversation)).ok, true);
  const restored = await repository.loadStore();
  assert.equal(restored.ok, true);
  if (restored.ok) assert.equal(restored.store.conversations['conversation-a']?.turns['turn-a']?.inputChars, 3);
});

test('破損・未知バージョンは上書きしない', async () => {
  for (const stored of [
    { schemaVersion: 1, conversations: { 'conversation-a': { turnOrder: ['turn-a'], turns: { 'turn-a': { body: 'private' } } } } },
    { schemaVersion: 2, conversations: {} },
  ]) {
    const fake = createStorage({ [STATISTICS_STORAGE_KEY]: stored });
    const repository = new ConversationStatisticsRepository(fake.area);
    const loaded = await repository.loadStore();
    assert.equal(loaded.ok, false);
    assert.deepEqual(await repository.saveConversation('conversation-b', statisticsFor('conversation-b', 'turn-b', 1)), {
      ok: false, reason: stored.schemaVersion === 2 ? 'unsupported-version' : 'corrupt-data',
    });
    assert.equal(fake.writes, 0);
    assert.deepEqual(fake.data[STATISTICS_STORAGE_KEY], stored);
  }
});
