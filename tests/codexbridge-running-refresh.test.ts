import assert from 'node:assert/strict';
import test from 'node:test';
import { startCodexBridgeRunningRefresh, type CodexBridgeRunningRefreshRuntime } from '../src/content/codexbridge-running-refresh.ts';

class FakeRuntime implements CodexBridgeRunningRefreshRuntime {
  now = 0;
  visibilityState = 'visible';
  focused = true;
  private timer: (() => void) | null = null;
  private readonly listeners = new Map<string, Set<() => void>>();
  setInterval(callback: () => void): number { this.timer = callback; return 1; }
  clearInterval(): void { this.timer = null; }
  hasFocus(): boolean { return this.focused; }
  addEventListener(type: 'focus' | 'visibilitychange', listener: () => void): void {
    const entries = this.listeners.get(type) ?? new Set();
    entries.add(listener); this.listeners.set(type, entries);
  }
  removeEventListener(type: 'focus' | 'visibilitychange', listener: () => void): void { this.listeners.get(type)?.delete(listener); }
  tick(milliseconds: number): void { this.now += milliseconds; this.timer?.(); }
  get listenerCount(): number { return [...this.listeners.values()].reduce((sum, entries) => sum + entries.size, 0); }
  get timerActive(): boolean { return this.timer !== null; }
}

test('閲覧中5秒、背面/最小化30秒で更新し、無効化時にtimer/listenerを解放する', () => {
  const runtime = new FakeRuntime();
  const priorities: string[] = [];
  const stop = startCodexBridgeRunningRefresh({ runtime, enabled: true, foregroundEnabled: true,
    now: () => runtime.now, onRefresh: (priority) => priorities.push(priority) });
  runtime.tick(4_999);
  assert.deepEqual(priorities, []);
  runtime.tick(1);
  assert.deepEqual(priorities, ['foreground']);
  runtime.focused = false;
  runtime.tick(29_999);
  assert.deepEqual(priorities, ['foreground']);
  runtime.tick(1);
  assert.deepEqual(priorities, ['foreground', 'background']);
  stop();
  assert.equal(runtime.listenerCount, 0);
  assert.equal(runtime.timerActive, false);
});

test('無効状態ではtimer/listenerを登録しない', () => {
  const runtime = new FakeRuntime();
  let calls = 0;
  const stop = startCodexBridgeRunningRefresh({ runtime, enabled: false, foregroundEnabled: true,
    now: () => runtime.now, onRefresh: () => { calls += 1; } });
  runtime.tick(60_000);
  assert.equal(calls, 0);
  assert.equal(runtime.listenerCount, 0);
  stop();
});
