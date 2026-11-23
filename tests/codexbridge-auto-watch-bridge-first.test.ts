import assert from 'node:assert/strict';
import test from 'node:test';
import { harness as statisticsHarness, turn, FakeElement, FakeMutationObserver } from './conversation-statistics-controller-fixture.ts';

const THREAD_A = '01a207cf-52ab-7900-a91d-3288982ab221';
const THREAD_B = '01a207d0-12ab-7c00-a911-3288982ab222';
const UNRELATED_UUID = '01a207d1-12ab-7c00-a911-3288982ab223';
const notice = { conversationId: 'owner', turnKey: 'completed-turn', assistantMessageId: 'assistant-id' };

test('本文候補ではなくBridge running IDを正として照合し、無関係UUIDの数に影響されない', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchKnownIds = api.matchKnownBridgeRunningThreadIds as
    ((text: string, targetId: string, ids: readonly string[]) => unknown) | undefined;
  assert.equal(typeof matchKnownIds, 'function', 'matchKnownBridgeRunningThreadIds must use the Bridge ID list');
  const noise = Array.from({ length: 80 }, (_, index) =>
    `09a207${index.toString(16).padStart(2, '0')}-52ab-7900-a91d-3288982ab221`).join(' ');
  assert.deepEqual(matchKnownIds!(`${noise} ${UNRELATED_UUID} ${THREAD_A}`, 'target-1', [THREAD_A, THREAD_B]), {
    status: 'ok', threadIds: [THREAD_A],
  });
});

test('Unicode句読点・Markdown・改行は境界、URL pathと識別子への埋込は境界でない', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchKnownIds = api.matchKnownBridgeRunningThreadIds as
    ((text: string, targetId: string, ids: readonly string[]) => unknown) | undefined;
  assert.equal(typeof matchKnownIds, 'function');
  assert.deepEqual(matchKnownIds!('（`' + THREAD_A + '`）、\n【' + THREAD_B + '】', 'target-1', [THREAD_A, THREAD_B]), {
    status: 'ok', threadIds: [THREAD_A, THREAD_B],
  });
  for (const embedded of [
    `x${THREAD_A}`, `${THREAD_A}suffix`, `_${THREAD_A}`, `${THREAD_A}-suffix`, `prefix.${THREAD_A}`,
    `${THREAD_A}\u200bhidden`, `${THREAD_A}\u200djoined`,
    `https://bridge.example/thread/${THREAD_A}`, `https://bridge.example/?thread=${THREAD_A}`,
  ]) {
    assert.deepEqual(matchKnownIds!(embedded, 'target-1', [THREAD_A]), { status: 'ok', threadIds: [] }, embedded);
  }
  assert.deepEqual(matchKnownIds!(`ID: ${THREAD_A.toUpperCase()}`, 'target-1', [THREAD_A]), { status: 'ok', threadIds: [] });
});

test('Bridge由来の非UUID IDと同一target remote/native形式だけを正規IDに対応する', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchKnownIds = api.matchKnownBridgeRunningThreadIds as
    ((text: string, targetId: string, ids: readonly string[]) => unknown) | undefined;
  assert.equal(typeof matchKnownIds, 'function');
  assert.deepEqual(matchKnownIds!('ID「run/job:17」', 'target-1', ['run/job:17']), {
    status: 'ok', threadIds: ['run/job:17'],
  });
  assert.deepEqual(matchKnownIds!('remote ID `native_thread-7`', 'target-1', ['target-1::native_thread-7']), {
    status: 'ok', threadIds: ['target-1::native_thread-7'],
  });
  assert.deepEqual(matchKnownIds!('remote ID `target-1::native_thread-7`', 'target-1', ['target-1::native_thread-7']), {
    status: 'ok', threadIds: ['target-1::native_thread-7'],
  });
  assert.deepEqual(matchKnownIds!('other::native_thread-7', 'target-1', ['target-1::native_thread-7']), {
    status: 'ok', threadIds: [],
  });
});

test('句読点がBridge IDの末尾にもなる重複境界は曖昧として照合しない', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchKnownIds = api.matchKnownBridgeRunningThreadIds as
    ((text: string, targetId: string, ids: readonly string[]) => unknown) | undefined;
  assert.equal(typeof matchKnownIds, 'function');
  assert.deepEqual(matchKnownIds!('run/job:17、', 'target-1', ['run/job:17', 'run/job:17、']), {
    status: 'skipped', reason: 'ambiguous-match',
  });
});

