import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStatisticsStore,
  mergeConversationStatistics,
  type StoredConversationStatistics,
} from '../src/shared/conversation-statistics.ts';
import { harness, settle, turn } from './conversation-statistics-controller-fixture.ts';

test('保存待ちの手動再集計後にSPA往復しても新active順と旧台帳行を維持する', async () => {
  const conversationId = 'recount-rebase-race';
  const storedOrder = ['A'];
  const activeOrder = ['B', 'C', 'D', 'E'];
  const staleStorage = mergeConversationStatistics(createStatisticsStore(), conversationId, storedOrder, [
    { turnKey: 'A', inputChars: 1, assistantMessageId: 'answer-A', outputChars: 2 },
  ], 'manual');
  let resolveSave!: (result: { ok: true; conversation: StoredConversationStatistics }) => void;
  let saveCalls = 0;
  let savingConversation: StoredConversationStatistics | undefined;
  const pendingSave = new Promise<{ ok: true; conversation: StoredConversationStatistics }>((resolve) => { resolveSave = resolve; });
  const h = harness(`/c/${conversationId}`, false, staleStorage, {
    loadStore: async () => ({ ok: true, store: staleStorage }),
    saveConversation: async (_id, conversation) => {
      saveCalls += 1;
      savingConversation = conversation;
      return pendingSave;
    },
  });
  h.document.root.append(...activeOrder.map((key) => turn(key, `input-${key}`, `output-${key}`, `answer-${key}`)));
  h.controller.start();
  await settle();
  assert.equal(h.latestState()?.aggregate.turns, 1);

  const recount = h.controller.recount();
  h.window.runTimeouts();
  await recount;
  assert.equal(h.latestState()?.aggregate.turns, 5);
  h.window.runTimeouts();
  assert.equal(saveCalls, 1);

  try {
    const repeatedRecount = h.controller.recount();
    h.window.runTimeouts();
    await repeatedRecount;
    assert.equal(saveCalls, 1);

    const navigate = async (id: string, turns: string[]) => {
      h.document.root.children.filter((item) => item.hasAttribute('data-turn-key')).forEach((item) => item.remove());
      h.window.location.pathname = `/c/${id}`;
      h.window.dispatchEvent(new Event('popstate'));
      await settle();
      if (id === conversationId) {
        h.document.root.append(...turns.map((key) => turn(key, `input-${key}`, `output-${key}`, `answer-${key}`)));
      }
    };

    await navigate('other-conversation', []);
    await navigate(conversationId, activeOrder);
    assert.equal(h.loadCount, 3);
    assert.equal(h.latestState()?.aggregate.turns, 5);

    const extra = turn('F', 'input-F', 'output-F', 'answer-F');
    h.document.root.append(extra);
    const changedRecount = h.controller.recount();
    h.window.runTimeouts();
    await changedRecount;
    assert.equal(h.latestState()?.aggregate.turns, 6);
    await navigate('other-conversation', []);
    await navigate(conversationId, [...activeOrder, 'F']);
    assert.equal(h.loadCount, 5);
    assert.equal(h.latestState()?.aggregate.turns, 6);

    const conversation = (h.controller as unknown as {
      session: { conversation(): {
        turnOrder: readonly string[];
        turns: Readonly<Record<string, { inputChars?: number }>>;
      } | null } | null;
    }).session?.conversation();
    assert.deepEqual(conversation?.turnOrder, [...activeOrder, 'F']);
    assert.equal(conversation?.turns.A?.inputChars, 1);
  } finally {
    resolveSave({ ok: true, conversation: savingConversation! });
    await settle();
    h.controller.stop();
    await settle();
  }
});

test('保存成功後の同一内容再集計は保護を再設定せず、保存失敗後の変更はactive順を保つ', async () => {
  const conversationId = 'recount-noop-after-save';
  const activeOrder = ['B', 'C', 'D', 'E'];
  const staleStorage = mergeConversationStatistics(createStatisticsStore(), conversationId, ['A'], [
    { turnKey: 'A', inputChars: 1, assistantMessageId: 'answer-A', outputChars: 2 },
  ], 'manual');
  let saveCalls = 0;
  const h = harness(`/c/${conversationId}`, false, staleStorage, {
    loadStore: async () => ({ ok: true, store: staleStorage }),
    saveConversation: async (_id, conversation) => {
      saveCalls += 1;
      return saveCalls === 2 ? { ok: false, reason: 'storage-failed' } : { ok: true, conversation };
    },
  });
  h.controller.start();
  await settle();
  h.document.root.append(...activeOrder.map((key) => turn(key, `input-${key}`, `output-${key}`, `answer-${key}`)));

  try {
    const recount = h.controller.recount();
    h.window.runTimeouts();
    await recount;
    h.window.runTimeouts();
    await settle();
    assert.equal(saveCalls, 1);
    assert.equal(h.latestState()?.aggregate.turns, 5);

    const repeatedRecount = h.controller.recount();
    h.window.runTimeouts();
    await repeatedRecount;
    await settle();
    assert.equal(saveCalls, 1);

    const controllerState = h.controller as unknown as {
      session: {
        rebaseStore(store: typeof staleStorage): void;
        conversation(): {
          turnOrder: readonly string[];
          turns: Readonly<Record<string, { inputChars?: number }>>;
        } | null;
      } | null;
    };
    const session = controllerState.session!;
    session.rebaseStore(staleStorage);
    assert.deepEqual(session.conversation()?.turnOrder, ['A']);
    assert.equal(session.conversation()?.turns.A?.inputChars, 1);

    const changedRecount = h.controller.recount();
    h.window.runTimeouts();
    await changedRecount;
    h.window.runTimeouts();
    await settle();
    assert.equal(saveCalls, 2);

    session.rebaseStore(staleStorage);
    assert.deepEqual(session.conversation()?.turnOrder, activeOrder);
    assert.equal(session.conversation()?.turns.A?.inputChars, 1);
  } finally {
    h.controller.stop();
    await settle();
  }
});

