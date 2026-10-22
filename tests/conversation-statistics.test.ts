import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateConversationStatistics,
  codePointLength,
  createStatisticsStore,
  mergeConversationStatistics,
  validateStatisticsStore,
  type StatisticsObservation,
} from '../src/shared/conversation-statistics.ts';

function observe(
  turnKey: string,
  inputChars?: number,
  assistantMessageId?: string,
  outputChars?: number,
): StatisticsObservation {
  return { turnKey, ...(inputChars === undefined ? {} : { inputChars }), ...(assistantMessageId ? { assistantMessageId } : {}), ...(outputChars === undefined ? {} : { outputChars }) };
}

test('文字数は改行を含むUnicodeコードポイント数で数える', () => {
  assert.equal(codePointLength('A\n😀漢'), 4);
  assert.equal(codePointLength(''), 0);
});

test('初回スナップショットはID順だけを記録し、文字数・Turnsを増やさない', () => {
  const store = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['old-1', 'old-2'], [], 'initial');
  const aggregate = aggregateConversationStatistics(store.conversations['conversation-a']);

  assert.deepEqual(store.conversations['conversation-a']?.turnOrder, ['old-1', 'old-2']);
  assert.equal(aggregate.turns, 0);
  assert.equal(aggregate.inputChars, 0);
  assert.equal(aggregate.partial, true);
});

test('新しいユーザーターンを自動追加し、同じIDの再観測は加算しない', () => {
  let store = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['old-1'], [], 'initial');
  store = mergeConversationStatistics(store, 'conversation-a', ['old-1', 'new-1'], [observe('new-1', 5)], 'automatic', 'new-1');
  store = mergeConversationStatistics(store, 'conversation-a', ['old-1', 'new-1'], [observe('new-1', 5)], 'automatic', 'new-1');

  const aggregate = aggregateConversationStatistics(store.conversations['conversation-a']);
  assert.equal(aggregate.turns, 1);
  assert.equal(aggregate.inputChars, 5);
  assert.deepEqual(store.conversations['conversation-a']?.turnOrder, ['old-1', 'new-1']);
});

test('手動再集計で過去ターンを追加し、同じ範囲の再走査は二重計上しない', () => {
  let store = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['old-1', 'old-2'], [], 'initial');
  const visible = ['old-1', 'old-2'];
  const measurements = [observe('old-1', 4, 'answer-1', 10), observe('old-2', 7, 'answer-2', 11)];
  store = mergeConversationStatistics(store, 'conversation-a', visible, measurements, 'manual');
  store = mergeConversationStatistics(store, 'conversation-a', visible, measurements, 'manual');

  assert.deepEqual(aggregateConversationStatistics(store.conversations['conversation-a']), {
    turns: 2, inputChars: 11, outputChars: 21, totalChars: 32, partial: true,
  });
});

test('最新1ターンだけの既存順へ手動再集計した過去2ターンを前置する', () => {
  let store = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['current'], [
    observe('current', 3, 'answer-current', 6),
  ], 'manual');
  const visible = ['past-1', 'past-2', 'current'];
  const observations = [
    observe('past-1', 1, 'answer-past-1', 2),
    observe('past-2', 2, 'answer-past-2', 4),
    observe('current', 3, 'answer-current', 6),
  ];

  store = mergeConversationStatistics(store, 'conversation-a', visible, observations, 'manual');
  store = mergeConversationStatistics(store, 'conversation-a', visible, observations, 'manual');
  store = mergeConversationStatistics(store, 'conversation-a', [...visible, 'new'], [
    observe('new', 4, 'answer-new', 8),
  ], 'automatic', 'new');

  const conversation = store.conversations['conversation-a'];
  assert.deepEqual(conversation?.turnOrder, ['past-1', 'past-2', 'current', 'new']);
  assert.equal(aggregateConversationStatistics(conversation).turns, 4);
  assert.equal(aggregateConversationStatistics(conversation).inputChars, 10);
  assert.equal(aggregateConversationStatistics(conversation).outputChars, 20);
});

