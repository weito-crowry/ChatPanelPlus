import assert from 'node:assert/strict';
import test from 'node:test';
import type { CodexBridgeAutoWatchMatchResult } from '../src/content/codexbridge-auto-watch-completion.ts';
import { readCompletedAssistantMessageText } from '../src/content/conversation-statistics-dom.ts';
import { harness as statisticsHarness, turn, FakeElement, FakeMutationObserver } from './conversation-statistics-controller-fixture.ts';

const THREAD_A = '01a207cf-52ab-7900-a91d-3288982ab221';
const THREAD_B = '01a207d0-12ab-7c00-a911-3288982ab222';
const UNRELATED_UUID = '01a207d1-12ab-7c00-a911-3288982ab223';
const notice = { conversationId: 'owner', turnKey: 'completed-turn', assistantMessageId: 'assistant-id' };

function latestMutationObserver(): FakeMutationObserver | null {
  return FakeMutationObserver.latest;
}

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

test('ASCII識別子の連結は拒否し日本語との隣接はtoken境界として扱う', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchKnownIds = api.matchKnownBridgeRunningThreadIds as
    ((text: string, targetId: string, ids: readonly string[]) => unknown) | undefined;
  assert.equal(typeof matchKnownIds, 'function');
  assert.deepEqual(matchKnownIds!(`${THREAD_A}を確認し、${THREAD_B}の状態を確認する。`, 'target-1', [THREAD_A, THREAD_B]), {
    status: 'ok', threadIds: [THREAD_A, THREAD_B],
  });
  assert.deepEqual(matchKnownIds!(`${THREAD_A}${THREAD_B}`, 'target-1', [THREAD_A, THREAD_B]), {
    status: 'ok', threadIds: [],
  });
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
  assert.deepEqual(matchKnownIds!('run/作業:17の状態', 'target-1', ['run/作業:17']), {
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

test('Bridge応答後に現在の本文だけを照合し、候補なしなら本文を読まない', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchAfterBridge = api.matchCompletedAnswerAfterBridgeCandidates as
    ((request: () => Promise<unknown>, getPage: () => unknown, targetId: string, conversationId: string,
      event: typeof notice) => Promise<unknown>) | undefined;
  assert.equal(typeof matchAfterBridge, 'function', 'Bridge lookup must begin before answer text is inspected');
  const h = statisticsHarness('/c/owner');
  h.document.root.append(turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId));
  const order: string[] = [];
  const answerBody = h.document.root.querySelectorAll('[data-dil-message-id]')[0]!;
  const cloneAnswerBody = answerBody.cloneNode.bind(answerBody);
  answerBody.cloneNode = (deep = false) => { order.push('body-read'); return cloneAnswerBody(deep); };
  const page = { document: h.document, pathname: h.window.location.pathname, targetId: 'target-1', conversationId: 'owner' };
  let resolveCandidates!: (value: unknown) => void;
  const candidates = new Promise<unknown>((resolve) => { resolveCandidates = resolve; });
  const matching = matchAfterBridge!(() => {
    order.push('bridge-read');
    return candidates;
  }, () => page, 'target-1', 'owner', notice);
  assert.deepEqual(order, ['bridge-read']);
  resolveCandidates({ ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A] } });
  const matched = await matching;
  assert.deepEqual(order, ['bridge-read', 'body-read']);
  assert.deepEqual(matched, { status: 'ready', connectionId: 'connection-A', threadIds: [THREAD_A], candidateThreadIds: [THREAD_A] });

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
  assert.deepEqual(matched, { status: 'ready', connectionId: 'connection-A', threadIds: [THREAD_A], candidateThreadIds: [THREAD_A, THREAD_B] });
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

test('候補取得中の属性・非本文UI・同一semantic textの再描画は照合を妨げない', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchAfterBridge = api.matchCompletedAnswerAfterBridgeCandidates as
    ((request: () => Promise<unknown>, getPage: () => unknown, targetId: string, conversationId: string,
      event: typeof notice) => Promise<unknown>) | undefined;
  assert.equal(typeof matchAfterBridge, 'function');
  for (const change of ['style', 'aria', 'answer-button', 'hover-toolbar', 'dil-controls', 'loading-layout', 'rerender', 'reparent'] as const) {
    const h = statisticsHarness('/c/owner');
    const completedTurn = turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId);
    h.document.root.append(completedTurn);
    const assistant = completedTurn.querySelectorAll('[data-chatgpt-selection-message-id]')[0]!;
    const body = completedTurn.querySelectorAll('[data-dil-message-id]')[0]!;
    let resolveCandidates!: (value: unknown) => void;
    const candidates = new Promise<unknown>((resolve) => { resolveCandidates = resolve; });
    FakeMutationObserver.latest = null;
    const matching = matchAfterBridge!(() => candidates,
      () => ({ document: h.document, pathname: h.window.location.pathname, targetId: 'target-1', conversationId: 'owner' }),
      'target-1', 'owner', notice);
    const observer = latestMutationObserver();
    if (change === 'style') {
      completedTurn.setAttribute('style', 'outline: 1px solid');
      observer?.notify(completedTurn, completedTurn);
    } else if (change === 'aria') {
      assistant.setAttribute('aria-busy', 'false');
      observer?.notify(assistant, assistant);
    } else if (change === 'answer-button') {
      const button = new FakeElement('button', {}, 'コピー');
      body.append(button);
      observer?.notify(body, button);
    } else if (change === 'hover-toolbar') {
      const toolbar = new FakeElement('div', { role: 'toolbar' });
      toolbar.append(new FakeElement('button', {}, '操作'));
      assistant.append(toolbar);
      observer?.notify(assistant, toolbar);
    } else if (change === 'dil-controls') {
      const control = new FakeElement('button', { 'aria-label': 'copy' }, 'Copy');
      body.append(control);
      observer?.notify(body, control);
    } else if (change === 'loading-layout') {
      const status = new FakeElement('div', { 'data-testid': 'response-status' }, 'Response ready');
      assistant.append(status);
      observer?.notify(assistant, status);
    } else if (change === 'reparent') {
      const holder = new FakeElement('section');
      h.document.root.append(holder);
      completedTurn.remove();
      holder.append(completedTurn);
      observer?.notify(h.document.root, holder, [completedTurn]);
    } else {
      body.replaceChildren(new FakeElement('p', {}, `ID ${THREAD_A}`));
      observer?.notify(body, body.children[0]!);
    }
    resolveCandidates({ ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A, THREAD_B] } });
    assert.deepEqual(await matching,
      { status: 'ready', connectionId: 'connection-A', threadIds: [THREAD_A], candidateThreadIds: [THREAD_A, THREAD_B] }, change);
  }
});

