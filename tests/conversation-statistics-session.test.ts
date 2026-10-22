import assert from 'node:assert/strict';
import test from 'node:test';
import { createStatisticsStore, mergeConversationStatistics, type StatisticsObservation, type StatisticsStore } from '../src/shared/conversation-statistics.ts';
import { ConversationStatisticsSession } from '../src/content/conversation-statistics-session.ts';

function observed(turnKey: string, inputChars?: number, assistantMessageId?: string, outputChars?: number, assistantState: StatisticsObservation['assistantState'] = 'complete'): StatisticsObservation {
  return {
    turnKey,
    ...(inputChars === undefined ? {} : { inputChars }),
    ...(assistantMessageId ? { assistantMessageId } : {}),
    ...(outputChars === undefined ? {} : { outputChars }),
    assistantState,
  };
}

function stored(...observations: StatisticsObservation[]): StatisticsStore {
  return mergeConversationStatistics(createStatisticsStore(), 'conversation-a', observations.map(({ turnKey }) => turnKey), observations, 'manual');
}

test('初期表示・スクロールだけでは過去ターンを計上せず、送信後の新規末尾ターンを自動計上する', () => {
  const session = new ConversationStatisticsSession('conversation-a', stored(observed('old-1', 4, 'answer-1', 8)), ['old-1'], [observed('old-1', undefined, 'answer-1')]);
  assert.equal(session.observe(observed('scrolled-old', 20, 'answer-old', 30), true, ['old-1', 'scrolled-old'], 1), false);
  assert.equal(session.statistics().turns, 1);
  session.noteSubmission(2);
  assert.equal(session.observe(observed('new-1', 5, 'answer-new', 7), true, ['old-1', 'new-1'], 3), true);
  assert.deepEqual(session.statistics(), { turns: 2, inputChars: 9, outputChars: 15, totalChars: 24, partial: true });
});

test('次の新規発言も加算ではなくID行として1回だけ更新し、F5相当の再初期化で重複しない', () => {
  let session = new ConversationStatisticsSession('conversation-a', createStatisticsStore(), [], []);
  session.confirmNewConversationStart();
  session.noteSubmission(1);
  session.observe(observed('turn-1', 4, 'answer-1', 6), true, ['turn-1'], 2);
  session.noteSubmission(3);
  session.observe(observed('turn-2', 8, 'answer-2', 10), true, ['turn-1', 'turn-2'], 4);
  const beforeReload = session.statistics();
  session = new ConversationStatisticsSession('conversation-a', session.getStore(), ['turn-1', 'turn-2'], [
    observed('turn-1', undefined, 'answer-1'), observed('turn-2', undefined, 'answer-2'),
  ]);

  assert.deepEqual(beforeReload, { turns: 2, inputChars: 12, outputChars: 16, totalChars: 28, partial: false });
  assert.deepEqual(session.statistics(), { ...beforeReload, partial: true });
});

test('OUTPUTが先に確定した新規ターンでも後から取得できたINPUTを更新できる', () => {
  const session = new ConversationStatisticsSession('conversation-a', createStatisticsStore(), [], []);
  session.confirmNewConversationStart();
  session.noteSubmission(1);
  session.observe(observed('turn-1', undefined, 'answer-1', 6), true, ['turn-1'], 2);
  session.observe(observed('turn-1', 5, 'answer-1', 6), true, ['turn-1'], 3);

  assert.deepEqual(session.statistics(), { turns: 1, inputChars: 5, outputChars: 6, totalChars: 11, partial: false });
});

test('保存読み込み中に送信されたターンを初回DOMスナップショットから自動計上する', () => {
  const session = new ConversationStatisticsSession('conversation-a', createStatisticsStore(), ['turn-1'], [
    observed('turn-1', undefined, 'answer-1'),
  ]);
  session.confirmNewConversationStart('turn-1');
  session.noteSubmission(10);

  assert.equal(session.observe(observed('turn-1', 5, 'answer-1', 7), true, ['turn-1'], 11, true), true);
  assert.deepEqual(session.statistics(), { turns: 1, inputChars: 5, outputChars: 7, totalChars: 12, partial: false });
});

