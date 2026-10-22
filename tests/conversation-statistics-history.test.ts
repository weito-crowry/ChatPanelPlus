import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeDocument, FakeElement, turn } from './conversation-statistics-controller-fixture.ts';
import { ConversationStatisticsHistoryManager } from '../src/content/conversation-statistics-history-manager.ts';
import { ConversationStatisticsSession } from '../src/content/conversation-statistics-session.ts';
import { createStatisticsStore } from '../src/shared/conversation-statistics.ts';

class ScrollableElement extends FakeElement {
  private position = 0;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  onScrollPosition: ((position: number) => void) | null = null;

  constructor(scrollHeight: number, clientHeight: number) {
    super('div');
    this.scrollHeight = scrollHeight;
    this.clientHeight = clientHeight;
  }

  get scrollTop(): number { return this.position; }
  set scrollTop(position: number) {
    this.position = position;
    this.onScrollPosition?.(position);
  }

  getBoundingClientRect(): DOMRect {
    return { top: 0, bottom: this.clientHeight, left: 0, right: 500, width: 500, height: this.clientHeight } as DOMRect;
  }
}

function testWindow(scrollable: FakeElement, overflowY = 'auto'): Window {
  return {
    getComputedStyle: (element: Element) => ({ overflowY: element === (scrollable as unknown as Element) ? overflowY : 'visible' }),
    setTimeout: (callback: TimerHandler, delay?: number) => globalThis.setTimeout(callback, delay) as unknown as number,
    clearTimeout: (timer: number) => globalThis.clearTimeout(timer),
  } as unknown as Window;
}

test('mainの外側にある会話ターン共通のスクロール祖先を特定する', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts').catch(() => null);
  assert.ok(history, '会話履歴スキャナーが存在する');
  if (!history) return;

  const document = new FakeDocument();
  document.root.append(turn('first', '質問', '回答', 'answer-1'), turn('second', '質問2', '回答2', 'answer-2'));
  const scroller = new ScrollableElement(1_200, 200);
  scroller.append(document.root);

  assert.equal(history.findConversationScrollContainer(document.root as unknown as HTMLElement, testWindow(scroller)), scroller);
});

test('全履歴走査は現在位置から先頭へ進んだ後に末尾まで進み、各スナップショットを渡す', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts').catch(() => null);
  assert.ok(history, '会話履歴スキャナーが存在する');
  if (!history) return;

  const document = new FakeDocument();
  document.root.append(turn('one', '質問1', '回答1', 'answer-1'), turn('two', '質問2', '回答2', 'answer-2'));
  const scroller = new ScrollableElement(1_000, 200);
  scroller.scrollTop = 350;
  scroller.setOwnerDocument(document);
  scroller.append(document.root);
  const positions: number[] = [];
  const observedKeys = new Set<string>();
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window: testWindow(scroller),
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    onSnapshot: (snapshot) => {
      positions.push(scroller.scrollTop);
      snapshot.turnKeys.forEach((key) => observedKeys.add(key));
      return 0;
    },
    settleDelayMs: 0,
    stableEdgeObservations: 2,
    maxSteps: 20,
    maxDurationMs: 2_000,
  });

  const result = await scanner.start();

  assert.equal(result.status, 'completed');
  assert.ok(positions.indexOf(0) >= 0);
  assert.ok(positions.some((position, index) => position === 800 && positions.indexOf(0) < index));
  assert.deepEqual([...observedKeys], ['one', 'two']);
  assert.equal(scroller.scrollTop, 350);
});

test('検出できる会話スクロール領域がなければスクロールせず部分取得を返す', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts').catch(() => null);
  assert.ok(history, '会話履歴スキャナーが存在する');
  if (!history) return;

  const document = new FakeDocument();
  document.root.append(turn('visible', '質問', '回答', 'answer-visible'));
  const nonScrollable = new ScrollableElement(200, 200);
  nonScrollable.scrollTop = 15;
  nonScrollable.append(document.root);
  let snapshotCount = 0;
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window: testWindow(nonScrollable),
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    onSnapshot: () => { snapshotCount += 1; return 0; },
    settleDelayMs: 0,
  });

  const result = await scanner.start();

  assert.equal(result.status, 'partial');
  assert.equal(result.reason, 'no-scroll-container');
  assert.equal(snapshotCount, 1);
  assert.equal(nonScrollable.scrollTop, 15);
});

