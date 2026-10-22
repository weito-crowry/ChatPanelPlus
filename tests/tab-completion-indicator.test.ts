import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchAnswerCompletionNotifications } from '../src/content/answer-completion-notifications.ts';
import { TabCompletionIndicator } from '../src/content/tab-completion-indicator.ts';

type ObserverOptions = { readonly subtree?: boolean };

class FakeNode {
  readonly children: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  readonly observers = new Set<FakeMutationObserver>();
  readonly tagName: string;

  constructor(tagName: string) { this.tagName = tagName; }

  get firstChild(): FakeNode | null { return this.children[0] ?? null; }
  get lastChild(): FakeNode | null { return this.children.at(-1) ?? null; }

  appendChild(node: FakeNode): FakeNode {
    node.remove();
    this.children.push(node);
    node.parentNode = this;
    this.changed();
    return node;
  }

  insertBefore(node: FakeNode, before: FakeNode | null): FakeNode {
    node.remove();
    const index = before ? this.children.indexOf(before) : -1;
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
    node.parentNode = this;
    this.changed();
    return node;
  }

  remove(): void {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children.splice(index, 1);
    this.parentNode = null;
    parent.changed();
  }

  changed(): void {
    this.notifyObservers(false);
  }

  private notifyObservers(nested: boolean): void {
    for (const observer of this.observers) {
      if (!nested || observer.options.subtree) observer.schedule();
    }
    this.parentNode?.notifyObservers(true);
  }
}

class FakeTitle extends FakeNode {
  private value = '';
  constructor() { super('TITLE'); }
  get textContent(): string { return this.value; }
  set textContent(value: string) { this.value = value; this.changed(); }
}

class FakeLink extends FakeNode {
  rel = 'icon';
  type = '';
  sizes = '';
  private value = '';
  private readonly attributes = new Map<string, string>();
  constructor() { super('LINK'); }
  get href(): string { return this.value; }
  set href(value: string) { this.value = value; this.changed(); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); this.changed(); }
}

