import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodexWorkModeRouteObserver } from '../src/content/codex-work-mode-route.ts';

function createWindow(pathname: string) {
  const listeners = new Map<string, Set<EventListener>>();
  const intervals = new Map<number, () => void>();
  let nextInterval = 0;
  const window = {
    location: { pathname },
    addEventListener(type: string, listener: EventListener) {
      const bucket = listeners.get(type) ?? new Set<EventListener>();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type: string, listener: EventListener) { listeners.get(type)?.delete(listener); },
    setInterval(callback: () => void) { const id = ++nextInterval; intervals.set(id, callback); return id; },
    clearInterval(id: number) { intervals.delete(id); },
  };
  return {
    window: window as unknown as Window,
    listeners,
    intervals,
    dispatch(type: string) { listeners.get(type)?.forEach((listener) => listener(new Event(type))); },
    tick() { [...intervals.values()].forEach((callback) => callback()); },
  };
}

test('route observer resets on popstate and detects pushState or link navigation on its poll', () => {
  const fake = createWindow('/');
  const observer = createCodexWorkModeRouteObserver(fake.window);
  const routes: (string | null)[] = [];
  const unsubscribe = observer.subscribe((conversationId) => routes.push(conversationId));

  fake.window.location.pathname = '/c/conversation-one';
  fake.dispatch('popstate');
  fake.window.location.pathname = '/c/conversation-two';
  fake.tick();
  fake.window.location.pathname = '/';
  fake.tick();

  assert.deepEqual(routes, [null, 'conversation-one', 'conversation-two', null]);
  unsubscribe();
  assert.equal(fake.intervals.size, 0);
  assert.equal(fake.listeners.get('popstate')?.size, 0);
});

test('route observer shares one timer and ignores path changes that keep the same conversation id', () => {
  const fake = createWindow('/c/conversation-one');
  const observer = createCodexWorkModeRouteObserver(fake.window);
  const routes: (string | null)[] = [];
  const first = observer.subscribe((id) => routes.push(id));
  const second = observer.subscribe((id) => routes.push(id));
  assert.equal(fake.intervals.size, 1);

  fake.window.location.pathname = '/g/custom-gpt/c/conversation-one';
  fake.tick();
  assert.deepEqual(routes, ['conversation-one', 'conversation-one']);

  first();
  assert.equal(fake.intervals.size, 1);
  second();
  assert.equal(fake.intervals.size, 0);
});