test('Bridge候補の応答後に初めてDOMを読み、空候補なら本文を調べない', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchAfterBridge = api.matchCompletedAnswerAfterBridgeCandidates as
    ((request: () => Promise<unknown>, getPage: () => unknown, targetId: string, conversationId: string,
      event: typeof notice) => Promise<unknown>) | undefined;
  assert.equal(typeof matchAfterBridge, 'function', 'Bridge candidates must be fetched before reading the answer DOM');
  const h = statisticsHarness('/c/owner');
  h.document.root.append(turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId));
  const order: string[] = [];
  const answerBody = h.document.root.querySelectorAll('[data-dil-message-id]')[0]!;
  const cloneAnswerBody = answerBody.cloneNode.bind(answerBody);
  answerBody.cloneNode = (deep = false) => { order.push('body-read'); return cloneAnswerBody(deep); };
  const page = { document: h.document, pathname: h.window.location.pathname, targetId: 'target-1', conversationId: 'owner' };
  const matched = await matchAfterBridge!(async () => {
    order.push('bridge-read');
    return { ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A] } };
  }, () => page,
  'target-1', 'owner', notice);
  assert.deepEqual(order, ['bridge-read', 'body-read']);
  assert.deepEqual(matched, { status: 'ready', connectionId: 'connection-A', threadIds: [THREAD_A] });

  order.length = 0;
  const noCandidates = await matchAfterBridge!(async () => {
    order.push('bridge-read');
    return { ok: true, data: { connectionId: null, threadIds: [] } };
  }, () => page, 'target-1', 'owner', notice);
  assert.deepEqual(order, ['bridge-read']);
  assert.deepEqual(noCandidates, { status: 'skipped', reason: 'no-running-candidates' });
});

test('照合進捗は候補数と一致数だけを通知しthread IDや本文を含めない', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchAfterBridge = api.matchCompletedAnswerAfterBridgeCandidates as
    ((request: () => Promise<unknown>, getPage: () => unknown, targetId: string, conversationId: string,
      event: typeof notice, onProgress: (progress: unknown) => void) => Promise<unknown>) | undefined;
  assert.equal(typeof matchAfterBridge, 'function');
  const h = statisticsHarness('/c/owner');
  h.document.root.append(turn(notice.turnKey, '質問', `対象ID: ${THREAD_A}`, notice.assistantMessageId));
  const progress: unknown[] = [];
  const matched = await matchAfterBridge!(async () => ({
    ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A, THREAD_B] },
  }), () => ({ document: h.document, pathname: h.window.location.pathname, targetId: 'target-1', conversationId: 'owner' }),
  'target-1', 'owner', notice, (entry) => progress.push(entry));
  assert.deepEqual(matched, { status: 'ready', connectionId: 'connection-A', threadIds: [THREAD_A] });
  assert.deepEqual(progress, [
    { stage: 'candidates', status: 'ok', count: 2 },
    { stage: 'match', status: 'ok', count: 1 },
  ]);
  assert.equal(JSON.stringify(progress).includes(THREAD_A), false);
  assert.equal(JSON.stringify(progress).includes(notice.turnKey), false);
});

test('Bridgeの異常reasonに識別子が混入した場合は診断コードをruntime-unavailableへ丸める', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchAfterBridge = api.matchCompletedAnswerAfterBridgeCandidates as
    ((request: () => Promise<unknown>, getPage: () => unknown, targetId: string, conversationId: string,
      event: typeof notice, onProgress: (progress: unknown) => void) => Promise<unknown>) | undefined;
  assert.equal(typeof matchAfterBridge, 'function');
  const h = statisticsHarness('/c/owner');
  const progress: unknown[] = [];
  const matched = await matchAfterBridge!(async () => ({ ok: false, reason: `failed-${THREAD_A}` }),
    () => ({ document: h.document, pathname: h.window.location.pathname, targetId: 'target-1', conversationId: 'owner' }),
    'target-1', 'owner', notice, (entry) => progress.push(entry));
  assert.deepEqual(matched, { status: 'failed', reason: 'runtime-unavailable' });
  assert.deepEqual(progress, [{ stage: 'candidates', status: 'failed', reason: 'runtime-unavailable' }]);
  assert.equal(JSON.stringify(progress).includes(THREAD_A), false);
});