test('同一Turn Keyの回答再生成はin_progressで旧出力を消し、完了後に置き換える', () => {
  const session = new ConversationStatisticsSession('conversation-a', stored(observed('turn-1', 3, 'answer-old', 20)), ['turn-1'], [observed('turn-1', undefined, 'answer-old')]);
  assert.equal(session.observe(observed('turn-1', undefined, undefined, undefined, 'in_progress'), true, ['turn-1'], 1), true);
  assert.equal(session.statistics().outputChars, 0);
  assert.equal(session.observe(observed('turn-1', undefined, 'answer-new', 9), true, ['turn-1'], 2), true);
  assert.equal(session.statistics().outputChars, 9);
});

test('スクロール履歴のAssistant状態がunknownなら保存済みOUTPUTを上書きしない', () => {
  const session = new ConversationStatisticsSession('conversation-a', stored(observed('turn-1', 3, 'answer-old', 20)), ['turn-1'], [observed('turn-1', undefined, 'answer-old')]);
  session.observeHistory([observed('turn-1', undefined, 'answer-new', undefined, 'unknown')]);
  assert.equal(session.statistics().outputChars, 20);
  session.observeHistory([observed('turn-1', undefined, 'answer-new', 9, 'complete')]);
  assert.equal(session.statistics().outputChars, 9);
});

test('前方の回答再生成後にDOMで見えないsuffixは旧分岐として保持して累積合計する', () => {
  const previous = stored(observed('turn-1', 3, 'answer-old', 20), observed('turn-2', 4, 'answer-2', 9));
  const session = new ConversationStatisticsSession('conversation-a', previous, ['turn-1', 'turn-2'], [
    observed('turn-1', undefined, 'answer-old'), observed('turn-2', undefined, 'answer-2'),
  ]);
  session.observe(observed('turn-1', undefined, 'answer-new', 7), true, ['turn-1'], 1);
  session.recount(['turn-1'], [observed('turn-1', undefined, 'answer-new', 7)]);

  assert.deepEqual(session.conversation()?.turnOrder, ['turn-1']);
  assert.ok(session.conversation()?.turns['turn-2']);
  assert.deepEqual(session.statistics(), { turns: 2, inputChars: 7, outputChars: 16, totalChars: 23, partial: true });
});

test('Storage rebaseは表示DOMに共通アンカーがなくても明示再集計の置換動作を適用しない', () => {
  const session = new ConversationStatisticsSession('conversation-a', stored(observed('saved-turn', 3, 'saved-answer', 6)), [
    'visible-1', 'visible-2',
  ], [observed('visible-1'), observed('visible-2')]);
  const storage = stored(observed('storage-branch', 8, 'storage-answer', 9));

  session.rebaseStore(storage);

  assert.deepEqual(session.conversation()?.turnOrder, ['storage-branch']);
  assert.equal(session.conversation()?.turns['saved-turn']?.inputChars, 3);
  assert.deepEqual(session.statistics(), { turns: 2, inputChars: 11, outputChars: 15, totalChars: 26, partial: true });
});

test('手動再集計の保存確認後はStorage rebaseが通常のmanual統合に戻る', () => {
  const session = new ConversationStatisticsSession('conversation-a', stored(observed('saved-turn', 3, 'saved-answer', 6)), [
    'saved-turn',
  ], [observed('saved-turn', undefined, 'saved-answer')]);
  session.recount(['visible-1', 'visible-2'], [
    observed('visible-1', 4, 'answer-1', 7), observed('visible-2', 5, 'answer-2', 8),
  ]);
  const savedConversation = session.conversation()!;
  session.confirmPersisted(savedConversation, savedConversation);

  session.rebaseStore(stored(observed('storage-branch', 8, 'storage-answer', 9)));

  assert.deepEqual(session.conversation()?.turnOrder, ['storage-branch']);
  assert.equal(session.conversation()?.turns['saved-turn']?.inputChars, 3);
  assert.equal(session.conversation()?.turns['visible-1']?.inputChars, 4);
  assert.deepEqual(session.statistics(), { turns: 4, inputChars: 20, outputChars: 30, totalChars: 50, partial: true });
});