test('候補取得待ちのmain配下にある無関係な属性・子要素・テキスト変更は照合を妨げない', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchAfterBridge = api.matchCompletedAnswerAfterBridgeCandidates as
    ((request: () => Promise<unknown>, getPage: () => unknown, targetId: string, conversationId: string,
      event: typeof notice) => Promise<unknown>) | undefined;
  assert.equal(typeof matchAfterBridge, 'function');
  const h = statisticsHarness('/c/owner');
  const completedTurn = turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId);
  h.document.root.append(completedTurn);
  const matched = await matchAfterBridge!(async () => {
    h.document.root.setAttribute('aria-label', 'main updated');
    h.document.root.append(new FakeElement('div', { 'data-testid': 'react-ui' }, 'React UI text'));
    return { ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A] } };
  }, () => ({ document: h.document, pathname: h.window.location.pathname, targetId: 'target-1', conversationId: 'owner' }),
  'target-1', 'owner', notice);
  assert.deepEqual(matched, { status: 'ready', connectionId: 'connection-A', threadIds: [THREAD_A], candidateThreadIds: [THREAD_A] });
});

test('Bridge応答時の現在本文・assistant identity/state・turn一意性で照合を判定する', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchAfterBridge = api.matchCompletedAnswerAfterBridgeCandidates as
    ((request: () => Promise<unknown>, getPage: () => unknown, targetId: string, conversationId: string,
      event: typeof notice) => Promise<unknown>) | undefined;
  assert.equal(typeof matchAfterBridge, 'function');

  for (const change of ['text', 'unmatched', 'clear', 'message-id', 'in-progress', 'move-out', 'remove', 'past-only', 'replace', 'root', 'duplicate'] as const) {
    const h = statisticsHarness('/c/owner');
    const completedTurn = turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId);
    h.document.root.append(completedTurn);
    FakeMutationObserver.latest = null;
    let resolveCandidates!: (value: unknown) => void;
    const candidates = new Promise<unknown>((resolve) => { resolveCandidates = resolve; });
    const matching = matchAfterBridge!(() => candidates,
      () => ({ document: h.document, pathname: h.window.location.pathname, targetId: 'target-1', conversationId: 'owner' }),
      'target-1', 'owner', notice);
    const body = completedTurn.querySelectorAll('[data-dil-message-id]')[0]!;
    const assistant = completedTurn.querySelectorAll('[data-chatgpt-selection-message-id]')[0]!;
    if (change === 'text') {
      body.text = `ID ${THREAD_B}`;
      latestMutationObserver()?.notify(body, body);
    } else if (change === 'unmatched') {
      body.text = `ID ${UNRELATED_UUID}`;
      latestMutationObserver()?.notify(body, body);
    } else if (change === 'clear') {
      body.text = '';
      latestMutationObserver()?.notify(body, body);
    } else if (change === 'message-id') {
      assistant.setAttribute('data-chatgpt-selection-message-id', 'replacement-assistant');
      body.setAttribute('data-dil-message-id', 'replacement-assistant');
      latestMutationObserver()?.notify(assistant, assistant);
    } else if (change === 'in-progress') {
      completedTurn.querySelectorAll('[data-talvt-turn-state]')[0]!.setAttribute('data-talvt-turn-state', 'in_progress');
      latestMutationObserver()?.notify(completedTurn, completedTurn);
    } else if (change === 'remove') {
      completedTurn.remove();
      latestMutationObserver()?.notify(h.document.root, completedTurn);
    } else if (change === 'move-out') {
      const holder = new FakeElement('section');
      completedTurn.remove();
      holder.append(completedTurn);
      latestMutationObserver()?.notify(h.document.root, holder, [completedTurn]);
    } else if (change === 'past-only') {
      completedTurn.remove();
      h.document.root.append(turn('previous-turn', '質問', `過去の回答 ${THREAD_A}`, notice.assistantMessageId));
    } else if (change === 'replace') {
      const replacement = turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId);
      completedTurn.remove();
      h.document.root.append(replacement);
      latestMutationObserver()?.notify(h.document.root, replacement, [completedTurn]);
    } else if (change === 'root') {
      const replacementRoot = new FakeElement('main');
      replacementRoot.append(turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId));
      replacementRoot.setOwnerDocument(h.document);
      h.document.root = replacementRoot;
    } else {
      h.document.root.append(turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId));
    }
    resolveCandidates({ ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A, THREAD_B] } });
    const matched = await matching as CodexBridgeAutoWatchMatchResult;
    if (change === 'text' || change === 'replace' || change === 'root') {
      assert.deepEqual(matched, { status: 'ready', connectionId: 'connection-A',
        threadIds: [change === 'text' ? THREAD_B : THREAD_A], candidateThreadIds: [THREAD_A, THREAD_B] }, change);
    } else {
      assert.equal(matched.status, 'skipped', change);
      if (matched.status !== 'skipped') assert.fail(`Expected a skip for ${change}`);
      assert.equal(matched.reason, change === 'unmatched' ? 'no-matching-ids'
        : change === 'remove' || change === 'move-out' || change === 'past-only' || change === 'duplicate'
          ? 'turn-not-unique' : 'answer-not-confirmed', change);
    }
  }
});