test('Bridge候補取得中に完了turn DOMが変化したら本文を照合しない', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchAfterBridge = api.matchCompletedAnswerAfterBridgeCandidates as
    ((request: () => Promise<unknown>, getPage: () => unknown, targetId: string, conversationId: string,
      event: typeof notice) => Promise<unknown>) | undefined;
  assert.equal(typeof matchAfterBridge, 'function');
  const h = statisticsHarness('/c/owner');
  const completedTurn = turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId);
  h.document.root.append(completedTurn);
  FakeMutationObserver.latest = null;
  const matched = await matchAfterBridge!(async () => {
    FakeMutationObserver.latest?.notify(completedTurn, completedTurn);
    return { ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A] } };
  }, () => ({ document: h.document, pathname: h.window.location.pathname, targetId: 'target-1', conversationId: 'owner' }),
  'target-1', 'owner', notice);
  assert.deepEqual(matched, { status: 'skipped', reason: 'dom-changed' });
});

test('候補取得待ちのmain配下にある無関係な属性・子要素・テキスト変更は本文照合を妨げない', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchAfterBridge = api.matchCompletedAnswerAfterBridgeCandidates as
    ((request: () => Promise<unknown>, getPage: () => unknown, targetId: string, conversationId: string,
      event: typeof notice) => Promise<unknown>) | undefined;
  assert.equal(typeof matchAfterBridge, 'function');
  const h = statisticsHarness('/c/owner');
  const completedTurn = turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId);
  h.document.root.append(completedTurn);
  FakeMutationObserver.latest = null;
  const matched = await matchAfterBridge!(async () => {
    FakeMutationObserver.latest?.queueRecords(
      { type: 'attributes', target: h.document.root, addedNodes: [], removedNodes: [] } as unknown as MutationRecord,
      { type: 'childList', target: h.document.root, addedNodes: [new FakeElement('div', { 'data-testid': 'react-ui' })], removedNodes: [] } as unknown as MutationRecord,
      { type: 'characterData', target: new FakeElement('div', {}, 'React UI text'), addedNodes: [], removedNodes: [] } as unknown as MutationRecord,
    );
    return { ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A] } };
  }, () => ({ document: h.document, pathname: h.window.location.pathname, targetId: 'target-1', conversationId: 'owner' }),
  'target-1', 'owner', notice);
  assert.deepEqual(matched, { status: 'ready', connectionId: 'connection-A', threadIds: [THREAD_A] });
});

test('回答turnの本文変更・移動・削除・同一key置換・main置換は候補取得待ちでも拒否する', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchAfterBridge = api.matchCompletedAnswerAfterBridgeCandidates as
    ((request: () => Promise<unknown>, getPage: () => unknown, targetId: string, conversationId: string,
      event: typeof notice) => Promise<unknown>) | undefined;
  assert.equal(typeof matchAfterBridge, 'function');

  for (const change of ['text', 'move', 'remove', 'replace', 'root'] as const) {
    const h = statisticsHarness('/c/owner');
    const completedTurn = turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId);
    h.document.root.append(completedTurn);
    FakeMutationObserver.latest = null;
    const matched = await matchAfterBridge!(async () => {
      const observer = FakeMutationObserver.latest!;
      if (change === 'text') {
        const body = completedTurn.querySelectorAll('[data-dil-message-id]')[0]!;
        body.text = `ID ${THREAD_B}`;
        observer.queueRecords({ type: 'characterData', target: body, addedNodes: [], removedNodes: [] } as unknown as MutationRecord);
      } else if (change === 'remove') {
        completedTurn.remove();
        observer.queueRecords({ type: 'childList', target: h.document.root, addedNodes: [], removedNodes: [completedTurn] } as unknown as MutationRecord);
      } else if (change === 'move') {
        const holder = new FakeElement('section');
        h.document.root.append(holder);
        completedTurn.remove();
        holder.append(completedTurn);
        observer.queueRecords({ type: 'childList', target: h.document.root, addedNodes: [holder], removedNodes: [completedTurn] } as unknown as MutationRecord);
      } else if (change === 'replace') {
        const replacement = turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId);
        completedTurn.remove();
        h.document.root.append(replacement);
        observer.queueRecords({ type: 'childList', target: h.document.root, addedNodes: [replacement], removedNodes: [completedTurn] } as unknown as MutationRecord);
      } else {
        const replacementRoot = new FakeElement('main');
        replacementRoot.append(turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId));
        replacementRoot.setOwnerDocument(h.document);
        h.document.root = replacementRoot;
      }
      return { ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A, THREAD_B] } };
    }, () => ({ document: h.document, pathname: h.window.location.pathname, targetId: 'target-1', conversationId: 'owner' }),
    'target-1', 'owner', notice);
    assert.deepEqual(matched, { status: 'skipped', reason: 'dom-changed' }, change);
  }
});