test('スクロール可能に見えるだけのoverflow hidden要素を操作しない', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts');
  const document = new FakeDocument();
  document.root.append(turn('unsafe-scroll', '質問', '回答', 'answer-unsafe'));
  const unsafe = new ScrollableElement(1_200, 200);
  unsafe.scrollTop = 150;
  unsafe.append(document.root);
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window: testWindow(unsafe, 'hidden'),
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    onSnapshot: () => 0,
    settleDelayMs: 0,
  });

  const result = await scanner.start();

  assert.equal(result.status, 'partial');
  assert.equal(unsafe.scrollTop, 150);
});

test('走査中に手動スクロールされた場合は中止し、ユーザーが選んだ位置を保つ', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts');
  const document = new FakeDocument();
  const visibleTurn = turn('visible', '質問', '回答', 'answer-visible');
  document.root.append(visibleTurn);
  const scroller = new ScrollableElement(1_000, 200);
  scroller.scrollTop = 350;
  scroller.setOwnerDocument(document);
  scroller.append(document.root);
  let interrupted = false;
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window: testWindow(scroller),
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    onSnapshot: () => {
      if (!interrupted) {
        interrupted = true;
        scroller.scrollTop = 275;
        visibleTurn.dispatchEvent(new Event('wheel', { bubbles: true }));
      }
      return 0;
    },
    settleDelayMs: 0,
  });

  const result = await scanner.start();

  assert.equal(result.status, 'cancelled');
  assert.equal(result.reason, 'user-input');
  assert.equal(scroller.scrollTop, 275);
});

test('明示中止はそれまでに渡したスナップショットを残しcancelledで終わる', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts');
  const document = new FakeDocument();
  document.root.append(turn('saved-before-cancel', '質問', '回答', 'answer-cancel'));
  const scroller = new ScrollableElement(1_000, 200);
  scroller.scrollTop = 350;
  scroller.setOwnerDocument(document);
  scroller.append(document.root);
  let snapshots = 0;
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window: testWindow(scroller),
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    onSnapshot: () => { snapshots += 1; scanner.cancel(); return 0; },
    settleDelayMs: 0,
  });

  const result = await scanner.start();

  assert.equal(result.status, 'cancelled');
  assert.equal(result.reason, 'explicit-cancel');
  assert.equal(snapshots, 1);
  assert.equal(scroller.scrollTop, 350);
});

test('History Managerは中止要求と終了状態を公開し、取得済み統計を保持する', async () => {
  const document = new FakeDocument();
  document.root.append(turn('kept-on-cancel', '質問', '回答', 'answer-kept'));
  const scroller = new ScrollableElement(1_000, 200);
  scroller.scrollTop = 350;
  scroller.setOwnerDocument(document);
  scroller.append(document.root);
  const session = new ConversationStatisticsSession('conversation-a', createStatisticsStore(), [], []);
  const manager = new ConversationStatisticsHistoryManager({
    document: document as unknown as Document,
    window: testWindow(scroller),
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    getCurrentRoot: () => document.root as unknown as HTMLElement,
    getSession: () => session,
    isDisposed: () => false,
    onDirty: () => undefined,
    onState: () => undefined,
  });
  const running = manager.scan();
  assert.equal(manager.state.scanning, true);
  assert.equal(session.statistics().turns, 1);
  manager.cancel();
  assert.equal(manager.state.cancelRequested, true);
  const result = await running;

  assert.equal(result.status, 'cancelled');
  assert.equal(result.reason, 'explicit-cancel');
  assert.equal(manager.state.outcome, 'cancelled');
  assert.equal(session.statistics().turns, 1);
  assert.equal(scroller.scrollTop, 350);
  manager.dispose();
});