test('Bridge応答後に読み取った現在本文のIDを使って照合する', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchAfterBridge = api.matchCompletedAnswerAfterBridgeCandidates as
    ((request: () => Promise<unknown>, getPage: () => unknown, targetId: string, conversationId: string,
      event: typeof notice) => Promise<unknown>) | undefined;
  assert.equal(typeof matchAfterBridge, 'function');
  const h = statisticsHarness('/c/owner');
  const completedTurn = turn(notice.turnKey, '質問', `ID ${THREAD_A}`, notice.assistantMessageId);
  h.document.root.append(completedTurn);
  const body = completedTurn.querySelectorAll('[data-dil-message-id]')[0]!;
  const cloneBody = body.cloneNode.bind(body);
  let reads = 0;
  body.cloneNode = (deep = false) => {
    const clone = cloneBody(deep);
    if (reads++ === 0) clone.text = `現在の本文 ID ${THREAD_B}`;
    return clone;
  };
  const matched = await matchAfterBridge!(async () => ({
    ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A, THREAD_B] },
  }), () => ({ document: h.document, pathname: h.window.location.pathname, targetId: 'target-1', conversationId: 'owner' }),
  'target-1', 'owner', notice);
  assert.deepEqual(matched, { status: 'ready', connectionId: 'connection-A', threadIds: [THREAD_B], candidateThreadIds: [THREAD_A, THREAD_B] });
  assert.equal(reads, 1);
});