test('保存済み8行のうち表示4ターンに共通アンカーがない手動再集計は既存順序を保つ', () => {
  const visibleTurnKeys = ['visible-1', 'visible-2', 'visible-3', 'visible-4'];
  const otherStoredKeys = ['other-branch-1', 'other-branch-2', 'other-branch-3'];
  const observations = visibleTurnKeys.map((turnKey, index) => observe(
    turnKey, [4, 3, 5, 2][index], `answer-${index + 1}`, [10, 12, 14, 19][index],
  ));
  const storedRows = [
    observe('saved-turn', 4, 'saved-answer'),
    ...visibleTurnKeys.map((turnKey, index) => observe(turnKey, index + 1, `visible-answer-${index + 1}`, index + 2)),
    ...otherStoredKeys.map((turnKey, index) => observe(turnKey, index + 5, `other-answer-${index + 1}`, index + 6)),
  ];
  const saved = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['saved-turn'], storedRows, 'manual');
  const before = saved.conversations['conversation-a']!;
  const recounted = mergeConversationStatistics(saved, 'conversation-a', visibleTurnKeys, observations, 'manual');
  const recountedAgain = mergeConversationStatistics(recounted, 'conversation-a', visibleTurnKeys, observations, 'manual');
  const conversation = recounted.conversations['conversation-a'];

  assert.equal(Object.keys(before.turns).length, 8);
  assert.equal(visibleTurnKeys.some((turnKey) => before.turnOrder.includes(turnKey)), false);
  assert.ok(visibleTurnKeys.every((turnKey) => before.turns[turnKey]));
  assert.deepEqual(conversation?.turnOrder, ['saved-turn']);
  assert.equal(Object.keys(conversation?.turns ?? {}).length, 8);
  assert.ok(visibleTurnKeys.every((turnKey) => conversation?.turns[turnKey]));
  assert.deepEqual(recountedAgain.conversations['conversation-a'], conversation);
  assert.deepEqual(aggregateConversationStatistics(conversation), {
    turns: 8, inputChars: 36, outputChars: 76, totalChars: 112, partial: true,
  });
});

test('明示的な再集計は共通アンカーなしでもDOM順へ切り替え、旧台帳行を保って繰り返し計上しない', () => {
  const saved = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['saved-turn'], [
    observe('saved-turn', 9, 'saved-answer', 12),
  ], 'manual');
  const visible = ['visible-1', 'visible-2', 'visible-3', 'visible-4'];
  const observations = [
    observe('visible-1', 1, 'answer-1', 2),
    observe('visible-2', 3, 'answer-2', 4),
    observe('visible-3', 5, 'answer-3', 6),
    observe('visible-4', 7, 'answer-4', 8),
  ];

  const recounted = mergeConversationStatistics(saved, 'conversation-a', visible, observations, 'manual-recount');
  const recountedAgain = mergeConversationStatistics(recounted, 'conversation-a', visible, observations, 'manual-recount');
  const conversation = recounted.conversations['conversation-a'];

  assert.deepEqual(conversation?.turnOrder, visible);
  assert.deepEqual(aggregateConversationStatistics(conversation), {
    turns: 5, inputChars: 25, outputChars: 32, totalChars: 57, partial: true,
  });
  assert.equal(conversation?.turns['saved-turn']?.inputChars, 9);
  assert.equal(Object.keys(conversation?.turns ?? {}).length, 5);
  assert.deepEqual(recountedAgain.conversations['conversation-a'], conversation);
});

test('automaticOrderは送信された新Turnを台帳へ記録しても無共通アンカーならactive順へ追加しない', () => {
  const visibleTurnKeys = ['visible-1', 'visible-2', 'visible-3', 'visible-4'];
  const otherStoredKeys = ['other-branch-1', 'other-branch-2', 'other-branch-3'];
  const storedRows = [
    observe('saved-turn', 4, 'saved-answer', 8),
    ...visibleTurnKeys.map((turnKey, index) => observe(turnKey, index + 1, `visible-answer-${index + 1}`, index + 2)),
    ...otherStoredKeys.map((turnKey, index) => observe(turnKey, index + 5, `other-answer-${index + 1}`, index + 6)),
  ];
  const saved = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['saved-turn'], storedRows, 'manual');
  const before = saved.conversations['conversation-a']!;
  const visibleAfterSubmission = [...visibleTurnKeys, 'submitted-turn'];
  const updated = mergeConversationStatistics(saved, 'conversation-a', visibleAfterSubmission, [
    observe('submitted-turn', 5, 'submitted-answer', 9),
  ], 'automatic', 'submitted-turn');
  const conversation = updated.conversations['conversation-a'];

  assert.equal(Object.keys(before.turns).length, 8);
  assert.equal(visibleTurnKeys.some((turnKey) => before.turnOrder.includes(turnKey)), false);
  assert.ok(visibleTurnKeys.every((turnKey) => before.turns[turnKey]));
  assert.deepEqual(conversation?.turnOrder, ['saved-turn']);
  assert.ok(conversation?.turns['submitted-turn']);
  assert.equal(Object.keys(conversation?.turns ?? {}).length, 9);
  assert.deepEqual(aggregateConversationStatistics(conversation), {
    turns: 9, inputChars: 37, outputChars: 52, totalChars: 89, partial: true,
  });
});

