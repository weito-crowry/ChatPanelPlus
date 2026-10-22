import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationStatisticsHistoryCollector } from '../src/content/conversation-statistics-history-collector.ts';
import { ConversationStatisticsHistoryManager } from '../src/content/conversation-statistics-history-manager.ts';
import { createStatisticsStore } from '../src/shared/conversation-statistics.ts';
import { ConversationStatisticsSession } from '../src/content/conversation-statistics-session.ts';
import { FakeDocument, FakeElement, FakeWindow, turn } from './conversation-statistics-controller-fixture.ts';

class FakeIntersectionObserver {
  static latest: FakeIntersectionObserver | null = null;
  private readonly callback: IntersectionObserverCallback;
  readonly observed = new Set<Element>();
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.latest = this;
  }
  observe(element: Element): void { this.observed.add(element); }
  unobserve(element: Element): void { this.observed.delete(element); }
  disconnect(): void { this.observed.clear(); }
  enter(element: Element, isIntersecting: boolean): void {
    this.callback([{ target: element, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

function harness(turns: ReturnType<typeof turn>[]) {
  const document = new FakeDocument();
  const window = new FakeWindow();
  document.root.append(...turns);
  let rootQueryCount = 0;
  const querySelectorAll = document.root.querySelectorAll.bind(document.root);
  document.root.querySelectorAll = (selector) => {
    rootQueryCount += 1;
    return querySelectorAll(selector);
  };
  const observations: Array<{ turnKey: string; inputChars?: number; outputChars?: number; assistantState?: string }> = [];
  const collector = new ConversationStatisticsHistoryCollector({
    document: document as unknown as Document,
    window: window as unknown as Window,
    root: document.root as unknown as HTMLElement,
    onObservations: (items) => observations.push(...items),
    isScanActive: () => false,
    intersectionObserver: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
  });
  return { document, window, collector, observations, get rootQueryCount() { return rootQueryCount; } };
}

function wheel(root: ReturnType<typeof turn> | FakeDocument['root']): void {
  root.dispatchEvent(new Event('wheel', { bubbles: true }));
}

function settleTimers(window: FakeWindow): void {
  for (let index = 0; index < 4; index += 1) window.runTimeouts();
}

test('通常スクロールで既存DOMの未計測ターンが表示範囲に入ると一度だけ収集する', () => {
  const item = turn('revealed', '質問', '回答', 'assistant-revealed');
  const h = harness([item]);
  const rootScansAtInitialization = h.rootQueryCount;
  FakeIntersectionObserver.latest!.enter(item as unknown as Element, false);
  assert.equal(h.observations.length, 0);
  wheel(h.document.root);
  settleTimers(h.window);
  FakeIntersectionObserver.latest!.enter(item as unknown as Element, true);
  settleTimers(h.window);
  FakeIntersectionObserver.latest!.enter(item as unknown as Element, true);
  settleTimers(h.window);
  assert.deepEqual(h.observations.map((entry) => entry.turnKey), ['revealed']);
  assert.equal(h.rootQueryCount, rootScansAtInitialization, 'スクロールごとに会話全体を走査しない');
  h.collector.dispose();
});

test('履歴DOMの追加は直近のスクロール意図がある時だけ収集し、全履歴走査を始めない', () => {
  const h = harness([]);
  const added = turn('newly-rendered', '過去の質問', '過去の回答', 'assistant-newly-rendered');
  h.document.root.append(added);
  h.collector.handleMutations([{ target: h.document.root, addedNodes: [added], removedNodes: [] } as unknown as MutationRecord]);
  FakeIntersectionObserver.latest!.enter(added as unknown as Element, true);
  settleTimers(h.window);
  assert.equal(h.observations.length, 0);

  wheel(h.document.root);
  h.collector.handleMutations([{ target: h.document.root, addedNodes: [added], removedNodes: [] } as unknown as MutationRecord]);
  FakeIntersectionObserver.latest!.enter(added as unknown as Element, true);
  settleTimers(h.window);
  assert.equal(h.observations.length, 1);
  assert.equal(h.collector.isScanning, false);
  h.collector.dispose();
});

test('スクロール収集で生成中のAssistant本文はOUTPUTとして渡さない', () => {
  const item = turn('generating', '質問', '途中の回答', 'assistant-generating', 'in_progress');
  const h = harness([item]);
  wheel(h.document.root);
  FakeIntersectionObserver.latest!.enter(item as unknown as Element, true);
  settleTimers(h.window);
  assert.equal(h.observations[0]?.inputChars, 2);
  assert.equal(h.observations[0]?.outputChars, undefined);
  assert.equal(h.observations[0]?.assistantState, 'in_progress');
  h.collector.dispose();
});

test('Controller履歴管理は通常スクロールを累積するが全履歴走査を開始しない', () => {
  const item = turn('passive-turn', '質問', '回答', 'assistant-passive');
  const h = harness([item]);
  const session = new ConversationStatisticsSession('conversation-passive', createStatisticsStore(), [], []);
  let dirty = 0;
  const manager = new ConversationStatisticsHistoryManager({
    document: h.document as unknown as Document,
    window: h.window as unknown as Window,
    root: h.document.root as unknown as HTMLElement,
    conversationId: 'conversation-passive',
    currentConversationId: () => 'conversation-passive',
    getCurrentRoot: () => h.document.root as unknown as HTMLElement,
    getSession: () => session,
    isDisposed: () => false,
    onDirty: () => { dirty += 1; },
    onState: () => undefined,
    intersectionObserver: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
  });
  FakeIntersectionObserver.latest!.enter(item as unknown as Element, true);
  wheel(h.document.root);
  settleTimers(h.window);

  assert.equal(session.statistics().turns, 1);
  assert.equal(dirty, 1);
  assert.equal(manager.state.scanning, false);
  assert.equal(manager.state.outcome, null);
  manager.dispose();
  h.collector.dispose();
});

test('main外の会話スクロール祖先からのwheelもユーザー意図として扱う', () => {
  const document = new FakeDocument();
  const item = turn('outer-scroll-turn', '質問', '回答', 'assistant-outer');
  document.root.append(item);
  const outer = new FakeElement('div');
  Object.defineProperties(outer, {
    scrollHeight: { value: 900 }, clientHeight: { value: 200 }, scrollTop: { value: 100, writable: true },
  });
  outer.setOwnerDocument(document);
  outer.append(document.root);
  const window = new FakeWindow();
  Object.defineProperty(window, 'getComputedStyle', { value: (element: Element) => ({ overflowY: element === (outer as unknown as Element) ? 'auto' : 'visible' }) });
  const observations: string[] = [];
  const collector = new ConversationStatisticsHistoryCollector({
    document: document as unknown as Document,
    window: window as unknown as Window,
    root: document.root as unknown as HTMLElement,
    onObservations: (items) => observations.push(...items.map((entry) => entry.turnKey)),
    isScanActive: () => false,
    intersectionObserver: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
  });
  FakeIntersectionObserver.latest!.enter(item as unknown as Element, true);
  wheel(outer);
  settleTimers(window);

  assert.deepEqual(observations, ['outer-scroll-turn']);
  collector.dispose();
});
