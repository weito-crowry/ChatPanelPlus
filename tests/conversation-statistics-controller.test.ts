import assert from 'node:assert/strict';
import test from 'node:test';
import { createStatisticsStore, mergeConversationStatistics } from '../src/shared/conversation-statistics.ts';
import { isComposerEnterIntent, isComposerSendButton } from '../src/content/conversation-statistics-send-intent.ts';
import { dispatchKeyDown, FakeElement, FakeMutationObserver, harness, settle, turn } from './conversation-statistics-controller-fixture.ts';
import { FakeEventTarget } from './fake-event-target.ts';

async function runNoAnchorSendCandidate(source: 'enter' | 'click'): Promise<void> {
  const conversationId = `no-anchor-${source}`;
  const visibleKeys = ['visible-1', 'visible-2', 'visible-3', 'visible-4'];
  const otherStoredKeys = ['other-branch-1', 'other-branch-2', 'other-branch-3'];
  const storedRows = [
    { turnKey: 'saved-turn', inputChars: 4, assistantMessageId: 'saved-answer', outputChars: 8 },
    ...visibleKeys.map((turnKey, index) => ({
      turnKey, inputChars: index + 1, assistantMessageId: `visible-answer-${index + 1}`, outputChars: index + 2,
    })),
    ...otherStoredKeys.map((turnKey, index) => ({
      turnKey, inputChars: index + 5, assistantMessageId: `other-answer-${index + 1}`, outputChars: index + 6,
    })),
  ];
  const store = mergeConversationStatistics(createStatisticsStore(), conversationId, ['saved-turn'], storedRows, 'manual');
  const h = harness(`/c/${conversationId}`, false, store);
  h.document.root.append(...visibleKeys.map((key) => turn(key, '質問', '回答', `visible-answer-${key}`)));
  h.document.form.attributes.id = 'composer-form';
  h.controller.start();
  await settle();

  assert.equal(h.latestState()?.aggregate.turns, 8);
  assert.equal(visibleKeys.some((key) => store.conversations[conversationId]?.turnOrder.includes(key)), false);
  assert.ok(visibleKeys.every((key) => store.conversations[conversationId]?.turns[key]));

  if (source === 'enter') {
    const event = dispatchKeyDown(h.document.editor);
    assert.equal(isComposerEnterIntent(event as KeyboardEvent, h.document as unknown as Document), true);
    assert.equal(event.defaultPrevented, false);
  } else {
    const button = new FakeElement('button', {
      type: 'button', 'data-testid': 'send-button', form: 'composer-form',
    });
    h.document.root.append(button);
    assert.equal(isComposerSendButton(button as unknown as EventTarget, h.document as unknown as Document), true);
    assert.equal(button.dispatchEvent(new Event('click', { bubbles: true, cancelable: true })), true);
  }

  const submitted = turn('submitted-turn', '新しい質問', '新しい回答', 'submitted-answer');
  h.document.root.append(submitted);
  FakeMutationObserver.latest?.notify(h.document.root, submitted);
  await settle();

  assert.equal(h.latestState()?.aggregate.turns, 9);
  h.controller.stop();
}

test('Enter送信後の新規Turnを既存分岐を含む累積Turnsへ追加する', async () => {
  await runNoAnchorSendCandidate('enter');
});

test('ボタン送信後の新規Turnを既存分岐を含む累積Turnsへ追加する', async () => {
  await runNoAnchorSendCandidate('click');
});

test('新規チャットの初回submitをConversation ID確定後に新しいTurnとして集計する', async () => {
  const h = harness('/');
  h.controller.start();
  await settle();
  const event = new Event('submit', { cancelable: true });
  assert.equal(h.document.form.dispatchEvent(event), true);
  assert.equal(event.defaultPrevented, false);

  const submitted = turn('first-turn', '最初の質問', '最初の回答', 'first-answer');
  h.document.root.append(submitted);
  h.window.location.pathname = '/c/new-conversation';
  h.window.dispatchEvent(new Event('popstate'));
  await settle();

  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 1, inputChars: 5, outputChars: 5, totalChars: 10, partial: false,
  });
  h.controller.stop();
});

