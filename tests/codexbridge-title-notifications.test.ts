import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TabCompletionIndicator } from '../src/content/tab-completion-indicator.ts';

const read = (path: string) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

class FakeNode {
  readonly children: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  readonly tagName: string;
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(node: FakeNode) { node.remove(); this.children.push(node); node.parentNode = this; return node; }
  remove() { if (!this.parentNode) return; const parent = this.parentNode; parent.children.splice(parent.children.indexOf(this), 1); this.parentNode = null; }
}
class FakeTitle extends FakeNode { textContent = ''; constructor() { super('TITLE'); } }
class FakeLink extends FakeNode { rel = 'icon'; href = '/favicon.ico'; type = ''; sizes = ''; constructor() { super('LINK'); } getAttribute() { return null; } setAttribute() {} }
class FakeHead extends FakeNode { constructor() { super('HEAD'); } querySelector(selector: string) { return selector === 'title' ? this.children.find((node) => node.tagName === 'TITLE') ?? null : null; } }
class FakeTarget {
  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return;
    const handlers = this.listeners.get(type) ?? new Set();
    handlers.add(typeof listener === 'function' ? listener : (event) => listener.handleEvent(event));
    this.listeners.set(type, handlers);
  }
  removeEventListener(type: string) { this.listeners.delete(type); }
  dispatch(type: string) { for (const listener of this.listeners.get(type) ?? []) listener(new Event(type)); }
}
class FakeDocument extends FakeTarget {
  readonly documentElement = new FakeNode('HTML');
  visibilityState: DocumentVisibilityState = 'visible';
  get head() { return this.documentElement.children.find((node) => node.tagName === 'HEAD') as FakeHead | undefined ?? null; }
  get title() { return (this.head?.querySelector('title') as FakeTitle | null)?.textContent ?? ''; }
  set title(value: string) {
    let element = this.head?.querySelector('title') as FakeTitle | null | undefined;
    if (!element) { element = new FakeTitle(); this.head?.appendChild(element); }
    if (element) element.textContent = value;
  }
  createElement(tag: string) { return tag.toLowerCase() === 'title' ? new FakeTitle() : new FakeLink(); }
}
class FakeWindow extends FakeTarget { setTimeout() { return 1; } clearTimeout() {} }

function createIndicator() {
  const document = new FakeDocument();
  const head = new FakeHead();
  const title = new FakeTitle(); title.textContent = 'ChatGPT';
  head.appendChild(title); document.documentElement.appendChild(head);
  const icon = new FakeLink(); head.appendChild(icon);
  const window = new FakeWindow();
  const callbacks: MutationCallback[] = [];
  const indicator = new TabCompletionIndicator({ document: document as unknown as Document, window: window as unknown as Window,
    createMutationObserver: (callback) => { callbacks.push(callback); return { observe() {}, disconnect() {} } as unknown as MutationObserver; } });
  return { document, head, window, indicator, notifyMutations() {
    for (const callback of callbacks) callback([], {} as MutationObserver);
  } };
}

test('Codex未確認通知はvisible/focusで解除せず、0件でタイトルだけを解除する', () => {
  const h = createIndicator();
  h.indicator.setCodexUnreadNotifications('conversation-a', 1);
  assert.equal(h.document.title, '● ChatGPT');
  assert.equal(h.head.children.filter((node) => node.tagName === 'LINK').length, 1);
  h.document.dispatch('visibilitychange'); h.window.dispatch('focus');
  assert.equal(h.document.title, '● ChatGPT');
  h.indicator.setCodexUnreadNotifications('conversation-a', null);
  assert.equal(h.document.title, '● ChatGPT');
  h.indicator.setCodexUnreadNotifications('conversation-a', 0);
  assert.equal(h.document.title, 'ChatGPT');
});

test('ChatGPT回答未読とCodex通知を独立保持し、どちらかが残る間は●を一つだけ表示する', () => {
  const h = createIndicator();
  h.document.visibilityState = 'hidden';
  h.indicator.setCodexUnreadNotifications('conversation-a', 2);
  h.indicator.onAnswerCompleted();
  assert.equal(h.document.title, '● ChatGPT');
  assert.equal(h.head.children.filter((node) => node.tagName === 'LINK').length, 2);
  h.indicator.setCodexUnreadNotifications('conversation-a', 0);
  assert.equal(h.document.title, '● ChatGPT');
  h.document.visibilityState = 'visible'; h.document.dispatch('visibilitychange');
  assert.equal(h.document.title, 'ChatGPT');
  assert.equal(h.head.children.filter((node) => node.tagName === 'LINK').length, 1);
});

test('会話切替で旧Codex印を外し、同会話の未取得は既知の未確認状態を維持する', () => {
  const h = createIndicator();
  h.indicator.setCodexUnreadNotifications('conversation-a', 1);
  h.indicator.setCodexUnreadNotifications('conversation-a', null);
  assert.equal(h.document.title, '● ChatGPT');
  h.indicator.setCodexUnreadNotifications('conversation-b', null);
  assert.equal(h.document.title, 'ChatGPT');
  h.indicator.setCodexUnreadNotifications('conversation-b', 1);
  assert.equal(h.document.title, '● ChatGPT');
  h.indicator.dispose();
  assert.equal(h.document.title, 'ChatGPT');
});

test('Codex印が有効な間はサイトのSPA title更新に追従し、0件で最新titleを戻す', async () => {
  const h = createIndicator();
  h.indicator.setCodexUnreadNotifications('conversation-a', 1);
  h.document.title = '別の会話';
  h.notifyMutations();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.document.title, '● 別の会話');
  h.indicator.setCodexUnreadNotifications('conversation-a', 0);
  assert.equal(h.document.title, '別の会話');
});

test('既存watch summaryから現在会話の正規件数をタイトル管理器へ渡す', async () => {
  const [panel, stats, watch] = await Promise.all([
    read('../src/content/PanelView.tsx'), read('../src/content/ConversationStatistics.tsx'),
    read('../src/content/CodexBridgeWatchPanel.tsx'),
  ]);
  assert.match(panel, /codexUnreadCount/);
  assert.match(stats, /setCodexUnreadNotifications\(/);
  assert.match(stats, /tabCompletionIndicator\.current = indicator;[\s\S]*?syncCodexUnreadTitle\(indicator, codexUnreadConversationId, codexUnreadCount\)/);
  assert.match(stats, /function syncCodexUnreadTitle\(/);
  assert.match(stats, /conversationIdFromPath\(window\.location\.pathname\)/);
  assert.match(watch, /CODEX_BRIDGE_WATCH_LIST/);
  assert.match(watch, /subscribeCodexBridgeWatchStorageChanges/);
});
