import { collectConversationSnapshot, type ConversationDomSnapshot } from './conversation-statistics-dom.ts';

const TURN_SELECTOR = '[data-turn-key]';
const BODY_TAGS = new Set(['body', 'html']);
const SCROLL_OVERFLOW_VALUES = new Set(['auto', 'scroll', 'overlay']);
const DEFAULT_SETTLE_DELAY_MS = 180;
const DEFAULT_EDGE_STABLE_OBSERVATIONS = 3;
const MAX_STABLE_WAIT_MS = 1_200;
const MAX_SCAN_STEPS = 240;
const MAX_SCAN_DURATION_MS = 90_000;

export type HistoryScanStatus = 'completed' | 'partial' | 'cancelled' | 'error';
export type HistoryScanDirection = 'older' | 'newer';
export type HistoryScanStopReason =
  | 'explicit-cancel'
  | 'user-input'
  | 'route-changed'
  | 'root-disposed'
  | 'scroll-stalled'
  | 'limit-reached'
  | 'no-scroll-container'
  | 'scan-unavailable'
  | 'unexpected-error';

export interface HistoryScanProgress {
  readonly direction: HistoryScanDirection;
  readonly steps: number;
  readonly turnKeysSeen: number;
  readonly newlyMeasuredTurns: number;
}

export interface HistoryScanResult {
  readonly status: HistoryScanStatus;
  readonly reason: HistoryScanStopReason | null;
  readonly steps: number;
  readonly turnKeysSeen: number;
  readonly newlyMeasuredTurns: number;
}

export interface ConversationStatisticsHistoryScannerOptions {
  readonly document: Document;
  readonly window: Window;
  readonly root: HTMLElement;
  readonly conversationId: string;
  readonly currentConversationId: () => string | null;
  readonly onSnapshot: (snapshot: ConversationDomSnapshot) => number | void;
  readonly onProgress?: (progress: HistoryScanProgress) => void;
  readonly settleDelayMs?: number;
  readonly stableEdgeObservations?: number;
  readonly maxSteps?: number;
  readonly maxDurationMs?: number;
}

export interface ConversationStatisticsHistoryViewState {
  readonly scanning: boolean;
  readonly cancelRequested: boolean;
  readonly direction: HistoryScanDirection | null;
  readonly steps: number;
  readonly turnKeysSeen: number;
  readonly newlyMeasuredTurns: number;
  readonly outcome: HistoryScanStatus | null;
}

export interface ConversationStatisticsHistoryOptions extends Omit<
  ConversationStatisticsHistoryScannerOptions,
  'onProgress'
> {
  readonly onState: () => void;
}

function scrollRange(element: Element): { scrollable: HTMLElement; maximum: number } | null {
  if (BODY_TAGS.has(element.tagName.toLowerCase())) return null;
  if (element.matches('form,[contenteditable="true"],input,textarea')) return null;
  const scrollable = element as HTMLElement;
  const maximum = scrollable.scrollHeight - scrollable.clientHeight;
  return scrollable.clientHeight > 0 && maximum > 1 ? { scrollable, maximum } : null;
}

export function findConversationScrollContainer(root: HTMLElement, window: Window): HTMLElement | null {
  const turns = Array.from(root.querySelectorAll(TURN_SELECTOR));
  if (!turns.length) return null;
  let candidate = turns[0]!.parentElement;
  while (candidate) {
    if (turns.every((turn) => candidate!.contains(turn))) {
      const range = scrollRange(candidate);
      if (range) {
        try {
          const overflowY = window.getComputedStyle(candidate).overflowY;
          if (SCROLL_OVERFLOW_VALUES.has(overflowY)) return range.scrollable;
        } catch {
          return null;
        }
      }
    }
    candidate = candidate.parentElement;
  }
  return null;
}

export class ConversationStatisticsHistoryScanner {
  private readonly options: ConversationStatisticsHistoryScannerOptions;
  private readonly turnKeysSeen = new Set<string>();
  private scrollContainer: HTMLElement | null = null;
  private stopReason: HistoryScanStopReason | null = null;
  private userInputInterrupted = false;
  private disposed = false;
  private startedAt = 0;
  private steps = 0;
  private newlyMeasuredTurns = 0;
  private mutationVersion = 0;
  private mutationObserver: MutationObserver | null = null;
  private startPromise: Promise<HistoryScanResult> | null = null;
  private activeScrollbarPointer: { id: number; x: number; y: number } | null = null;

  constructor(options: ConversationStatisticsHistoryScannerOptions) {
    this.options = options;
  }