test('SPAで戻るときにStorageの新しい同一ID計測と追加Turnを古いセッションで上書きしない', async () => {
  const conversationId = 'spa-rebase-newer-storage';
  const initialStore = mergeConversationStatistics(createStatisticsStore(), conversationId, ['A'], [
    { turnKey: 'A', inputChars: 1, assistantMessageId: 'answer-A', outputChars: 2 },
  ], 'manual');
  let latestStore = initialStore;
  const pendingSave = new Promise<{ ok: true; conversation: StoredConversationStatistics }>(() => {});
  const h = harness(`/c/${conversationId}`, false, initialStore, {
    loadStore: async () => ({ ok: true, store: latestStore }),
    saveConversation: async () => pendingSave,
  });
  h.document.root.append(turn('A', 'a', 'bb', 'answer-A'), turn('B', 'input-B', 'output-B', 'answer-B'));
  h.controller.start();
  await settle();

  const recount = h.controller.recount();
  h.window.runTimeouts();
  await recount;
  assert.equal(h.latestState()?.aggregate.turns, 2);

  latestStore = mergeConversationStatistics(initialStore, conversationId, ['A', 'C'], [
    { turnKey: 'A', inputChars: 9, assistantMessageId: 'answer-A', outputChars: 2 },
    { turnKey: 'C', inputChars: 3, assistantMessageId: 'answer-C', outputChars: 4 },
  ], 'manual');
  const navigate = async (id: string, keys: string[]) => {
    h.document.root.children.filter((item) => item.hasAttribute('data-turn-key')).forEach((item) => item.remove());
    h.window.location.pathname = `/c/${id}`;
    h.window.dispatchEvent(new Event('popstate'));
    await settle();
    if (id === conversationId) {
      h.document.root.append(...keys.map((key) => turn(key, key, key, `answer-${key}`)));
    }
  };
  await navigate('other-conversation', []);
  await navigate(conversationId, ['A', 'B', 'C']);

  assert.equal(h.latestState()?.aggregate.turns, 3);
  assert.equal(h.latestState()?.aggregate.inputChars, 19);
  h.controller.stop();
});

test('保存中にSessionへ追加されたTurnを残し、Repository確定値を次の保存基準にする', async () => {
  const conversationId = 'in-flight-session-turn';
  const initialStore = mergeConversationStatistics(createStatisticsStore(), conversationId, ['A'], [
    { turnKey: 'A', inputChars: 5, assistantMessageId: 'answer-A', outputChars: 2 },
  ], 'manual');
  const committed = mergeConversationStatistics(initialStore, conversationId, ['A'], [
    { turnKey: 'A', inputChars: 9, assistantMessageId: 'answer-A', outputChars: 2 },
  ], 'manual').conversations[conversationId]!;
  let resolveFirstSave!: (result: { ok: true; conversation: StoredConversationStatistics }) => void;
  const firstSave = new Promise<{ ok: true; conversation: StoredConversationStatistics }>((resolve) => {
    resolveFirstSave = resolve;
  });
  const saveSnapshots: StoredConversationStatistics[] = [];
  const h = harness(`/c/${conversationId}`, false, initialStore, {
    loadStore: async () => ({ ok: true, store: initialStore }),
    saveConversation: async (_id, conversation) => {
      saveSnapshots.push(conversation);
      return saveSnapshots.length === 1 ? firstSave : { ok: true, conversation };
    },
  });
  h.document.root.append(turn('A', '12345678', 'aa', 'answer-A'));
  h.controller.start();
  await settle();

  try {
    const firstRecount = h.controller.recount();
    h.window.runTimeouts();
    await firstRecount;
    h.window.runTimeouts();
    await settle();
    assert.equal(saveSnapshots.length, 1);
    assert.equal(saveSnapshots[0]?.turns.A?.inputChars, 8);

    h.document.root.append(turn('B', 'bb', 'cc', 'answer-B'));
    const recountDuringSave = h.controller.recount();
    h.window.runTimeouts();
    await recountDuringSave;
    h.window.runTimeouts();
    assert.equal(h.latestState()?.aggregate.turns, 2);

    resolveFirstSave({ ok: true, conversation: committed });
    await settle();
    assert.equal(h.latestState()?.aggregate.inputChars, 11);

    h.window.runTimeouts();
    await settle();
    assert.equal(saveSnapshots.length, 2);
    assert.equal(saveSnapshots[1]?.turns.A?.inputChars, 9);
    assert.equal(saveSnapshots[1]?.turns.B?.inputChars, 2);
  } finally {
    h.controller.stop();
    await settle();
  }
});