test('空のturnOrderは手動再集計で台帳にある表示ターンだけ復帰する', () => {
  const populated = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['turn-1', 'turn-2'], [
    observe('turn-1', 2, 'answer-1', 4), observe('turn-2', 3, 'answer-2', 5),
  ], 'manual');
  const conversation = populated.conversations['conversation-a']!;
  const emptyOrder = {
    ...populated,
    conversations: { ...populated.conversations, 'conversation-a': { ...conversation, turnOrder: [] } },
  };
  const restored = mergeConversationStatistics(emptyOrder, 'conversation-a', ['turn-2'], [
    observe('turn-2', 3, 'answer-2', 5),
  ], 'manual');

  assert.deepEqual(restored.conversations['conversation-a']?.turnOrder, ['turn-2']);
  assert.deepEqual(aggregateConversationStatistics(restored.conversations['conversation-a']), {
    turns: 2, inputChars: 5, outputChars: 9, totalChars: 14, partial: true,
  });
});

test('既存ターンのDOM順が矛盾する手動再集計は新しいIDをactive順へ混ぜない', () => {
  const store = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['turn-1', 'turn-2', 'turn-3'], [
    observe('turn-1', 1, 'answer-1', 2), observe('turn-2', 2, 'answer-2', 3), observe('turn-3', 3, 'answer-3', 4),
  ], 'manual');
  const recounted = mergeConversationStatistics(store, 'conversation-a', ['turn-3', 'unknown', 'turn-1'], [
    observe('unknown', 10, 'answer-unknown', 20),
  ], 'manual');

  assert.deepEqual(recounted.conversations['conversation-a']?.turnOrder, ['turn-1', 'turn-2', 'turn-3']);
  assert.equal(aggregateConversationStatistics(recounted.conversations['conversation-a']).inputChars, 16);
  assert.equal(aggregateConversationStatistics(recounted.conversations['conversation-a']).partial, true);
});

test('既存順に未表示ターンが挟まる範囲は位置を推測せず部分集計にする', () => {
  const store = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['turn-1', 'turn-2', 'turn-3'], [
    observe('turn-1', 1, 'answer-1', 2), observe('turn-2', 2, 'answer-2', 3), observe('turn-3', 3, 'answer-3', 4),
  ], 'manual');
  const recounted = mergeConversationStatistics(store, 'conversation-a', ['turn-1', 'unknown', 'turn-3'], [
    observe('unknown', 10, 'answer-unknown', 20),
  ], 'manual');

  assert.deepEqual(recounted.conversations['conversation-a']?.turnOrder, ['turn-1', 'turn-2', 'turn-3']);
  assert.ok(recounted.conversations['conversation-a']?.turns.unknown);
  assert.equal(aggregateConversationStatistics(recounted.conversations['conversation-a']).inputChars, 16);
  assert.equal(aggregateConversationStatistics(recounted.conversations['conversation-a']).partial, true);
});

test('保存済み50ターンをF5直後の空DOMでもactive集計に保持する', () => {
  const turnKeys = Array.from({ length: 50 }, (_, index) => `turn-${index + 1}`);
  const observations = turnKeys.map((turnKey, index) => observe(turnKey, index + 1, `answer-${index + 1}`, index + 2));
  const store = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', turnKeys, observations, 'manual');
  const reloaded = mergeConversationStatistics(store, 'conversation-a', [], [], 'initial');

  assert.deepEqual(reloaded.conversations['conversation-a']?.turnOrder, turnKeys);
  assert.deepEqual(aggregateConversationStatistics(reloaded.conversations['conversation-a'], true), {
    turns: 50,
    inputChars: 1_275,
    outputChars: 1_325,
    totalChars: 2_600,
    partial: false,
  });
});

test('DOMが段階描画されても未観測の保存済みsuffixを維持する', () => {
  const turnKeys = Array.from({ length: 8 }, (_, index) => `turn-${index + 1}`);
  const observations = turnKeys.map((turnKey) => observe(turnKey, 2, `answer-${turnKey}`, 3));
  const store = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', turnKeys, observations, 'manual');
  const firstPaint = mergeConversationStatistics(store, 'conversation-a', turnKeys.slice(0, 2), [], 'initial');
  const secondPaint = mergeConversationStatistics(firstPaint, 'conversation-a', turnKeys.slice(0, 5), [], 'initial');
  const finalPaint = mergeConversationStatistics(secondPaint, 'conversation-a', turnKeys, [], 'initial');

  assert.deepEqual(firstPaint.conversations['conversation-a']?.turnOrder, turnKeys);
  assert.deepEqual(secondPaint.conversations['conversation-a']?.turnOrder, turnKeys);
  assert.deepEqual(finalPaint.conversations['conversation-a']?.turnOrder, turnKeys);
  assert.equal(aggregateConversationStatistics(finalPaint.conversations['conversation-a'], true).totalChars, 40);
});