test('Conversation IDが変わると次の非同期スナップショット前に走査を終了する', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts');
  const document = new FakeDocument();
  document.root.append(turn('captured-conversation', '質問', '回答', 'answer-route'));
  const scroller = new ScrollableElement(1_000, 200);
  scroller.scrollTop = 350;
  scroller.setOwnerDocument(document);
  scroller.append(document.root);
  let currentId = 'conversation-a';
  let snapshots = 0;
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window: testWindow(scroller),
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => currentId,
    onSnapshot: () => { snapshots += 1; currentId = 'conversation-b'; return 0; },
    settleDelayMs: 0,
  });

  const result = await scanner.start();

  assert.equal(result.status, 'cancelled');
  assert.equal(result.reason, 'route-changed');
  assert.equal(snapshots, 1);
  assert.equal(scroller.scrollTop, 350);
});

test('移動が停滞した場合は上限まで待たず部分取得で終える', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts');
  const document = new FakeDocument();
  document.root.append(turn('stalled', '質問', '回答', 'answer-stalled'));
  const scroller = new ScrollableElement(1_000, 200);
  Object.defineProperty(scroller, 'scrollTop', { get: () => 350, set: () => undefined });
  scroller.setOwnerDocument(document);
  scroller.append(document.root);
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window: testWindow(scroller),
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    onSnapshot: () => 0,
    settleDelayMs: 0,
    stableEdgeObservations: 2,
    maxSteps: 20,
  });

  const result = await scanner.start();

  assert.equal(result.status, 'partial');
  assert.equal(result.reason, 'scroll-stalled');
  assert.equal(result.steps, 2);
});

test('最大走査回数に達した場合は部分取得で元の位置を復元する', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts');
  const document = new FakeDocument();
  document.root.append(turn('bounded', '質問', '回答', 'answer-bounded'));
  const scroller = new ScrollableElement(1_000, 200);
  scroller.scrollTop = 350;
  scroller.setOwnerDocument(document);
  scroller.append(document.root);
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window: testWindow(scroller),
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    onSnapshot: () => 0,
    settleDelayMs: 0,
    maxSteps: 1,
    maxDurationMs: 2_000,
  });

  const result = await scanner.start();

  assert.equal(result.status, 'partial');
  assert.equal(result.reason, 'limit-reached');
  assert.equal(result.steps, 1);
  assert.equal(scroller.scrollTop, 350);
});

test('仮想化でDOMから消えるページも先頭から末尾までのスナップショットから累積する', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts');
  const document = new FakeDocument();
  const pages = [
    turn('oldest', '古い質問', '古い回答', 'answer-oldest'),
    turn('middle', '途中の質問', '途中の回答', 'answer-middle'),
    turn('newest', '新しい質問', '新しい回答', 'answer-newest'),
  ];
  document.root.append(pages[1]!);
  const scroller = new ScrollableElement(1_000, 200);
  scroller.scrollTop = 350;
  scroller.append(document.root);
  scroller.onScrollPosition = (position) => {
    document.root.querySelectorAll('[data-turn-key]').forEach((element) => element.remove());
    const pageIndex = position <= 1 ? 0 : position >= 600 ? 2 : 1;
    document.root.append(pages[pageIndex]!);
  };
  const collected = new Set<string>();
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window: testWindow(scroller),
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    onSnapshot: (snapshot) => {
      snapshot.turnKeys.forEach((key) => collected.add(key));
      return 0;
    },
    settleDelayMs: 0,
    stableEdgeObservations: 2,
    maxSteps: 20,
    maxDurationMs: 2_000,
  });

  const result = await scanner.start();

  assert.equal(result.status, 'completed');
  assert.deepEqual([...collected].sort(), ['middle', 'newest', 'oldest']);
  assert.equal(document.root.querySelectorAll('[data-turn-key]').length, 1);
});