test('Conversation ID確定と新規Turn描画が競合してもsubmitの根拠を保持する', async () => {
  const h = harness('/', true);
  h.controller.start();
  await settle();
  h.document.form.dispatchEvent(new Event('submit', { cancelable: true }));

  h.window.location.pathname = '/c/racing-conversation';
  h.window.dispatchEvent(new Event('popstate'));
  await settle();
  assert.equal(h.loadCount, 1);
  const submitted = turn('racing-turn', '質問', '回答', 'racing-answer');
  h.document.root.append(submitted);
  h.deferredLoad.resolve({ ok: true, store: createStatisticsStore() });
  await settle();

  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 1, inputChars: 2, outputChars: 2, totalChars: 4, partial: false,
  });
  h.controller.stop();
});

test('Composerが後から現れる新規会話でも初回submitと非同期Storage中のTurnを追跡する', async () => {
  const h = harness('/', true);
  h.document.form.remove();
  h.controller.start();
  await settle();

  const form = new FakeElement('form', { 'data-chatgpt-composer': '' });
  const editor = new FakeElement('div', { id: 'prompt-textarea', contenteditable: 'true' });
  form.append(editor);
  h.document.root.append(form);
  h.document.form = form;
  h.document.editor = editor;
  const firstSubmit = new Event('submit', { bubbles: true, cancelable: true });
  assert.equal(form.dispatchEvent(firstSubmit), true);
  assert.equal(firstSubmit.defaultPrevented, false);

  h.window.location.pathname = '/c/late-composer-conversation';
  const first = turn('first-turn', 'テスト1', '', 'first-answer', 'in_progress');
  const user = first.querySelectorAll('[data-user-message-bubble]')[0]!;
  user.cloneFails = true;
  h.document.root.append(first);
  h.window.dispatchEvent(new Event('popstate'));
  await settle();
  assert.equal(h.loadCount, 1);

  h.deferredLoad.resolve({ ok: true, store: createStatisticsStore() });
  await settle();
  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 0, inputChars: 0, outputChars: 0, totalChars: 0, partial: true,
  });

  const state = first.querySelectorAll('[data-talvt-turn-state]')[0]!;
  state.attributes['data-talvt-turn-state'] = 'complete';
  first.querySelectorAll('[data-dil-message-id]')[0]!.append(new FakeElement('span', {}, '初回回答'));
  FakeMutationObserver.latest?.notify(state, state);
  await settle();

  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 0, inputChars: 0, outputChars: 4, totalChars: 4, partial: true,
  });

  user.cloneFails = false;
  FakeMutationObserver.latest?.notify(user, user);
  await settle();
  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 1, inputChars: 4, outputChars: 4, totalChars: 8, partial: false,
  });

  const secondSubmit = new Event('submit', { bubbles: true, cancelable: true });
  assert.equal(form.dispatchEvent(secondSubmit), true);
  assert.equal(secondSubmit.defaultPrevented, false);
  const second = turn('second-turn', 'テスト2', '二回目回答', 'second-answer');
  h.document.root.append(second);
  FakeMutationObserver.latest?.notify(h.document.root, second);
  await settle();
  FakeMutationObserver.latest?.notify(h.document.root, second);
  await settle();
  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 2, inputChars: 8, outputChars: 9, totalChars: 17, partial: false,
  });
  h.controller.stop();
});

