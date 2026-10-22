import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeDocument, FakeElement, turn } from './conversation-statistics-controller-fixture.ts';

class ScrollableElement extends FakeElement {
  private position = 0;
  readonly scrollHeight = 1_000;
  readonly clientHeight = 200;
  readonly offsetWidth = 500;
  readonly clientWidth = 485;
  beforeScrollTopChange: ((position: number) => void) | null = null;
  onScrollPosition: ((position: number) => void) | null = null;

  constructor() { super('div'); }
  get scrollTop(): number { return this.position; }
  set scrollTop(position: number) {
    this.beforeScrollTopChange?.(position);
    this.position = position;
    this.onScrollPosition?.(position);
  }
  setPositionWithoutEvent(position: number): void { this.position = position; }
  getBoundingClientRect(): DOMRect {
    return { top: 0, bottom: 200, left: 0, right: 500, width: 500, height: 200 } as DOMRect;
  }
}

function testWindow(scrollable: ScrollableElement): Window {
  return {
    location: { search: '' },
    getComputedStyle: (element: Element) => ({ overflowY: element === (scrollable as unknown as Element) ? 'auto' : 'visible' }),
    setTimeout: (callback: TimerHandler, delay?: number) => globalThis.setTimeout(callback, delay) as unknown as number,
    clearTimeout: (timer: number) => globalThis.clearTimeout(timer),
  } as unknown as Window;
}

function setup() {
  const document = new FakeDocument();
  document.root.append(turn('visible', '質問', '回答', 'answer-visible'));
  const scroller = new ScrollableElement();
  scroller.scrollTop = 350;
  scroller.setOwnerDocument(document);
  scroller.append(document.root);
  return { document, scroller, window: testWindow(scroller) };
}

function eventWith(type: string, values: Record<string, string | number>): Event {
  const event = new Event(type, { bubbles: true });
  for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value });
  return event;
}

test('遅れて届く同一自動スクロールの複数scrollイベントでは中止しない', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts');
  const { document, scroller, window } = setup();
  let assignments = 0;
  let queuedEvents = 0;
  scroller.beforeScrollTopChange = () => {
    if (assignments === 1) {
      while (queuedEvents > 0) {
        queuedEvents -= 1;
        scroller.dispatchEvent(new Event('scroll'));
      }
    }
    assignments += 1;
  };
  scroller.onScrollPosition = (position) => { if (position !== 350) queuedEvents += 2; };
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window,
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    onSnapshot: () => 0,
    settleDelayMs: 0,
    stableEdgeObservations: 2,
  });

  const result = await scanner.start();

  assert.equal(result.status, 'completed');
  assert.equal(result.reason, null);
  assert.ok(result.steps > 1);
});

test('履歴読み込みによるscrollTop補正と複数scrollイベントでは中止しない', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts');
  const { document, scroller, window } = setup();
  let corrected = false;
  scroller.onScrollPosition = (position) => {
    if (corrected || position === 350) return;
    corrected = true;
    scroller.setPositionWithoutEvent(position + 8);
    scroller.dispatchEvent(new Event('scroll'));
    scroller.dispatchEvent(new Event('scroll'));
  };
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window,
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    onSnapshot: () => 0,
    settleDelayMs: 0,
    stableEdgeObservations: 2,
  });

  const result = await scanner.start();

  assert.equal(corrected, true);
  assert.equal(result.status, 'completed');
  assert.equal(result.reason, null);
});

test('マウス移動だけでは走査を中止しない', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts');
  const { document, scroller, window } = setup();
  let moved = false;
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window,
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    onSnapshot: () => {
      if (!moved) {
        moved = true;
        document.root.dispatchEvent(new Event('mousemove', { bubbles: true }));
      }
      return 0;
    },
    settleDelayMs: 0,
    stableEdgeObservations: 2,
  });

  const result = await scanner.start();

  assert.equal(result.status, 'completed');
  assert.equal(result.reason, null);
  assert.equal(scroller.scrollTop, 350);
});

