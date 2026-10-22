import { createStatisticsStore, type StatisticsStore } from '../src/shared/conversation-statistics.ts';
import type { StatisticsSaveResult } from '../src/shared/conversation-statistics-repository.ts';
import type { StoredConversationStatistics } from '../src/shared/conversation-statistics.ts';
import { ConversationStatisticsController, type ConversationStatisticsViewState } from '../src/content/conversation-statistics-controller.ts';
import { FakeEventTarget } from './fake-event-target.ts';

function dispatchThroughTree(target: FakeElement, event: Event): boolean {
  const path: FakeEventTarget[] = [target];
  let top = target;
  while (top.parentElement) {
    top = top.parentElement;
    path.push(top);
  }
  if (top.isConnected && top.ownerDocument instanceof FakeEventTarget) path.push(top.ownerDocument);
  Object.defineProperty(event, 'target', { configurable: true, value: target });
  for (let index = path.length - 1; index > 0; index -= 1) path[index]!.dispatchAt(event, true, 1);
  target.dispatchAt(event, true, 2);
  target.dispatchAt(event, false, 2);
  if (event.bubbles) {
    for (let index = 1; index < path.length; index += 1) path[index]!.dispatchAt(event, false, 3);
  }
  Object.defineProperties(event, {
    currentTarget: { configurable: true, value: null },
    eventPhase: { configurable: true, value: 0 },
  });
  return !event.defaultPrevented;
}

export class FakeElement extends FakeEventTarget {
  readonly attributes: Record<string, string>;
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  ownerDocument: EventTarget | null = null;
  hidden = false;
  isConnected = true;
  cloneFails = false;

  constructor(tagName = 'div', attributes: Record<string, string> = {}, text = '') {
    super();
    this.tagName = tagName.toLowerCase();
    this.attributes = attributes;
    this.text = text;
  }

  text: string;
  get isContentEditable(): boolean { return this.getAttribute('contenteditable') === 'true'; }
  get innerText(): string { return this.text + this.children.map((child) => child.innerText).join(''); }
  get textContent(): string { return this.innerText; }
  getClientRects(): DOMRect[] { return [{} as DOMRect]; }
  checkVisibility(): boolean { return true; }
  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
  hasAttribute(name: string): boolean { return name in this.attributes; }
  append(...children: FakeElement[]): void {
    for (const child of children) {
      child.parentElement = this;
      child.isConnected = this.isConnected;
      child.setOwnerDocument(this.ownerDocument);
      this.children.push(child);
    }
  }
  setOwnerDocument(ownerDocument: EventTarget | null): void {
    this.ownerDocument = ownerDocument;
    this.children.forEach((child) => child.setOwnerDocument(ownerDocument));
  }
  override dispatchEvent(event: Event): boolean { return dispatchThroughTree(this, event); }
  remove(): void {
    if (!this.parentElement) return;
    this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
    this.isConnected = false;
  }
  contains(target: FakeElement): boolean {
    return this === target || this.children.some((child) => child.contains(target));
  }
  closest(selector: string): FakeElement | null {
    return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null;
  }
  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const trimmed = part.trim();
      if (trimmed === '*') return true;
      if (trimmed === '[data-turn-key]') return 'data-turn-key' in this.attributes;
      const contains = /^\[([^\]]+)\*="([^"]+)"\]$/u.exec(trimmed);
      if (contains) return (this.attributes[contains[1]!] ?? '').includes(contains[2]!);
      const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/u.exec(trimmed);
      if (attribute) return attribute[2] === undefined
        ? attribute[1]! in this.attributes
        : this.attributes[attribute[1]!] === attribute[2];
      const compound = /^#([^[]+)\[([^=]+)="([^"]+)"\]$/u.exec(trimmed);
      if (compound) return this.attributes.id === compound[1] && this.attributes[compound[2]!] === compound[3];
      return this.tagName === trimmed.toLowerCase();
    });
  }
  querySelectorAll(selector: string): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.querySelectorAll(selector)])
      .filter((child) => child.matches(selector));
  }
  cloneNode(deep = false): FakeElement {
    if (this.cloneFails) throw new Error('text clone unavailable');
    const clone = new FakeElement(this.tagName, { ...this.attributes }, this.text);
    if (deep) clone.append(...this.children.map((child) => child.cloneNode(true)));
    return clone;
  }
}

export class FakeDocument extends FakeEventTarget {
  root = new FakeElement('main');
  editor: FakeElement;
  form: FakeElement;

