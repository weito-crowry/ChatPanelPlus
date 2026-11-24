export type CodexBridgeRunningRefreshRuntime = Readonly<{
  visibilityState: string;
  setInterval(callback: () => void, milliseconds: number): number;
  clearInterval(id: number): void;
  hasFocus(): boolean;
  addEventListener(type: 'focus' | 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'focus' | 'visibilitychange', listener: () => void): void;
}>;

type Options = Readonly<{
  runtime: CodexBridgeRunningRefreshRuntime;
  enabled: boolean;
  foregroundEnabled: boolean;
  now: () => number;
  onRefresh: (priority: 'foreground' | 'background') => void;
}>;

export function startCodexBridgeRunningRefresh(options: Options): () => void {
  if (!options.enabled) return () => {};
  let lastRefresh = options.now();
  const tick = () => {
    const now = options.now();
    const foreground = options.foregroundEnabled && options.runtime.visibilityState === 'visible'
      && options.runtime.hasFocus();
    if (now - lastRefresh < (foreground ? 5_000 : 30_000)) return;
    lastRefresh = now;
    options.onRefresh(foreground ? 'foreground' : 'background');
  };
  const focusChanged = () => tick();
  const timer = options.runtime.setInterval(tick, 5_000);
  options.runtime.addEventListener('focus', focusChanged);
  options.runtime.addEventListener('visibilitychange', focusChanged);
  return () => {
    options.runtime.clearInterval(timer);
    options.runtime.removeEventListener('focus', focusChanged);
    options.runtime.removeEventListener('visibilitychange', focusChanged);
  };
}

export const browserCodexBridgeRunningRefreshRuntime: CodexBridgeRunningRefreshRuntime = {
  get visibilityState() { return document.visibilityState; },
  setInterval: (callback, milliseconds) => window.setInterval(callback, milliseconds),
  clearInterval: (id) => window.clearInterval(id),
  hasFocus: () => document.hasFocus(),
  addEventListener: (type, listener) => {
    if (type === 'focus') window.addEventListener('focus', listener);
    else document.addEventListener('visibilitychange', listener);
  },
  removeEventListener: (type, listener) => {
    if (type === 'focus') window.removeEventListener('focus', listener);
    else document.removeEventListener('visibilitychange', listener);
  },
};