  start(): Promise<HistoryScanResult> {
    if (!this.startPromise) this.startPromise = this.scan();
    return this.startPromise;
  }

  cancel(): void {
    this.requestStop('explicit-cancel');
  }

  dispose(reason: 'route-changed' | 'root-disposed' = 'root-disposed'): void {
    this.requestStop(reason);
    this.disposed = true;
  }

  private async scan(): Promise<HistoryScanResult> {
    this.startedAt = Date.now();
    if (!this.isCurrent()) return this.result('cancelled');
    const originalFocus = this.options.document.activeElement as HTMLElement | null;
    let originalScrollTop: number | null = null;
    this.options.document.addEventListener('wheel', this.onUserScroll, true);
    this.options.document.addEventListener('touchstart', this.onUserScroll, true);
    this.options.document.addEventListener('keydown', this.onUserScroll, true);
    this.options.document.addEventListener('pointerdown', this.onScrollbarPointerDown, true);
    this.options.document.addEventListener('pointermove', this.onScrollbarPointerMove, true);
    this.options.document.addEventListener('pointerup', this.onScrollbarPointerEnd, true);
    this.options.document.addEventListener('pointercancel', this.onScrollbarPointerEnd, true);
    try {
      this.collectSnapshot('older');
      if (!this.isCurrent()) return this.result('cancelled');
      this.scrollContainer = findConversationScrollContainer(this.options.root, this.options.window);
      if (!this.scrollContainer) {
        this.requestStop('no-scroll-container');
        return this.result('partial');
      }
      originalScrollTop = this.scrollContainer.scrollTop;
      this.mutationObserver = new MutationObserver(() => { this.mutationVersion += 1; });
      this.mutationObserver.observe(this.options.root, { childList: true, subtree: true, characterData: true });
      for (const direction of ['older', 'newer'] as const) {
        const edgeReached = await this.scanToEdge(direction);
        if (!edgeReached) return this.result(this.statusForStopReason());
      }
      return this.result('completed');
    } catch {
      if (!this.stopReason) this.requestStop('unexpected-error');
      return this.result(this.statusForStopReason());
    } finally {
      this.mutationObserver?.disconnect();
      this.mutationObserver = null;
      this.options.document.removeEventListener('wheel', this.onUserScroll, true);
      this.options.document.removeEventListener('touchstart', this.onUserScroll, true);
      this.options.document.removeEventListener('keydown', this.onUserScroll, true);
      this.options.document.removeEventListener('pointerdown', this.onScrollbarPointerDown, true);
      this.options.document.removeEventListener('pointermove', this.onScrollbarPointerMove, true);
      this.options.document.removeEventListener('pointerup', this.onScrollbarPointerEnd, true);
      this.options.document.removeEventListener('pointercancel', this.onScrollbarPointerEnd, true);
      this.activeScrollbarPointer = null;
      const container = this.scrollContainer;
      if (originalScrollTop !== null && !this.userInputInterrupted && this.isContextCurrent() && container?.isConnected) {
        const maximum = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTop = Math.min(maximum, Math.max(0, originalScrollTop));
        if (originalFocus?.isConnected && this.options.document.activeElement !== originalFocus) {
          originalFocus.focus({ preventScroll: true });
        }
      }
    }
  }