test('明示再集計は共通アンカーがなくても表示中4ターンを累積し旧台帳も保持する', () => {
  const session = new ConversationStatisticsSession('conversation-a', stored(observed('saved-turn', 9, 'saved-answer', 12)), [
    'saved-turn',
  ], [observed('saved-turn', undefined, 'saved-answer')]);
  const keys = ['visible-1', 'visible-2', 'visible-3', 'visible-4'];
  const observations = keys.map((key, index) => observed(key, index + 1, `answer-${index + 1}`, index + 2));

  session.recount(keys, observations);
  session.recount(keys, observations);

  assert.deepEqual(session.conversation()?.turnOrder, keys);
  assert.equal(session.conversation()?.turns['saved-turn']?.inputChars, 9);
  assert.equal(Object.keys(session.conversation()?.turns ?? {}).length, 5);
  assert.deepEqual(session.statistics(), { turns: 5, inputChars: 19, outputChars: 26, totalChars: 45, partial: true });
});

test('保存未完了中の同一内容再集計と追加変更は明示active順を維持する', () => {
  const storage = stored(observed('A', 1, 'answer-A', 2));
  const session = new ConversationStatisticsSession('conversation-a', storage, ['A'], [observed('A', undefined, 'answer-A')]);
  const keys = ['B', 'C', 'D', 'E'];
  const observations = keys.map((key, index) => observed(key, index + 3, `answer-${key}`, index + 4));

  session.recount(keys, observations);
  session.recount(keys, observations);
  session.rebaseStore(storage);
  assert.deepEqual(session.conversation()?.turnOrder, keys);
  assert.equal(session.conversation()?.turns.A?.inputChars, 1);

  const extendedKeys = [...keys, 'F'];
  const extendedObservations = [...observations, observed('F', 8, 'answer-F', 9)];
  session.recount(extendedKeys, extendedObservations);
  session.rebaseStore(storage);
  assert.deepEqual(session.conversation()?.turnOrder, extendedKeys);
  assert.equal(session.conversation()?.turns.A?.inputChars, 1);
});

test('空DOMの手動再集計は保存済み順序と集計値を保つ', () => {
  const session = new ConversationStatisticsSession('conversation-a', stored(observed('saved-turn', 3, 'saved-answer', 6)), [
    'saved-turn',
  ], [observed('saved-turn', undefined, 'saved-answer')]);

  session.recount([], []);

  assert.deepEqual(session.conversation()?.turnOrder, ['saved-turn']);
  assert.deepEqual(session.statistics(), { turns: 1, inputChars: 3, outputChars: 6, totalChars: 9, partial: true });
});

test('再集計スナップショットの分岐が曖昧なら、他の完了条件がそろっていても部分表示にする', () => {
  const session = new ConversationStatisticsSession('conversation-a', createStatisticsStore(), [], []);
  session.confirmNewConversationStart();

  session.recount(['visible-turn'], [observed('visible-turn', 4, 'answer-visible', 7)], true);

  assert.deepEqual(session.statistics(), { turns: 1, inputChars: 4, outputChars: 7, totalChars: 11, partial: true });
});

test('編集で置換されたTurn Keyは旧suffixも累積集計に含める', () => {
  const previous = stored(observed('turn-1', 2, 'answer-1', 5), observed('turn-2', 3, 'answer-2', 6), observed('turn-3', 4, 'answer-3', 7));
  const session = new ConversationStatisticsSession('conversation-a', previous, ['turn-1', 'turn-2', 'turn-3'], [
    observed('turn-1', undefined, 'answer-1'), observed('turn-2', undefined, 'answer-2'), observed('turn-3', undefined, 'answer-3'),
  ]);
  session.noteSubmission(10, ['turn-1', 'turn-2', 'turn-3']);
  assert.equal(session.observe(observed('turn-2-edited', 5, undefined, undefined, 'in_progress'), true, ['turn-1', 'turn-2-edited'], 11, false, ['turn-2', 'turn-3']), true);
  session.recount(['turn-1', 'turn-2-edited'], [
    observed('turn-1', undefined, 'answer-1'),
    observed('turn-2-edited', 5, undefined, undefined, 'in_progress'),
  ]);
  assert.deepEqual(session.conversation()?.turnOrder, ['turn-1', 'turn-2-edited']);
  assert.ok(session.conversation()?.turns['turn-3']);
  assert.equal(session.statistics().turns, 4);
  assert.equal(session.statistics().inputChars, 14);
  assert.equal(session.statistics().partial, true);
});

