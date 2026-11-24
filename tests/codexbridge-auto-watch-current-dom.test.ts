import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchCompletedAnswerAfterBridgeCandidates,
  matchCurrentCompletedAssistantMessage,
} from '../src/content/codexbridge-auto-watch-completion.ts';
import { harness as statisticsHarness, turn, FakeElement } from './conversation-statistics-controller-fixture.ts';

const THREAD_A = '01a207cf-52ab-7900-a91d-3288982ab221';
const THREAD_B = '01a207d0-12ab-7c00-a911-3288982ab222';
const notice = { conversationId: 'owner', turnKey: 'completed-turn', assistantMessageId: 'assistant-id' };

function getPage(h: ReturnType<typeof statisticsHarness>) {
  return { document: h.document as unknown as Document, pathname: h.window.location.pathname,
    targetId: 'target-1', conversationId: 'owner' };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('Bridge応答待ちにmainとturnが差し替わっても現在DOMの同じassistant回答から照合する', async () => {
  const h = statisticsHarness('/c/owner');
  h.document.root.append(turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId));
  const candidates = deferred<unknown>();
  const matching = matchCompletedAnswerAfterBridgeCandidates(() => candidates.promise, () => getPage(h),
    'target-1', 'owner', notice);

  const replacementMain = new FakeElement('main');
  replacementMain.append(turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId));
  replacementMain.setOwnerDocument(h.document);
  h.document.root = replacementMain;
  candidates.resolve({ ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A, THREAD_B] } });

  assert.deepEqual(await matching, { status: 'ready', connectionId: 'connection-A', threadIds: [THREAD_A],
    candidateThreadIds: [THREAD_A, THREAD_B] });
});

test('Bridge応答待ちに非ID部分の本文が変わっても現在本文に完全一致IDがあれば照合する', async () => {
  const h = statisticsHarness('/c/owner');
  const currentTurn = turn(notice.turnKey, '質問', `初期回答 ${THREAD_A}`, notice.assistantMessageId);
  h.document.root.append(currentTurn);
  const candidates = deferred<unknown>();
  const matching = matchCompletedAnswerAfterBridgeCandidates(() => candidates.promise, () => getPage(h),
    'target-1', 'owner', notice);

  currentTurn.querySelectorAll('[data-dil-message-id]')[0]!.text = `更新後の回答内容。対象ID: ${THREAD_A}`;
  candidates.resolve({ ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A, THREAD_B] } });

  assert.deepEqual(await matching, { status: 'ready', connectionId: 'connection-A', threadIds: [THREAD_A],
    candidateThreadIds: [THREAD_A, THREAD_B] });
});

test('event loop中のturn再描画・再配置と非本文UI挿入を挟んでも現在DOMから照合する', async () => {
  const h = statisticsHarness('/c/owner');
  h.document.root.append(turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId));
  const candidates = deferred<unknown>();
  const matching = matchCompletedAnswerAfterBridgeCandidates(() => candidates.promise, () => getPage(h),
    'target-1', 'owner', notice);

  await new Promise<void>((resolve) => setImmediate(() => {
    const section = new FakeElement('section');
    section.append(turn(notice.turnKey, '質問', `再描画後の回答 ${THREAD_A}`, notice.assistantMessageId));
    h.document.root.replaceChildren(section);
    h.document.root.append(new FakeElement('div', { role: 'toolbar' }, '回答の操作'));
    candidates.resolve({ ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A, THREAD_B] } });
    resolve();
  }));

  assert.deepEqual(await matching, { status: 'ready', connectionId: 'connection-A', threadIds: [THREAD_A],
    candidateThreadIds: [THREAD_A, THREAD_B] });
});

test('登録要求直前の再照合は最新本文からBridge候補の一致IDを選ぶ', async () => {
  const h = statisticsHarness('/c/owner');
  const currentTurn = turn(notice.turnKey, '質問', `初回の回答 ${THREAD_A}`, notice.assistantMessageId);
  h.document.root.append(currentTurn);
  const matching = await matchCompletedAnswerAfterBridgeCandidates(async () => ({
    ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A, THREAD_B] },
  }), () => getPage(h), 'target-1', 'owner', notice);
  assert.equal(matching.status, 'ready');
  if (matching.status !== 'ready') return;

  currentTurn.querySelectorAll('[data-dil-message-id]')[0]!.text = `最終表示の本文 ${THREAD_B}`;
  assert.deepEqual(matchCurrentCompletedAssistantMessage(getPage(h), 'target-1', 'owner', '/c/owner', notice,
    matching.candidateThreadIds), { status: 'ready', threadIds: [THREAD_B] });
});