test('回答本文のcode要素内にある完全一致IDも取得する', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchAfterBridge = api.matchCompletedAnswerAfterBridgeCandidates as
    ((request: () => Promise<unknown>, getPage: () => unknown, targetId: string, conversationId: string,
      event: typeof notice) => Promise<unknown>) | undefined;
  assert.equal(typeof matchAfterBridge, 'function');
  const h = statisticsHarness('/c/owner');
  const completedTurn = turn(notice.turnKey, '質問', '', notice.assistantMessageId);
  const answerBody = completedTurn.querySelectorAll('[data-dil-message-id]')[0]!;
  answerBody.append(new FakeElement('p', {}, '対象ID: '), new FakeElement('code', {}, THREAD_A));
  h.document.root.append(completedTurn);
  const matched = await matchAfterBridge!(async () => ({
    ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A, THREAD_B] },
  }), () => ({ document: h.document, pathname: h.window.location.pathname, targetId: 'target-1', conversationId: 'owner' }),
  'target-1', 'owner', notice);
  assert.deepEqual(matched, { status: 'ready', connectionId: 'connection-A', threadIds: [THREAD_A] });
});

test('Bridge照会待ちにSPA会話が切り替わったら本文を読まない', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchAfterBridge = api.matchCompletedAnswerAfterBridgeCandidates as
    ((request: () => Promise<unknown>, getPage: () => unknown, targetId: string, conversationId: string,
      event: typeof notice) => Promise<unknown>) | undefined;
  assert.equal(typeof matchAfterBridge, 'function');
  const h = statisticsHarness('/c/owner');
  h.document.root.append(turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId));
  const order: string[] = [];
  const answerBody = h.document.root.querySelectorAll('[data-dil-message-id]')[0]!;
  const cloneAnswerBody = answerBody.cloneNode.bind(answerBody);
  answerBody.cloneNode = (deep = false) => { order.push('body-read'); return cloneAnswerBody(deep); };
  const matched = await matchAfterBridge!(async () => {
    order.push('bridge-read');
    h.window.location.pathname = '/c/other';
    return { ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A] } };
  }, () => ({ document: h.document, pathname: h.window.location.pathname, targetId: 'target-1',
    conversationId: h.window.location.pathname === '/c/owner' ? 'owner' : 'other' }),
  'target-1', 'owner', notice);
  assert.deepEqual(order, ['bridge-read']);
  assert.deepEqual(matched, { status: 'skipped', reason: 'invalid-route' });
});

test('hidden assistant content and UI buttons are not searched', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchAfterBridge = api.matchCompletedAnswerAfterBridgeCandidates as
    ((request: () => Promise<unknown>, getPage: () => unknown, targetId: string, conversationId: string,
      event: typeof notice) => Promise<unknown>) | undefined;
  assert.equal(typeof matchAfterBridge, 'function');
  const h = statisticsHarness('/c/owner');
  const completedTurn = turn(notice.turnKey, '質問', '回答本文', notice.assistantMessageId);
  const answerBody = completedTurn.querySelectorAll('[data-dil-message-id]')[0]!;
  answerBody.append(new FakeElement('span', { hidden: '' }, THREAD_A), new FakeElement('button', {}, THREAD_B));
  h.document.root.append(completedTurn);
  const result = await matchAfterBridge!(async () => ({
    ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A, THREAD_B] },
  }), () => ({ document: h.document, pathname: h.window.location.pathname, targetId: 'target-1', conversationId: 'owner' }),
  'target-1', 'owner', notice);
  assert.deepEqual(result, { status: 'skipped', reason: 'no-matching-ids' });
});