test('長い会話で先頭・中間・末尾だけDOMにあってもactive順と既存値を保つ', () => {
  const turnKeys = Array.from({ length: 50 }, (_, index) => `turn-${index + 1}`);
  const observations = turnKeys.map((turnKey, index) => observe(turnKey, index + 1, `answer-${index + 1}`, index + 2));
  const store = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', turnKeys, observations, 'manual');
  const partialDom = mergeConversationStatistics(store, 'conversation-a', [turnKeys[0]!, turnKeys[24]!, turnKeys[39]!], [], 'manual');

  assert.deepEqual(partialDom.conversations['conversation-a']?.turnOrder, turnKeys);
  assert.deepEqual(aggregateConversationStatistics(partialDom.conversations['conversation-a'], true), {
    turns: 50,
    inputChars: 1_275,
    outputChars: 1_325,
    totalChars: 2_600,
    partial: false,
  });
});

test('保存済み50ターンの一部を繰り返し手動再集計しても順序と値を重複させない', () => {
  const turnKeys = Array.from({ length: 50 }, (_, index) => `turn-${index + 1}`);
  const observations = turnKeys.map((turnKey) => observe(turnKey, 1, `answer-${turnKey}`, 2));
  let store = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', turnKeys, observations, 'manual');
  const visible = [turnKeys[0]!, turnKeys[24]!, turnKeys[49]!];
  const partialObservations = visible.map((turnKey) => observe(turnKey, 1, `answer-${turnKey}`, 2));

  store = mergeConversationStatistics(store, 'conversation-a', visible, partialObservations, 'manual');
  store = mergeConversationStatistics(store, 'conversation-a', visible, partialObservations, 'manual');

  assert.deepEqual(store.conversations['conversation-a']?.turnOrder, turnKeys);
  assert.deepEqual(aggregateConversationStatistics(store.conversations['conversation-a'], true), {
    turns: 50, inputChars: 50, outputChars: 100, totalChars: 150, partial: false,
  });
});

test('全台帳行が計測済みでも全会話の範囲を確認できない間は部分集計にする', () => {
  const turnKeys = ['turn-1', 'turn-2'];
  const store = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', turnKeys, [
    observe('turn-1', 3, 'answer-1', 5), observe('turn-2', 4, 'answer-2', 6),
  ], 'manual');

  assert.deepEqual(aggregateConversationStatistics(store.conversations['conversation-a']), {
    turns: 2, inputChars: 7, outputChars: 11, totalChars: 18, partial: true,
  });
});

test('回答再生成は同じTurn Keyの出力を置換し、旧回答を合算しない', () => {
  let store = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['turn-1'], [observe('turn-1', 3, 'answer-old', 20)], 'manual');
  store = mergeConversationStatistics(store, 'conversation-a', ['turn-1'], [observe('turn-1', 3, 'answer-new', 9)], 'manual');

  const conversation = store.conversations['conversation-a'];
  assert.equal(conversation?.turns['turn-1']?.assistantMessageId, 'answer-new');
  assert.equal(aggregateConversationStatistics(conversation).outputChars, 9);
});

test('生成中の再生成は旧出力を直ちに外し、完了後の同一IDを記録する', () => {
  let store = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['turn-1'], [observe('turn-1', 3, 'answer-old', 20)], 'manual');
  store = mergeConversationStatistics(store, 'conversation-a', ['turn-1'], [
    { turnKey: 'turn-1', assistantState: 'in_progress' },
  ], 'automatic');
  assert.equal(aggregateConversationStatistics(store.conversations['conversation-a']).outputChars, 0);
  store = mergeConversationStatistics(store, 'conversation-a', ['turn-1'], [
    { turnKey: 'turn-1', assistantMessageId: 'answer-new', assistantState: 'complete', outputChars: 9 },
  ], 'automatic');
  assert.equal(aggregateConversationStatistics(store.conversations['conversation-a']).outputChars, 9);
});