test('既存会話から新規チャットへ移動中、route poll前のsubmitを新規Turnとして保持する', async () => {
  const existingStore = mergeConversationStatistics(createStatisticsStore(), 'existing-conversation', ['old-turn'], [
    { turnKey: 'old-turn', inputChars: 4, assistantMessageId: 'old-answer', outputChars: 5 },
  ], 'manual');
  const h = harness('/c/existing-conversation', false, existingStore);
  const oldTurn = turn('old-turn', '古い質問', '古い回答', 'old-answer');
  h.document.root.append(oldTurn);
  h.controller.start();
  await settle();
  assert.equal(h.latestState()?.conversationId, 'existing-conversation');

  oldTurn.remove();
  h.window.location.pathname = '/';
  const handlers = h.controller as unknown as {
    onDocumentSubmit: EventListener;
    onComposerSubmit: EventListener;
  };
  FakeEventTarget.dispatchTrace.length = 0;
  const submit = new Event('submit', { bubbles: true, cancelable: true });
  assert.equal(h.document.form.dispatchEvent(submit), true);
  assert.equal(submit.defaultPrevented, false);
  const controllerCalls = FakeEventTarget.dispatchTrace.filter(({ callback }) =>
    callback === handlers.onDocumentSubmit || callback === handlers.onComposerSubmit);
  assert.deepEqual(controllerCalls.map(({ callback }) => callback === handlers.onDocumentSubmit ? 'document' : 'form'), [
    'document', 'form',
  ]);
  assert.ok(controllerCalls.every(({ capture, target }) => capture && target === h.document.form));
  assert.equal(h.latestState()?.conversationId, 'existing-conversation');

  h.window.interval?.();
  await settle();
  assert.equal(h.latestState()?.conversationId, null);
  h.window.location.pathname = '/c/new-chat-conversation';
  const first = turn('new-chat-first-turn', 'テスト1', '', 'new-chat-answer', 'in_progress');
  const user = first.querySelectorAll('[data-user-message-bubble]')[0]!;
  user.cloneFails = true;
  h.document.root.append(first);
  h.window.interval?.();
  await settle();
  assert.equal(h.latestState()?.conversationId, 'new-chat-conversation');

  first.querySelectorAll('[data-talvt-turn-state]')[0]!.attributes['data-talvt-turn-state'] = 'complete';
  first.querySelectorAll('[data-dil-message-id]')[0]!.append(new FakeElement('span', {}, '初回回答'));
  FakeMutationObserver.latest?.notify(first, first);
  await settle();
  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 0, inputChars: 0, outputChars: 4, totalChars: 4, partial: true,
  });

  user.cloneFails = false;
  FakeMutationObserver.latest?.notify(user, user);
  await settle();
  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 1, inputChars: 4, outputChars: 4, totalChars: 8, partial: false,
  });
  h.controller.stop();
});

test('F5直後に会話DOMが空でも保存済み50ターンをController集計に残す', async () => {
  const turnKeys = Array.from({ length: 50 }, (_, index) => `saved-${index + 1}`);
  const observations = turnKeys.map((turnKey, index) => ({
    turnKey,
    inputChars: index + 1,
    assistantMessageId: `answer-${index + 1}`,
    outputChars: index + 2,
  }));
  const store = mergeConversationStatistics(createStatisticsStore(), 'reload-conversation', turnKeys, observations, 'manual');
  const h = harness('/c/reload-conversation', false, store);
  h.controller.start();
  await settle();

  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 50, inputChars: 1_275, outputChars: 1_325, totalChars: 2_600, partial: true,
  });
  h.controller.stop();
});

test('DOM件数が20件から5件へ減っても累積を保ち、新規10件と再読込・SPA往復後も維持する', async () => {
  const conversationId = 'cumulative-turn-lifecycle';
  const turnKeys = Array.from({ length: 20 }, (_, index) => `saved-${index + 1}`);
  const observations = turnKeys.map((turnKey) => ({
    turnKey, inputChars: 1, assistantMessageId: `answer-${turnKey}`, outputChars: 2,
  }));
  let persistedStore = mergeConversationStatistics(createStatisticsStore(), conversationId, turnKeys, observations, 'manual');
  const makeHarness = () => harness(`/c/${conversationId}`, false, persistedStore, {
    loadStore: async () => ({ ok: true, store: persistedStore }),
    saveConversation: async (id, conversation) => {
      persistedStore = {
        ...persistedStore,
        conversations: { ...persistedStore.conversations, [id]: conversation },
      };
      return { ok: true, conversation };
    },
  });
  const visible = turnKeys.slice(0, 5);
  const h = makeHarness();
  h.document.root.append(...visible.map((key) => turn(key, 'x', 'yy', `answer-${key}`)));
  h.controller.start();
  await settle();
  assert.equal(h.latestState()?.aggregate.turns, 20);

  const recount = async () => {
    const pending = h.controller.recount();
    h.window.runTimeouts();
    await pending;
    await settle();
  };
  await recount();
  assert.equal(h.latestState()?.aggregate.turns, 20);

  const additions = Array.from({ length: 10 }, (_, index) => `new-${index + 1}`);
  h.document.root.append(...additions.map((key) => turn(key, 'x', 'yy', `answer-${key}`)));
  await recount();
  assert.equal(h.latestState()?.aggregate.turns, 30);
  await recount();
  assert.equal(h.latestState()?.aggregate.turns, 30);
  h.controller.stop();
  await settle();

  const reloaded = makeHarness();
  reloaded.document.root.append(...visible.map((key) => turn(key, 'x', 'yy', `answer-${key}`)));
  reloaded.controller.start();
  await settle();
  assert.equal(reloaded.latestState()?.aggregate.turns, 30);

  const navigate = async (id: string) => {
    reloaded.document.root.children.filter((item) => item.hasAttribute('data-turn-key')).forEach((item) => item.remove());
    reloaded.window.location.pathname = `/c/${id}`;
    reloaded.window.dispatchEvent(new Event('popstate'));
    await settle();
  };
  await navigate('other-cumulative-conversation');
  assert.equal(reloaded.latestState()?.aggregate.turns, 0);
  await navigate(conversationId);
  assert.equal(reloaded.latestState()?.aggregate.turns, 30);
  reloaded.controller.stop();
});

