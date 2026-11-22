export type WatchListRequestKind = 'initial' | 'manual' | 'action' | 'foreground' | 'storage';
export type WatchListRequestToken = Readonly<{
  generation: number;
  routeId: string;
  kind: WatchListRequestKind;
}>;
export type WatchListTimeoutScheduler = Readonly<{
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}>;
export type WatchListSendResult<T> = Readonly<{ kind: 'response'; response: T }> |
  Readonly<{ kind: 'timeout' }> | Readonly<{ kind: 'send-error' }>;

export const CODEX_BRIDGE_WATCH_LIST_TIMEOUT_MS = 25_000;
const AUTO_REQUESTS = new Set<WatchListRequestKind>(['foreground', 'storage']);
const PRIORITY: Readonly<Record<WatchListRequestKind, number>> = {
  foreground: 0, storage: 0, initial: 1, action: 2, manual: 3,
};

export class WatchListRequestCoordinator {
  private routeId: string | null = null;
  private generation = 0;
  private active: WatchListRequestToken | null = null;
  private automaticPaused = false;

  setRoute(routeId: string | null): void {
    if (this.routeId === routeId) return;
    this.routeId = routeId;
    this.generation += 1;
    this.active = null;
    this.automaticPaused = false;
  }

  begin(routeId: string, kind: WatchListRequestKind): WatchListRequestToken | null {
    this.setRoute(routeId);
    const automatic = AUTO_REQUESTS.has(kind);
    if (automatic && (this.automaticPaused || this.active !== null)) return null;
    if (this.active && PRIORITY[kind] <= PRIORITY[this.active.kind]) return null;
    if (!automatic) this.automaticPaused = false;
    const token = Object.freeze({ generation: ++this.generation, routeId, kind });
    this.active = token;
    return token;
  }

  isCurrent(token: WatchListRequestToken): boolean {
    return this.active === token && this.routeId === token.routeId;
  }

  finish(token: WatchListRequestToken, succeeded: boolean): boolean {
    if (!this.isCurrent(token)) return false;
    this.active = null;
    this.automaticPaused = !succeeded;
    return true;
  }
}

const defaultScheduler: WatchListTimeoutScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function sendWatchListRequestWithTimeout<T>(
  send: () => Promise<T> | T,
  timeoutMs = CODEX_BRIDGE_WATCH_LIST_TIMEOUT_MS,
  scheduler: WatchListTimeoutScheduler = defaultScheduler,
): Promise<WatchListSendResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: WatchListSendResult<T>) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) scheduler.clearTimeout(timer);
      resolve(result);
    };
    const timer = scheduler.setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);
    Promise.resolve().then(send).then(
      (response) => finish({ kind: 'response', response }),
      () => finish({ kind: 'send-error' }),
    );
  });
}