class FakeHead extends FakeNode {
  constructor() { super('HEAD'); }
  querySelector(selector: string): FakeNode | null {
    if (selector === 'title') return this.children.find((node) => node.tagName === 'TITLE') ?? null;
    return null;
  }
}

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(typeof listener === 'function' ? listener : (event) => listener.handleEvent(event));
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const registered of listeners) {
      if (registered === listener || registered.toString() === listener.toString()) listeners.delete(registered);
    }
    if (listeners.size === 0) this.listeners.delete(type);
  }
  dispatch(type: string, properties: Record<string, unknown> = {}): void {
    const event = new Event(type);
    for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  listenerCount(type?: string): number {
    return type ? this.listeners.get(type)?.size ?? 0 : [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

class FakeDocument extends FakeEventTarget {
  readonly documentElement = new FakeNode('HTML');
  visibilityState: DocumentVisibilityState = 'hidden';
  get head(): FakeHead | null {
    return this.documentElement.children.find((node) => node.tagName === 'HEAD') as FakeHead | undefined ?? null;
  }
  get title(): string { return (this.head?.querySelector('title') as FakeTitle | null)?.textContent ?? ''; }
  set title(value: string) {
    let title = this.head?.querySelector('title') as FakeTitle | null | undefined;
    if (!title) {
      title = new FakeTitle();
      this.head?.appendChild(title);
    }
    if (title) title.textContent = value;
  }
  createElement(tagName: string): FakeNode { return tagName.toLowerCase() === 'title' ? new FakeTitle() : new FakeLink(); }
}

class FakeMutationObserver {
  private readonly targets = new Set<FakeNode>();
  private connected = false;
  private queued = false;
  private readonly callback: MutationCallback;
  options: ObserverOptions = {};
  constructor(callback: MutationCallback) { this.callback = callback; }
  observe(target: FakeNode, options: ObserverOptions): void {
    this.options = options;
    this.targets.add(target);
    target.observers.add(this);
    this.connected = true;
  }
  disconnect(): void {
    this.connected = false;
    for (const target of this.targets) target.observers.delete(this);
    this.targets.clear();
  }
  schedule(): void {
    if (!this.connected || this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (this.connected) this.callback([], this as unknown as MutationObserver);
    });
  }
  get isDisconnected(): boolean { return !this.connected; }
}

class FakeWindow extends FakeEventTarget {
  private nextTimer = 0;
  readonly timers = new Map<number, { readonly callback: () => void; readonly delay: number }>();
  setTimeout(callback: () => void, delay: number): number {
    const id = ++this.nextTimer;
    this.timers.set(id, { callback, delay });
    return id;
  }
  clearTimeout(id: number): void { this.timers.delete(id); }
  runNextTimer(): number {
    const entry = this.timers.entries().next().value as [number, { callback: () => void; delay: number }] | undefined;
    assert.ok(entry, '点滅タイマーが予約されている');
    this.timers.delete(entry[0]);
    entry[1].callback();
    return entry[1].delay;
  }
}

function createHarness(options: { title?: string | null; icons?: string[]; visibility?: DocumentVisibilityState } = {}) {
  const document = new FakeDocument();
  document.visibilityState = options.visibility ?? 'hidden';
  const head = new FakeHead();
  document.documentElement.appendChild(head);
  if (options.title !== null) {
    const title = new FakeTitle();
    title.textContent = options.title ?? 'ChatGPT';
    head.appendChild(title);
  }
  for (const href of options.icons ?? ['/favicon.ico']) {
    const link = new FakeLink();
    link.rel = 'icon';
    link.sizes = '32x32';
    link.href = href;
    head.appendChild(link);
  }
  const window = new FakeWindow();
  const observers: FakeMutationObserver[] = [];
  const indicator = new TabCompletionIndicator({
    document: document as unknown as Document,
    window: window as unknown as Window,
    createMutationObserver: (callback) => {
      const observer = new FakeMutationObserver(callback);
      observers.push(observer);
      return observer as unknown as MutationObserver;
    },
  });
  return { document, window, head, observers, indicator };
}

function iconLinks(head: FakeHead): FakeLink[] { return head.children.filter((node) => node.tagName === 'LINK') as FakeLink[]; }
function indicatorLink(head: FakeHead): FakeLink | undefined { return iconLinks(head).find((link) => link.type === 'image/svg+xml'); }
async function flushMutations(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

test('表示中に確定した完了ではタイトルやfaviconを変更しない', () => {
  const h = createHarness({ visibility: 'visible' });
  const oldTitle = h.document.title;
  const oldIcons = iconLinks(h.head).map((link) => link.href);
  h.indicator.onAnswerCompleted();
  assert.equal(h.document.title, oldTitle);
  assert.deepEqual(iconLinks(h.head).map((link) => link.href), oldIcons);
  assert.equal(h.window.timers.size, 0);
  assert.equal(h.document.listenerCount(), 0);
});

test('非表示完了はローカルSVG faviconと未確認タイトルを追加する', () => {
  const h = createHarness();
  h.indicator.onAnswerCompleted();
  assert.equal(h.document.title, '● ChatGPT');
  assert.equal(iconLinks(h.head).length, 2);
  const marked = indicatorLink(h.head);
  assert.ok(marked);
  assert.equal(marked.rel, 'icon');
  assert.match(marked.href, /^data:image\/svg\+xml,/);
  assert.equal(marked.type, 'image/svg+xml');
});

test('複数完了でも点滅timerは一つで、3往復後は未確認faviconを固定表示する', () => {
  const h = createHarness();
  h.indicator.onAnswerCompleted();
  const link = indicatorLink(h.head);
  assert.ok(link);
  const firstIcon = link.href;
  h.indicator.onAnswerCompleted();
  assert.equal(h.window.timers.size, 1);
  for (let index = 0; index < 6; index += 1) {
    assert.equal(h.window.runNextTimer(), 500);
    assert.equal(h.document.title, '● ChatGPT');
    assert.match(decodeURIComponent(link.href.split(',')[1] ?? ''), /<svg/);
    assert.equal(h.window.timers.size, index === 5 ? 0 : 1);
  }
  assert.equal(link.href, firstIcon);
});

test('遅延・停止中の点滅でもどちらのfavicon相も未確認印とタイトルを保つ', () => {
  const h = createHarness();
  h.indicator.onAnswerCompleted();
  const link = indicatorLink(h.head);
  assert.ok(link);
  const firstIcon = link.href;
  assert.equal(h.window.timers.size, 1);
  assert.equal(h.document.title, '● ChatGPT');
  const delay = h.window.runNextTimer();
  assert.equal(delay, 500);
  assert.notEqual(link.href, firstIcon);
  assert.equal(h.document.title, '● ChatGPT');
  assert.equal(h.window.timers.size, 1);
  assert.match(link.href, /^data:image\/svg\+xml,/);
});

test('サイトが隠れている間に題名を変えると追従し、visible復帰で最新値へ戻す', async () => {
  const h = createHarness();
  h.indicator.onAnswerCompleted();
  h.document.title = 'New ChatGPT title';
  await flushMutations();
  assert.equal(h.document.title, '● New ChatGPT title');
  h.document.visibilityState = 'visible';
  h.document.dispatch('visibilitychange');
  assert.equal(h.document.title, 'New ChatGPT title');
  assert.equal(indicatorLink(h.head), undefined);
  assert.equal(h.window.timers.size, 0);
  assert.equal(h.document.listenerCount(), 0);
});

test('SPAのtitle変更中はhiddenマークを保ち、focus・pageshowはvisible時だけ解除する', async () => {
  const h = createHarness();
  h.indicator.onAnswerCompleted();
  h.document.title = 'Another conversation';
  await flushMutations();
  assert.equal(h.document.title, '● Another conversation');
  h.window.dispatch('focus');
  assert.equal(h.document.title, '● Another conversation');
  h.document.visibilityState = 'visible';
  h.window.dispatch('focus');
  assert.equal(h.document.title, 'Another conversation');

  h.document.visibilityState = 'hidden';
  h.indicator.onAnswerCompleted();
  h.document.visibilityState = 'visible';
  h.window.dispatch('pageshow');
  assert.equal(h.document.title, 'Another conversation');
  assert.equal(indicatorLink(h.head), undefined);
});

test('MutationObserverが動く前に表示へ戻ってもサイトの新しい題名を上書きしない', () => {
  const h = createHarness();
  h.indicator.onAnswerCompleted();
  h.document.title = 'Updated immediately';
  h.document.visibilityState = 'visible';
  h.document.dispatch('visibilitychange');
  assert.equal(h.document.title, 'Updated immediately');
  assert.equal(indicatorLink(h.head), undefined);
});

test('faviconがないページにも追加でき、複数faviconとサイト変更を保持する', async () => {
  const noIcon = createHarness({ title: null, icons: [] });
  noIcon.indicator.onAnswerCompleted();
  assert.ok(indicatorLink(noIcon.head));
  assert.equal(noIcon.document.title, '● ');
  noIcon.document.visibilityState = 'visible';
  noIcon.document.dispatch('visibilitychange');
  assert.equal(noIcon.document.title, '');
  assert.equal(noIcon.head.querySelector('title'), null);

  const h = createHarness({ icons: ['/small.ico', '/large.png'] });
  const originals = iconLinks(h.head);
  h.indicator.onAnswerCompleted();
  originals[0]!.href = '/updated-small.ico';
  const later = new FakeLink();
  later.rel = 'shortcut icon';
  later.sizes = '64x64';
  later.href = '/spa-icon.svg';
  h.head.appendChild(later);
  await flushMutations();
  const owned = indicatorLink(h.head);
  assert.ok(owned);
  assert.equal(h.head.lastChild, owned);
  assert.equal(originals[0]!.href, '/updated-small.ico');
  assert.equal(originals[1]!.href, '/large.png');
  h.document.visibilityState = 'visible';
  h.document.dispatch('visibilitychange');
  assert.equal(indicatorLink(h.head), undefined);
  assert.equal(later.parentNode, h.head);
  assert.equal(later.rel, 'shortcut icon');
  assert.equal(later.href, '/spa-icon.svg');
});

test('head交換後もサイトのtitle/faviconを保護して専用linkを管理する', async () => {
  const h = createHarness();
  h.indicator.onAnswerCompleted();
  const replacement = new FakeHead();
  const title = new FakeTitle();
  title.textContent = 'SPA document title';
  replacement.appendChild(title);
  const icon = new FakeLink();
  icon.href = '/new-head.ico';
  replacement.appendChild(icon);
  h.head.remove();
  h.document.documentElement.appendChild(replacement);
  await flushMutations();
  assert.equal(h.document.title, '● SPA document title');
  assert.ok(indicatorLink(replacement));
  h.document.visibilityState = 'visible';
  h.document.dispatch('visibilitychange');
  assert.equal(h.document.title, 'SPA document title');
  assert.equal(icon.href, '/new-head.ico');
  assert.equal(indicatorLink(replacement), undefined);
});

test('disposeとF5相当のpagehideはtimer・observer・listener・DOM変更を解放する', () => {
  const h = createHarness();
  h.indicator.onAnswerCompleted();
  const observers = [...h.observers];
  assert.ok(h.window.timers.size > 0);
  assert.ok(h.document.listenerCount('visibilitychange') > 0);
  h.indicator.dispose();
  h.indicator.dispose();
  assert.equal(h.document.title, 'ChatGPT');
  assert.equal(indicatorLink(h.head), undefined);
  assert.equal(h.window.timers.size, 0);
  assert.equal(h.document.listenerCount(), 0);
  assert.ok(observers.every((observer) => observer.isDisconnected));

  const pagehide = createHarness();
  pagehide.indicator.onAnswerCompleted();
  pagehide.window.dispatch('pagehide', { persisted: false });
  assert.equal(pagehide.document.title, 'ChatGPT');
  assert.equal(indicatorLink(pagehide.head), undefined);
  assert.equal(pagehide.window.timers.size, 0);
  pagehide.document.visibilityState = 'hidden';
  pagehide.indicator.onAnswerCompleted();
  assert.equal(indicatorLink(pagehide.head), undefined);
});

test('React StrictMode相当の再生成で古いtimerを残さず、新しい通知だけを管理する', () => {
  const h = createHarness();
  h.indicator.onAnswerCompleted();
  h.indicator.dispose();
  const remounted = new TabCompletionIndicator({
    document: h.document as unknown as Document,
    window: h.window as unknown as Window,
    createMutationObserver: (callback) => {
      const observer = new FakeMutationObserver(callback);
      h.observers.push(observer);
      return observer as unknown as MutationObserver;
    },
  });
  remounted.onAnswerCompleted();
  assert.equal(iconLinks(h.head).length, 2);
  assert.equal(h.window.timers.size, 1);
  remounted.dispose();
  assert.equal(iconLinks(h.head).length, 1);
  assert.equal(h.window.timers.size, 0);
});

test('音OFF・音量0でも未表示タブ通知を出し、再生失敗でも未読表示を残す', () => {
  const off = createHarness();
  let offSoundCalls = 0;
  dispatchAnswerCompletionNotifications({
    notifyTab: () => off.indicator.onAnswerCompleted(),
    soundEnabled: false,
    soundVolumePercent: 60,
    playSound: () => { offSoundCalls += 1; },
  });
  assert.equal(offSoundCalls, 0);
  assert.equal(off.document.title, '● ChatGPT');

  const muted = createHarness();
  dispatchAnswerCompletionNotifications({
    notifyTab: () => muted.indicator.onAnswerCompleted(),
    soundEnabled: true,
    soundVolumePercent: 0,
    playSound: () => assert.fail('0%では音声要求しない'),
  });
  assert.equal(muted.document.title, '● ChatGPT');

  const failed = createHarness();
  dispatchAnswerCompletionNotifications({
    notifyTab: () => failed.indicator.onAnswerCompleted(),
    soundEnabled: true,
    soundVolumePercent: 60,
    playSound: () => { throw new Error('device unavailable'); },
  });
  assert.equal(failed.document.title, '● ChatGPT');
  assert.ok(indicatorLink(failed.head));
});

test('視覚通知が失敗しても有効な音声通知まで抑止しない', () => {
  let soundCalls = 0;
  dispatchAnswerCompletionNotifications({
    notifyTab: () => { throw new Error('DOM update failed'); },
    soundEnabled: true,
    soundVolumePercent: 60,
    playSound: () => { soundCalls += 1; },
  });
  assert.equal(soundCalls, 1);
});