  constructor() {
    super();
    this.root.setOwnerDocument(this);
    this.form = new FakeElement('form', { 'data-chatgpt-composer': '' });
    this.editor = new FakeElement('div', { id: 'prompt-textarea', contenteditable: 'true' });
    this.form.append(this.editor);
    this.root.append(this.form);
  }
  querySelector(selector: string): FakeElement | null { return selector === 'main' ? this.root : null; }
  querySelectorAll(selector: string): FakeElement[] {
    return this.root.querySelectorAll(selector);
  }
}

export class FakeWindow extends EventTarget {
  readonly location = { pathname: '/' };
  interval: (() => void) | null = null;
  nextTimerId = 0;
  readonly timeouts = new Map<number, () => void>();
  setInterval(callback: () => void): number { this.interval = callback; return ++this.nextTimerId; }
  clearInterval(): void { this.interval = null; }
  setTimeout(callback: () => void): number { const id = ++this.nextTimerId; this.timeouts.set(id, callback); return id; }
  clearTimeout(id: number): void { this.timeouts.delete(id); }
  runTimeouts(): void {
    const callbacks = [...this.timeouts.values()];
    this.timeouts.clear();
    callbacks.forEach((callback) => callback());
  }
}

export class FakeMutationObserver {
  static latest: FakeMutationObserver | null = null;
  callback: (records: readonly MutationRecord[]) => void;
  disconnected = false;
  constructor(callback: (records: readonly MutationRecord[]) => void) { this.callback = callback; FakeMutationObserver.latest = this; }
  observe(): void {}
  disconnect(): void { this.disconnected = true; }
  notify(target: FakeElement, added: FakeElement, removed: FakeElement[] = []): void {
    this.callback([{ target, addedNodes: [added], removedNodes: removed } as unknown as MutationRecord]);
  }
}

Object.defineProperty(globalThis, 'Element', { configurable: true, value: FakeElement });
Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: FakeMutationObserver });

export function turn(turnKey: string, input: string, answer: string, assistantId: string, assistantState = 'complete'): FakeElement {
  const turnElement = new FakeElement('div', { 'data-turn-key': turnKey });
  const state = new FakeElement('div', { 'data-talvt-turn-state': assistantState });
  const user = new FakeElement('div', { 'data-user-message-bubble': '' }, input);
  const assistant = new FakeElement('div', { 'data-chatgpt-selection-message-id': assistantId });
  assistant.append(new FakeElement('div', { 'data-dil-message-id': assistantId }, answer));
  state.append(user, assistant);
  turnElement.append(state);
  return turnElement;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve: (value: T) => resolve(value) };
}

export async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

export interface HarnessRepositoryOverrides {
  loadStore?: () => Promise<{ ok: true; store: StatisticsStore }>;
  saveConversation?: (conversationId: string, conversation: StoredConversationStatistics) => Promise<StatisticsSaveResult>;
}

export function harness(
  pathname: string,
  delayedLoad = false,
  initialStore = createStatisticsStore(),
  repositoryOverrides: HarnessRepositoryOverrides = {},
) {
  const document = new FakeDocument();
  const window = new FakeWindow();
  window.location.pathname = pathname;
  const states: Array<{
    conversationId: string | null;
    aggregate: { turns: number; inputChars: number; outputChars: number; partial: boolean };
    loading: boolean;
    historyScan: ConversationStatisticsViewState['historyScan'];
  }> = [];
  const deferredLoad = deferred<{ ok: true; store: StatisticsStore }>();
  let loadCount = 0;
  const repository = {
    loadStore: async () => {
      loadCount += 1;
      return repositoryOverrides.loadStore
        ? repositoryOverrides.loadStore()
        : delayedLoad ? deferredLoad.promise : { ok: true as const, store: initialStore };
    },
    saveConversation: repositoryOverrides.saveConversation ?? (async (_conversationId, conversation) => ({ ok: true as const, conversation })),
  };
  const controller = new ConversationStatisticsController({
    document: document as unknown as Document,
    window: window as unknown as Window,
    repository: repository as never,
    onState: (state) => states.push({ conversationId: state.conversationId, aggregate: state.aggregate, loading: state.loading, historyScan: state.historyScan }),
  });
  return {
    document,
    window,
    controller,
    states,
    deferredLoad,
    get loadCount() { return loadCount; },
    latestState() { return states.at(-1); },
  };
}

export function dispatchKeyDown(target: FakeElement, options: { key?: string; keyCode?: number; shiftKey?: boolean; isComposing?: boolean } = {}): Event {
  const event = new Event('keydown', { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    key: { value: options.key ?? 'Enter' }, keyCode: { value: options.keyCode ?? 13 },
    shiftKey: { value: options.shiftKey ?? false }, isComposing: { value: options.isComposing ?? false },
  });
  target.dispatchEvent(event);
  return event;
}