test('Controllerの手動再集計で保存済み最新ターンより前の2ターンをactive順へ追加する', async () => {
  const store = mergeConversationStatistics(createStatisticsStore(), 'recount-conversation', ['current'], [
    { turnKey: 'current', inputChars: 3, assistantMessageId: 'answer-current', outputChars: 6 },
  ], 'manual');
  const h = harness('/c/recount-conversation', false, store);
  h.controller.start();
  await settle();
  const previous = turn('past-1', 'a', 'bb', 'answer-past-1');
  const middle = turn('past-2', 'cc', 'ddd', 'answer-past-2');
  const current = turn('current', 'eee', 'ffffff', 'answer-current');
  h.document.root.append(previous, middle, current);

  const recount = h.controller.recount();
  h.window.runTimeouts();
  await recount;

  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 3, inputChars: 6, outputChars: 11, totalChars: 17, partial: true,
  });
  h.controller.stop();
});

test('共通アンカーなしの手動再集計で累積Turnsを保ち、再集計後の新規送信も追加する', async () => {
  const store = mergeConversationStatistics(createStatisticsStore(), 'recount-no-anchor', ['saved-turn'], [
    { turnKey: 'saved-turn', inputChars: 9, assistantMessageId: 'saved-answer', outputChars: 12 },
  ], 'manual');
  const h = harness('/c/recount-no-anchor', false, store);
  h.document.root.append(
    turn('visible-1', 'a', 'bb', 'answer-1'),
    turn('visible-2', 'ccc', 'dddd', 'answer-2'),
    turn('visible-3', 'eeeee', 'ffffff', 'answer-3'),
    turn('visible-4', 'ggggggg', 'hhhhhhhh', 'answer-4'),
  );
  h.controller.start();
  await settle();
  assert.equal(h.latestState()?.aggregate.turns, 1);

  const recount = h.controller.recount();
  h.window.runTimeouts();
  await recount;
  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 5, inputChars: 25, outputChars: 32, totalChars: 57, partial: true,
  });

  const repeatRecount = h.controller.recount();
  h.window.runTimeouts();
  await repeatRecount;
  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 5, inputChars: 25, outputChars: 32, totalChars: 57, partial: true,
  });

  h.document.form.dispatchEvent(new Event('submit', { cancelable: true }));
  const nextTurn = turn('new-after-recount', 'new input', 'new output', 'answer-new');
  h.document.root.append(nextTurn);
  FakeMutationObserver.latest?.notify(h.document.root, nextTurn);
  await settle();
  assert.equal(h.latestState()?.aggregate.turns, 6);
  assert.equal(h.latestState()?.aggregate.inputChars, 34);
  assert.equal(h.latestState()?.aggregate.outputChars, 42);
  h.controller.stop();
});

test('履歴DOMの10ターンを再集計して保存済みsuffixも累積し、部分集計と表示する', async () => {
  const store = mergeConversationStatistics(createStatisticsStore(), 'recount-ten', ['saved-old-branch'], [
    { turnKey: 'saved-old-branch', inputChars: 50, assistantMessageId: 'saved-answer', outputChars: 60 },
  ], 'manual');
  const h = harness('/c/recount-ten', false, store);
  const visibleTurns = Array.from({ length: 10 }, (_, index) => turn(
    `history-${index + 1}`, 'q'.repeat(index + 1), 'a'.repeat(index + 2), `answer-${index + 1}`,
  ));
  h.document.root.append(...visibleTurns);
  h.controller.start();
  await settle();

  const recount = h.controller.recount();
  h.window.runTimeouts();
  await recount;

  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 11, inputChars: 105, outputChars: 125, totalChars: 230, partial: true,
  });
  h.controller.stop();
});