test('初回スナップショットは本文を保存せず、生成中なら旧OUTPUTを確定値から外す', () => {
  let store = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['turn-1'], [observe('turn-1', 3, 'answer-old', 20)], 'manual');
  store = mergeConversationStatistics(store, 'conversation-a', ['turn-1'], [
    { turnKey: 'turn-1', inputChars: 999, assistantState: 'in_progress' },
  ], 'initial');
  assert.equal(store.conversations['conversation-a']?.turns['turn-1']?.inputChars, 3);
  assert.equal(store.conversations['conversation-a']?.turns['turn-1']?.assistantMessageId, undefined);
  assert.equal(store.conversations['conversation-a']?.turns['turn-1']?.outputChars, undefined);
});

test('編集でTurn Keyが置換された後も同一会話の旧分岐を累積集計し、既存ID行を保持する', () => {
  let store = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['turn-1', 'turn-2', 'turn-3'], [
    observe('turn-1', 2, 'answer-1', 10), observe('turn-2', 3, 'answer-2', 20), observe('turn-3', 4, 'answer-3', 30),
  ], 'manual');
  store = mergeConversationStatistics(store, 'conversation-a', ['turn-1', 'turn-2-edited'], [observe('turn-2-edited', 5)], 'automatic', 'turn-2-edited', 'turn-2-edited', 'turn-2');

  const conversation = store.conversations['conversation-a'];
  assert.deepEqual(conversation?.turnOrder, ['turn-1', 'turn-2-edited']);
  assert.ok(conversation?.turns['turn-2']);
  assert.ok(conversation?.turns['turn-3']);
  assert.deepEqual(aggregateConversationStatistics(conversation), {
    turns: 4, inputChars: 14, outputChars: 60, totalChars: 74, partial: true,
  });
});

test('別会話は独立し、未知Conversation IDの行が合算に混ざらない', () => {
  let store = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['turn-a'], [observe('turn-a', 4)], 'manual');
  store = mergeConversationStatistics(store, 'conversation-b', ['turn-b'], [observe('turn-b', 9)], 'manual');

  assert.equal(aggregateConversationStatistics(store.conversations['conversation-a']).inputChars, 4);
  assert.equal(aggregateConversationStatistics(store.conversations['conversation-b']).inputChars, 9);
});

test('累積集計はturnOrder外の計測済み分岐を含み、空INPUTを数えて未計測IDを除く', () => {
  const store = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['active'], [
    observe('active', 4, 'answer-active', 6),
    observe('old-branch', 3, 'answer-old-branch', 5),
    observe('empty-input', 0),
    { turnKey: 'id-only' },
  ], 'manual');

  assert.deepEqual(aggregateConversationStatistics(store.conversations['conversation-a'], true), {
    turns: 3,
    inputChars: 7,
    outputChars: 11,
    totalChars: 18,
    partial: true,
  });
});

test('再観測でINPUT値が欠落しても同じTurn Keyの計測済みTurnsを維持する', () => {
  const measured = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['turn-a'], [
    observe('turn-a', 4, 'answer-a', 6),
  ], 'manual');
  const afterIncompleteObservation = mergeConversationStatistics(measured, 'conversation-a', ['turn-a'], [
    { turnKey: 'turn-a', assistantState: 'in_progress' },
  ], 'automatic');

  assert.deepEqual(aggregateConversationStatistics(afterIncompleteObservation.conversations['conversation-a']), {
    turns: 1, inputChars: 4, outputChars: 0, totalChars: 4, partial: true,
  });
});

test('保存スキーマを検証し、本文・未知フィールド・不正文字数は拒否する', () => {
  const valid = mergeConversationStatistics(createStatisticsStore(), 'conversation-a', ['turn-1'], [observe('turn-1', 4)], 'manual');
  assert.equal(validateStatisticsStore(valid).ok, true);

  const withBody = structuredClone(valid) as unknown as Record<string, unknown>;
  ((withBody.conversations as Record<string, Record<string, unknown>>)['conversation-a']!.turns as Record<string, Record<string, unknown>>)['turn-1']!.body = '本文';
  assert.equal(validateStatisticsStore(withBody).ok, false);

  const withInvalidCount = structuredClone(valid) as unknown as Record<string, unknown>;
  ((withInvalidCount.conversations as Record<string, Record<string, unknown>>)['conversation-a']!.turns as Record<string, Record<string, unknown>>)['turn-1']!.inputChars = -1;
  assert.equal(validateStatisticsStore(withInvalidCount).ok, false);

  const withInvalidId = structuredClone(valid) as unknown as Record<string, unknown>;
  ((withInvalidId.conversations as Record<string, Record<string, unknown>>)['conversation-a']!.turnOrder as string[])[0] = 'turn\u0000bad';
  assert.equal(validateStatisticsStore(withInvalidId).ok, false);
});