test('Bridge照会後のSPA会話route変更では本文を照合しない', async () => {
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

test('Bridge要求を先行し、応答後に本文を一度だけ読む', async () => {
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
  let resolveCandidates!: (value: unknown) => void;
  const candidates = new Promise<unknown>((resolve) => { resolveCandidates = resolve; });
  const matching = matchAfterBridge!(() => { order.push('bridge-request'); return candidates; },
    () => ({ document: h.document, pathname: h.window.location.pathname, targetId: 'target-1', conversationId: 'owner' }),
    'target-1', 'owner', notice);
  assert.deepEqual(order, ['bridge-request']);
  resolveCandidates({ ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A, THREAD_B] } });
  assert.deepEqual(await matching,
    { status: 'ready', connectionId: 'connection-A', threadIds: [THREAD_A], candidateThreadIds: [THREAD_A, THREAD_B] });
  assert.deepEqual(order, ['bridge-request', 'body-read']);
});

test('独立したcode段落と前後の日本語段落から完全一致IDを取得する', async () => {
  const api = await import('../src/content/codexbridge-auto-watch-completion.ts') as Record<string, unknown>;
  const matchAfterBridge = api.matchCompletedAnswerAfterBridgeCandidates as
    ((request: () => Promise<unknown>, getPage: () => unknown, targetId: string, conversationId: string,
      event: typeof notice) => Promise<unknown>) | undefined;
  assert.equal(typeof matchAfterBridge, 'function');
  const h = statisticsHarness('/c/owner');
  const completedTurn = turn(notice.turnKey, '質問', '', notice.assistantMessageId);
  const answerBody = completedTurn.querySelectorAll('[data-dil-message-id]')[0]!;
  const codeParagraph = new FakeElement('p');
  codeParagraph.append(new FakeElement('code', {}, THREAD_A));
  answerBody.append(new FakeElement('p', {}, '前の日本語段落'), codeParagraph,
    new FakeElement('p', {}, '後の日本語段落'));
  assert.equal(readCompletedAssistantMessageText(completedTurn as unknown as Element, notice.assistantMessageId),
    `前の日本語段落\n${THREAD_A}\n後の日本語段落`);
  h.document.root.append(completedTurn);
  const matched = await matchAfterBridge!(async () => ({
    ok: true, data: { connectionId: 'connection-A', threadIds: [THREAD_A, THREAD_B] },
  }), () => ({ document: h.document, pathname: h.window.location.pathname, targetId: 'target-1', conversationId: 'owner' }),
  'target-1', 'owner', notice);
  assert.deepEqual(matched, { status: 'ready', connectionId: 'connection-A', threadIds: [THREAD_A], candidateThreadIds: [THREAD_A, THREAD_B] });
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