test('ホイール・タッチ・スクロールキー入力で走査を中止する', async (t) => {
  const history = await import('../src/content/conversation-statistics-history.ts');
  for (const [name, input] of [
    ['wheel', () => new Event('wheel', { bubbles: true })],
    ['touch', () => new Event('touchstart', { bubbles: true })],
    ['scroll key', () => eventWith('keydown', { key: 'PageDown' })],
  ] as const) {
    await t.test(name, async () => {
      const { document, window } = setup();
      let sent = false;
      const scanner = new history.ConversationStatisticsHistoryScanner({
        document: document as unknown as Document,
        window,
        root: document.root as unknown as HTMLElement,
        conversationId: 'conversation-a',
        currentConversationId: () => 'conversation-a',
        onSnapshot: () => {
          if (!sent) {
            sent = true;
            document.root.dispatchEvent(input());
          }
          return 0;
        },
        settleDelayMs: 0,
      });

      const result = await scanner.start();

      assert.equal(result.status, 'cancelled');
      assert.equal(result.reason, 'user-input');
    });
  }
});

test('bodyを対象にしたスクロールキーも走査を中止する', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts');
  const { document, window } = setup();
  const body = new FakeElement('body');
  Object.defineProperty(document, 'body', { value: body });
  body.setOwnerDocument(document);
  let sent = false;
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window,
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    onSnapshot: () => {
      if (!sent) {
        sent = true;
        body.dispatchEvent(eventWith('keydown', { key: 'PageDown' }));
      }
      return 0;
    },
    settleDelayMs: 0,
  });

  const result = await scanner.start();

  assert.equal(result.status, 'cancelled');
  assert.equal(result.reason, 'user-input');
});

test('スクロールバーをドラッグして位置が変わった場合に走査を中止して位置を保つ', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts');
  const { document, scroller, window } = setup();
  let dragged = false;
  scroller.onScrollPosition = () => {
    if (dragged) return;
    dragged = true;
    scroller.dispatchEvent(eventWith('pointerdown', {
      pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1, clientX: 494, clientY: 80,
    }));
    scroller.setPositionWithoutEvent(275);
    scroller.dispatchEvent(eventWith('pointermove', {
      pointerId: 7, pointerType: 'mouse', button: -1, buttons: 1, clientX: 494, clientY: 120,
    }));
  };
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window,
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    onSnapshot: () => 0,
    settleDelayMs: 0,
  });

  const result = await scanner.start();

  assert.equal(dragged, true);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.reason, 'user-input');
  assert.equal(scroller.scrollTop, 275);
});

test('ルートDOM破棄はroot-disposedとして安全に終了する', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts');
  const { document, scroller, window } = setup();
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window,
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    onSnapshot: () => { document.root.remove(); return 0; },
    settleDelayMs: 0,
  });

  const result = await scanner.start();

  assert.equal(result.status, 'cancelled');
  assert.equal(result.reason, 'root-disposed');
  assert.equal(scroller.scrollTop, 350);
});

test('時間上限ではcancelledではなくlimit-reachedの部分取得を返す', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts');
  const { document, scroller, window } = setup();
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window,
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    onSnapshot: () => 0,
    settleDelayMs: 0,
    maxDurationMs: 0,
  });

  const result = await scanner.start();

  assert.equal(result.status, 'partial');
  assert.equal(result.reason, 'limit-reached');
  assert.equal(scroller.scrollTop, 350);
});

test('例外はunexpected-errorのerror結果として記録する', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts');
  const { document, window } = setup();
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window,
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    onSnapshot: () => { throw new Error('diagnostic failure'); },
    settleDelayMs: 0,
  });

  const result = await scanner.start();

  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'unexpected-error');
});

test('中止理由ログはcppDebugInteraction指定時に一度だけ出力する', async () => {
  const history = await import('../src/content/conversation-statistics-history.ts');
  const { document, scroller, window } = setup();
  Object.defineProperty(window.location, 'search', { configurable: true, value: '?cppDebugInteraction=1' });
  const originalDebug = console.debug;
  const messages: unknown[][] = [];
  console.debug = (...args: unknown[]) => { messages.push(args); };
  const scanner = new history.ConversationStatisticsHistoryScanner({
    document: document as unknown as Document,
    window,
    root: document.root as unknown as HTMLElement,
    conversationId: 'conversation-a',
    currentConversationId: () => 'conversation-a',
    onSnapshot: () => { scanner.cancel(); return 0; },
    settleDelayMs: 0,
  });

  try {
    const result = await scanner.start();
    assert.equal(result.reason, 'explicit-cancel');
    assert.equal(scroller.scrollTop, 350);
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0]?.[1], {
      status: 'cancelled', reason: 'explicit-cancel', steps: 0, turnKeysSeen: 1, newlyMeasuredTurns: 0,
    });
  } finally {
    console.debug = originalDebug;
  }
});
