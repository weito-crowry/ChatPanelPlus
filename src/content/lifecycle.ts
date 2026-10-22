export interface PlacementTarget {
  readonly parent: Node & ParentNode;
  readonly before: Node;
}

export interface PanelLifecycleOptions {
  readonly document: Document;
  readonly window: Window;
  readonly findTarget: () => PlacementTarget | null;
  readonly createHost: () => HTMLElement;
  readonly observe: (callback: () => void) => Pick<MutationObserver, 'disconnect'>;
  readonly setTimeout: (callback: () => void, delay: number) => number;
  readonly clearTimeout: (id: number) => void;
  readonly setInterval: (callback: () => void, delay: number) => number;
  readonly clearInterval: (id: number) => void;
}

export interface PanelLifecycle {
  readonly host: HTMLElement;
  dispose(): void;
  checkNow(): void;
}

const lifecycles = new WeakMap<Document, PanelLifecycle>();
const COALESCE_MS = 250;
const FALLBACK_CHECK_MS = 5_000;

export function startPanelLifecycle(options: PanelLifecycleOptions): PanelLifecycle {
  const existing = lifecycles.get(options.document);
  if (existing) return existing;

  const host = options.createHost();
  let disposed = false;
  let pendingCheck: number | undefined;
  const observer = options.observe(scheduleCheck);
  const fallbackTimer = options.setInterval(checkNow, FALLBACK_CHECK_MS);

  function checkNow(): void {
    if (disposed) return;
    const target = options.findTarget();
    if (!target) {
      if (host.parentNode) host.remove();
      return;
    }
    if (host.parentNode === target.parent && host.nextSibling === target.before) return;
    target.parent.insertBefore(host, target.before);
  }

  function scheduleCheck(): void {
    if (disposed || pendingCheck !== undefined) return;
    pendingCheck = options.setTimeout(() => {
      pendingCheck = undefined;
      checkNow();
    }, COALESCE_MS);
  }

  function onVisible(): void {
    if (options.document.visibilityState === 'visible') scheduleCheck();
  }

  function onPageHide(event: PageTransitionEvent): void {
    if (!event.persisted) dispose();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    if (pendingCheck !== undefined) options.clearTimeout(pendingCheck);
    pendingCheck = undefined;
    options.clearInterval(fallbackTimer);
    options.document.removeEventListener('visibilitychange', onVisible);
    options.window.removeEventListener('popstate', scheduleCheck);
    options.window.removeEventListener('pageshow', scheduleCheck);
    options.window.removeEventListener('pagehide', onPageHide);
    lifecycles.delete(options.document);
  }

  const lifecycle = { host, dispose, checkNow };
  lifecycles.set(options.document, lifecycle);
  options.document.addEventListener('visibilitychange', onVisible);
  options.window.addEventListener('popstate', scheduleCheck);
  options.window.addEventListener('pageshow', scheduleCheck);
  options.window.addEventListener('pagehide', onPageHide);
  checkNow();
  return lifecycle;
}