  private async scanToEdge(direction: HistoryScanDirection): Promise<boolean> {
    const stableRequired = Math.max(2, this.options.stableEdgeObservations ?? DEFAULT_EDGE_STABLE_OBSERVATIONS);
    let stableAtEdge = 0;
    let previousEdgeSignature = '';
    let stalledSteps = 0;
    while (this.steps < (this.options.maxSteps ?? MAX_SCAN_STEPS)
      && Date.now() - this.startedAt < (this.options.maxDurationMs ?? MAX_SCAN_DURATION_MS)) {
      if (!this.isCurrent()) return false;
      const container = this.scrollContainer;
      if (!container?.isConnected || container.clientHeight <= 0) {
        this.requestStop(container?.isConnected ? 'scroll-stalled' : 'root-disposed');
        return false;
      }
      const maximum = Math.max(0, container.scrollHeight - container.clientHeight);
      const position = Math.max(0, Math.min(maximum, container.scrollTop));
      const atEdge = direction === 'older' ? position <= 1 : position >= maximum - 1;
      if (atEdge) {
        await this.waitForDomSettle();
        if (!this.isCurrent()) return false;
        this.collectSnapshot(direction);
        const signature = `${container.scrollTop}:${container.scrollHeight}:${this.turnKeysSeen.size}:${this.mutationVersion}`;
        stableAtEdge = signature === previousEdgeSignature ? stableAtEdge + 1 : 1;
        previousEdgeSignature = signature;
        if (stableAtEdge >= stableRequired) return true;
        continue;
      }

      stableAtEdge = 0;
      const increment = Math.max(1, Math.floor(container.clientHeight * 0.65));
      const target = direction === 'older'
        ? Math.max(0, position - increment)
        : Math.min(maximum, position + increment);
      if (target === position) {
        stalledSteps += 1;
        await this.waitForDomSettle();
        this.collectSnapshot(direction);
        if (stalledSteps >= stableRequired) {
          this.requestStop('scroll-stalled');
          return false;
        }
        continue;
      }
      container.scrollTop = target;
      this.steps += 1;
      await this.waitForDomSettle();
      if (!this.isCurrent()) return false;
      this.collectSnapshot(direction);
      const afterPosition = container.scrollTop;
      const moved = direction === 'older' ? afterPosition < position - 1 : afterPosition > position + 1;
      const reachedEdge = direction === 'older'
        ? afterPosition <= 1
        : afterPosition >= Math.max(0, container.scrollHeight - container.clientHeight) - 1;
      stalledSteps = moved || reachedEdge ? 0 : stalledSteps + 1;
      if (stalledSteps >= stableRequired) {
        this.requestStop('scroll-stalled');
        return false;
      }
    }
    if (!this.stopReason) this.requestStop('limit-reached');
    return false;
  }

  private async waitForDomSettle(): Promise<void> {
    const delay = this.options.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS;
    const deadline = Date.now() + MAX_STABLE_WAIT_MS;
    let stableChecks = 0;
    let revision = this.mutationVersion;
    do {
      await new Promise<void>((resolve) => this.options.window.setTimeout(resolve, delay));
      if (revision === this.mutationVersion) stableChecks += 1;
      else stableChecks = 0;
      revision = this.mutationVersion;
    } while (stableChecks < 2 && Date.now() < deadline && !this.stopReason);
  }

  private collectSnapshot(direction: HistoryScanDirection): void {
    const snapshot = collectConversationSnapshot(this.options.root);
    snapshot.turnKeys.forEach((key) => this.turnKeysSeen.add(key));
    const measured = this.options.onSnapshot(snapshot);
    if (Number.isSafeInteger(measured) && (measured as number) > 0) this.newlyMeasuredTurns += measured as number;
    try {
      this.options.onProgress?.({
        direction,
        steps: this.steps,
        turnKeysSeen: this.turnKeysSeen.size,
        newlyMeasuredTurns: this.newlyMeasuredTurns,
      });
    } catch { /* Progress rendering must not interrupt history collection. */ }
  }

  private isCurrent(): boolean {
    if (this.stopReason) return false;
    return this.isContextCurrent();
  }

  private isContextCurrent(): boolean {
    if (this.disposed || !this.options.root.isConnected) {
      this.requestStop('root-disposed');
      return false;
    }
    if (this.options.currentConversationId() !== this.options.conversationId) {
      this.requestStop('route-changed');
      return false;
    }
    return true;
  }

  private result(status: HistoryScanStatus): HistoryScanResult {
    if (this.stopReason) this.logStopReason(status, this.stopReason);
    return {
      status,
      reason: this.stopReason,
      steps: this.steps,
      turnKeysSeen: this.turnKeysSeen.size,
      newlyMeasuredTurns: this.newlyMeasuredTurns,
    };
  }

  private statusForStopReason(): HistoryScanStatus {
    if (this.stopReason === 'explicit-cancel' || this.stopReason === 'user-input'
      || this.stopReason === 'route-changed' || this.stopReason === 'root-disposed') return 'cancelled';
    return this.stopReason === 'unexpected-error' || this.stopReason === 'scan-unavailable' ? 'error' : 'partial';
  }

  private readonly onUserScroll = (event: Event): void => {
    const target = event.target;
    if (typeof Element === 'undefined' || !(target instanceof Element)) return;
    const isScrollKey = event.type === 'keydown';
    const inConversation = this.options.root.contains(target) || Boolean(this.scrollContainer?.contains(target));
    const pageFocus = isScrollKey && (target === this.options.document.body || target === this.options.document.documentElement);
    if (!inConversation && !pageFocus) return;
    if (target.closest('form,[contenteditable="true"],textarea,input')) return;
    if (event.type === 'keydown') {
      const key = (event as KeyboardEvent).key;
      if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ', 'Space', 'Spacebar'].includes(key)) return;
    }
    this.requestStop('user-input');
  };