test('置換Turnの直前アンカーがない場合は既存集計を保全して新しい範囲を未確定にする', () => {
  const previous = stored(observed('turn-1', 2, 'answer-1', 5), observed('turn-2', 3, 'answer-2', 6));
  const session = new ConversationStatisticsSession('conversation-a', previous, ['turn-1', 'turn-2'], [
    observed('turn-1', undefined, 'answer-1'), observed('turn-2', undefined, 'answer-2'),
  ]);
  session.noteSubmission(10, ['turn-1', 'turn-2']);
  session.observe(observed('turn-1-edited', 8, undefined, undefined, 'in_progress'), true, ['turn-1-edited'], 11);

  assert.deepEqual(session.conversation()?.turnOrder, ['turn-1', 'turn-2']);
  assert.deepEqual(session.statistics(), { turns: 3, inputChars: 13, outputChars: 11, totalChars: 24, partial: true });
  assert.ok(session.conversation()?.turns['turn-1']);
  assert.equal(session.conversation()?.turns['turn-1-edited']?.inputChars, 8);
});

test('部分DOM末尾より後ろに保存済みsuffixがある送信は分岐を推測せず、値を保全する', () => {
  const previous = stored(...Array.from({ length: 50 }, (_, index) => observed(`turn-${index + 1}`, 1, `answer-${index + 1}`, 2)));
  const session = new ConversationStatisticsSession('conversation-a', previous, ['turn-1', 'turn-25', 'turn-40'], [
    observed('turn-1', undefined, 'answer-1'), observed('turn-25', undefined, 'answer-25'), observed('turn-40', undefined, 'answer-40'),
  ]);
  session.noteSubmission(10, ['turn-1', 'turn-25', 'turn-40']);
  session.observe(observed('turn-new', 4, undefined, undefined, 'in_progress'), true, ['turn-1', 'turn-25', 'turn-40', 'turn-new'], 11);

  assert.equal(session.conversation()?.turnOrder.length, 50);
  assert.equal(session.conversation()?.turns['turn-new']?.inputChars, 4);
  assert.equal(session.statistics().turns, 51);
  assert.equal(session.statistics().inputChars, 54);
  assert.equal(session.statistics().partial, true);
});

test('履歴スナップショットは131件を保持し新規20件だけを加え、同じ履歴の再走査では増やさない', () => {
  const previous = stored(...Array.from({ length: 131 }, (_, index) => observed(`saved-${index}`, 1, `answer-${index}`, 2)));
  const session = new ConversationStatisticsSession('conversation-a', previous, [], []);

  const observeHistory = (session as unknown as {
    observeHistory?: (observations: readonly StatisticsObservation[]) => readonly string[];
  }).observeHistory;
  assert.equal(typeof observeHistory, 'function');
  if (!observeHistory) return;

  const newTurns = Array.from({ length: 20 }, (_, index) => observed(`found-${index}`, 3, `found-answer-${index}`, 4));
  assert.equal(observeHistory.call(session, newTurns).length, 20);
  assert.equal(session.statistics().turns, 151);
  assert.equal(session.conversation()?.turns['saved-0']?.inputChars, 1);

  const refreshed = newTurns.map((item, index) => index === 0 ? observed(item.turnKey, 3, 'regenerated-answer', 9) : item);
  assert.deepEqual(observeHistory.call(session, refreshed), []);
  assert.equal(session.statistics().turns, 151);
  assert.equal(session.conversation()?.turns['found-0']?.outputChars, 9);
  assert.equal(Object.keys(session.conversation()?.turns ?? {}).length, 151);
  assert.equal(session.statistics().partial, true);
});