test('空の会話DOMを手動再集計しても保存済みTurnsを消さない', async () => {
  const store = mergeConversationStatistics(createStatisticsStore(), 'empty-recount', ['saved-turn'], [
    { turnKey: 'saved-turn', inputChars: 3, assistantMessageId: 'saved-answer', outputChars: 6 },
  ], 'manual');
  const h = harness('/c/empty-recount', false, store);
  h.controller.start();
  await settle();

  const recount = h.controller.recount();
  h.window.runTimeouts();
  await recount;

  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 1, inputChars: 3, outputChars: 6, totalChars: 9, partial: true,
  });
  h.controller.stop();
});

test('既存50ターンの部分DOMでもControllerがsubmit後の新規末尾ターンを追加する', async () => {
  const turnKeys = Array.from({ length: 50 }, (_, index) => `saved-${index + 1}`);
  const observations = turnKeys.map((turnKey) => ({
    turnKey, inputChars: 1, assistantMessageId: `answer-${turnKey}`, outputChars: 2,
  }));
  const store = mergeConversationStatistics(createStatisticsStore(), 'partial-new-conversation', turnKeys, observations, 'manual');
  const h = harness('/c/partial-new-conversation', false, store);
  const visible = [turn('saved-1', 'x', 'yy', 'answer-saved-1'), turn('saved-25', 'x', 'yy', 'answer-saved-25'), turn('saved-50', 'x', 'yy', 'answer-saved-50')];
  h.document.root.append(...visible);
  h.controller.start();
  await settle();
  h.document.form.dispatchEvent(new Event('submit', { cancelable: true }));
  const added = turn('new-turn', 'new', 'answer', 'answer-new');
  h.document.root.append(added);
  FakeMutationObserver.latest?.notify(h.document.root, added);
  await settle();

  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 51, inputChars: 53, outputChars: 106, totalChars: 159, partial: true,
  });
  h.controller.stop();
});

test('submitを伴わない過去TurnのDOM追加を新規発言として計上しない', async () => {
  const h = harness('/c/history');
  h.controller.start();
  await settle();
  const added = turn('history-turn', '過去の質問', '過去の回答', 'history-answer');
  h.document.root.append(added);
  FakeMutationObserver.latest?.notify(h.document.root, added);
  await settle();

  assert.equal(h.latestState()?.aggregate.turns, 0);
  h.controller.stop();
});

test('submit後にDOMから旧Turnが除かれても同じ会話の計測済み分岐を累積する', async () => {
  const turnKeys = ['turn-1', 'turn-2', 'turn-3'];
  const observations = turnKeys.map((turnKey, index) => ({
    turnKey,
    inputChars: index + 1,
    assistantMessageId: `answer-${turnKey}`,
    outputChars: index + 1,
  }));
  const store = mergeConversationStatistics(createStatisticsStore(), 'edit-conversation', turnKeys, observations, 'manual');
  const h = harness('/c/edit-conversation', false, store);
  const oldTurns = turnKeys.map((key, index) => turn(key, 'x'.repeat(index + 1), 'y'.repeat(index + 1), `answer-${key}`));
  h.document.root.append(...oldTurns);
  h.controller.start();
  await settle();
  h.document.form.dispatchEvent(new Event('submit', { cancelable: true }));

  oldTurns[1]!.remove();
  oldTurns[2]!.remove();
  const edited = turn('turn-2-edited', 'Edit', 'Answer', 'answer-turn-2-edited');
  h.document.root.append(edited);
  FakeMutationObserver.latest?.notify(h.document.root, edited, oldTurns.slice(1));
  await settle();

  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 4, inputChars: 10, outputChars: 12, totalChars: 22, partial: true,
  });
  h.controller.stop();
});

test('全履歴走査はスクロール領域がなくても現在DOMを累積計測し部分取得を表示する', async () => {
  const h = harness('/c/history-controller');
  h.document.root.append(turn('visible-history', '現在の質問', '現在の回答', 'visible-answer'));
  h.controller.start();
  await settle();

  const scan = (h.controller as unknown as {
    scanAllHistory?: () => Promise<{ status: string }>;
  }).scanAllHistory;
  assert.equal(typeof scan, 'function');
  if (!scan) return;
  const result = await scan.call(h.controller);

  assert.equal(result.status, 'partial');
  assert.equal(h.latestState()?.aggregate.turns, 1);
  assert.equal(h.latestState()?.historyScan?.outcome, 'partial');
  assert.equal(h.latestState()?.aggregate.partial, true);
  h.controller.stop();
});