  private readonly onScrollbarPointerDown = (event: Event): void => {
    const container = this.scrollContainer;
    const target = event.target;
    if (!container || typeof Element === 'undefined' || !(target instanceof Element) || target !== container) return;
    const pointer = event as PointerEvent;
    if (pointer.pointerType !== 'mouse' || pointer.button !== 0 || !this.isScrollbarGutter(container, pointer.clientX)) return;
    this.activeScrollbarPointer = { id: pointer.pointerId, x: pointer.clientX, y: pointer.clientY };
  };

  private readonly onScrollbarPointerMove = (event: Event): void => {
    const active = this.activeScrollbarPointer;
    const pointer = event as PointerEvent;
    if (!active || pointer.pointerId !== active.id || (pointer.buttons & 1) === 0) return;
    if (pointer.clientX === active.x && pointer.clientY === active.y) return;
    this.requestStop('user-input');
  };

  private readonly onScrollbarPointerEnd = (event: Event): void => {
    if ((event as PointerEvent).pointerId === this.activeScrollbarPointer?.id) this.activeScrollbarPointer = null;
  };

  private isScrollbarGutter(container: HTMLElement, clientX: number): boolean {
    const width = container.offsetWidth - container.clientWidth;
    if (width <= 0) return false;
    const rect = container.getBoundingClientRect();
    return (clientX >= rect.right - width && clientX <= rect.right)
      || (clientX >= rect.left && clientX <= rect.left + width);
  }

  private requestStop(reason: HistoryScanStopReason): void {
    if (this.stopReason) return;
    this.stopReason = reason;
    if (reason === 'user-input') this.userInputInterrupted = true;
  }

  private logStopReason(status: HistoryScanStatus, reason: HistoryScanStopReason): void {
    try {
      if (new URLSearchParams(this.options.window.location.search).get('cppDebugInteraction') !== '1') return;
      console.debug('[ChatPanelPlus history scan]', {
        status,
        reason,
        steps: this.steps,
        turnKeysSeen: this.turnKeysSeen.size,
        newlyMeasuredTurns: this.newlyMeasuredTurns,
      });
    } catch { /* Diagnostic reporting must not interrupt history collection. */ }
  }

}

export class ConversationStatisticsHistory {
  private readonly options: ConversationStatisticsHistoryOptions;
  private scanner: ConversationStatisticsHistoryScanner | null = null;
  private scanPromise: Promise<HistoryScanResult> | null = null;
  private disposed = false;
  private currentState: ConversationStatisticsHistoryViewState = {
    scanning: false,
    cancelRequested: false,
    direction: null,
    steps: 0,
    turnKeysSeen: 0,
    newlyMeasuredTurns: 0,
    outcome: null,
  };

  constructor(options: ConversationStatisticsHistoryOptions) {
    this.options = options;
  }

  get state(): ConversationStatisticsHistoryViewState { return this.currentState; }

  scan(): Promise<HistoryScanResult> {
    if (this.scanPromise) return this.scanPromise;
    if (this.disposed) return Promise.resolve({
      status: 'cancelled', reason: 'root-disposed', steps: 0, turnKeysSeen: 0, newlyMeasuredTurns: 0,
    });
    this.updateState({
      scanning: true,
      cancelRequested: false,
      direction: 'older',
      steps: 0,
      turnKeysSeen: 0,
      newlyMeasuredTurns: 0,
      outcome: null,
    });
    this.scanner = new ConversationStatisticsHistoryScanner({
      ...this.options,
      onProgress: (progress) => this.updateState({ ...this.currentState, ...progress }),
    });
    this.scanPromise = this.scanner.start().then((result) => {
      if (!this.disposed) this.updateState({
        scanning: false,
        cancelRequested: false,
        direction: null,
        steps: result.steps,
        turnKeysSeen: result.turnKeysSeen,
        newlyMeasuredTurns: result.newlyMeasuredTurns,
        outcome: result.status,
      });
      return result;
    }).finally(() => {
      this.scanner = null;
      this.scanPromise = null;
    });
    return this.scanPromise;
  }

  cancel(): void {
    if (!this.currentState.scanning || this.currentState.cancelRequested) return;
    this.scanner?.cancel();
    this.updateState({ ...this.currentState, cancelRequested: true });
  }

  dispose(reason: 'route-changed' | 'root-disposed' = 'root-disposed'): void {
    this.disposed = true;
    this.scanner?.dispose(reason);
  }

  private updateState(state: ConversationStatisticsHistoryViewState): void {
    this.currentState = state;
    try { this.options.onState(); } catch { /* A view update cannot interrupt ChatGPT actions. */ }
  }
}
