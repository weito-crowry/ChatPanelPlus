import { collectTurnObservation } from './conversation-statistics-dom.ts';
import { findConversationScrollContainer } from './conversation-statistics-history.ts';
import type { StatisticsObservation } from '../shared/conversation-statistics.ts';

const TURN_SELECTOR = '[data-turn-key]';
const INTENT_TTL_MS = 1_500;
const VISIBLE_THROTTLE_MS = 100;
const OBSERVATION_DEBOUNCE_MS = 120;

export interface ConversationStatisticsHistoryCollectorOptions {
  readonly document: Document;
  readonly window: Window;
  readonly root: HTMLElement;
  readonly onObservations: (observations: readonly StatisticsObservation[]) => void;
  readonly isScanActive: () => boolean;
  readonly intersectionObserver?: typeof IntersectionObserver;
  readonly visibleThrottleMs?: number;
  readonly observationDebounceMs?: number;
}

function turnsIn(element: Element): Element[] {
  return [
    ...(element.matches(TURN_SELECTOR) ? [element] : []),
    ...Array.from(element.querySelectorAll(TURN_SELECTOR)),
  ];
}

export class ConversationStatisticsHistoryCollector {
  private readonly options: ConversationStatisticsHistoryCollectorOptions;
  private readonly observed = new WeakSet<Element>();
  private readonly visible = new Set<Element>();
  private readonly pending = new Set<Element>();
  private readonly measuredKeys = new Set<string>();
  private observer: IntersectionObserver | null = null;
  private scrollContainer: HTMLElement | null = null;
  private scrollContainerResolved = false;
  private turnsSinceContainerProbe = 0;
  private intentUntil = 0;
  private visibleTimer: number | undefined;
  private observationTimer: number | undefined;
  private disposed = false;

  constructor(options: ConversationStatisticsHistoryCollectorOptions) {
    this.options = options;
    const Observer = options.intersectionObserver ?? globalThis.IntersectionObserver;
    if (Observer) {
      this.observer = new Observer(this.onIntersection, { threshold: 0 });
      Array.from(options.root.querySelectorAll(TURN_SELECTOR)).forEach((turn) => this.observe(turn));
    }
    this.refreshScrollContainer(true);
    options.document.addEventListener('wheel', this.onUserScroll, true);
    options.document.addEventListener('touchstart', this.onUserScroll, true);
    options.document.addEventListener('keydown', this.onUserScroll, true);
  }

  get isScanning(): boolean { return this.options.isScanActive(); }

  handleMutations(records: readonly MutationRecord[]): void {
    if (this.disposed) return;
    const addedTurns = new Set<Element>();
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const changedTurn = target?.closest(TURN_SELECTOR);
      if (changedTurn && this.visible.has(changedTurn) && this.hasRecentIntent()) this.queue(changedTurn);
      for (const node of Array.from(record.addedNodes)) {
        if (!(node instanceof Element)) continue;
        const turns = turnsIn(node);
        turns.forEach((turn) => { addedTurns.add(turn); this.observe(turn); });
      }
    }
    if (!this.scrollContainer?.isConnected) {
      this.turnsSinceContainerProbe += addedTurns.size;
      if (this.turnsSinceContainerProbe >= 8) {
        this.refreshScrollContainer(true);
        this.turnsSinceContainerProbe = 0;
      }
    }
  }

  resumeVisible(): void {
    if (!this.disposed && this.hasRecentIntent()) this.queueVisibleCandidates();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.options.document.removeEventListener('wheel', this.onUserScroll, true);
    this.options.document.removeEventListener('touchstart', this.onUserScroll, true);
    this.options.document.removeEventListener('keydown', this.onUserScroll, true);
    this.observer?.disconnect();
    this.observer = null;
    if (this.visibleTimer !== undefined) this.options.window.clearTimeout(this.visibleTimer);
    if (this.observationTimer !== undefined) this.options.window.clearTimeout(this.observationTimer);
    this.visibleTimer = undefined;
    this.observationTimer = undefined;
    this.pending.clear();
    this.visible.clear();
  }

  private observe(turn: Element): void {
    if (!this.observer || this.observed.has(turn)) return;
    this.observed.add(turn);
    this.observer.observe(turn);
  }

  private refreshScrollContainer(force = false): void {
    if (this.scrollContainer?.isConnected || (!force && this.scrollContainerResolved)) return;
    try {
      this.scrollContainer = findConversationScrollContainer(this.options.root, this.options.window);
      this.scrollContainerResolved = true;
    }
    catch {
      this.scrollContainer = null;
      this.scrollContainerResolved = true;
    }
  }

  private readonly onIntersection: IntersectionObserverCallback = (entries) => {
    if (this.disposed) return;
    for (const entry of entries) {
      if (entry.isIntersecting && this.options.root.contains(entry.target)) {
        this.visible.add(entry.target);
        if (this.hasRecentIntent()) this.queue(entry.target);
      } else {
        this.visible.delete(entry.target);
      }
    }
  };

  private readonly onUserScroll = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    this.refreshScrollContainer();
    if (!this.options.root.contains(target) && !this.scrollContainer?.contains(target)) return;
    if (target.closest('form,[contenteditable="true"],textarea,input,[data-chatpanelplus-root]')) return;
    if (event.type === 'keydown') {
      const key = (event as KeyboardEvent).key;
      if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(key)) return;
    }
    this.intentUntil = Date.now() + INTENT_TTL_MS;
    if (this.visibleTimer !== undefined) return;
    this.visibleTimer = this.options.window.setTimeout(() => {
      this.visibleTimer = undefined;
      this.queueVisibleCandidates();
    }, this.options.visibleThrottleMs ?? VISIBLE_THROTTLE_MS);
  };

  private queueVisibleCandidates(): void {
    if (!this.hasRecentIntent() || this.options.isScanActive()) return;
    this.visible.forEach((turn) => {
      if (turn.isConnected && this.options.root.contains(turn)) this.queue(turn);
    });
  }

  private queue(turn: Element): void {
    if (this.options.isScanActive()) return;
    this.pending.add(turn);
    if (this.observationTimer !== undefined) this.options.window.clearTimeout(this.observationTimer);
    this.observationTimer = this.options.window.setTimeout(() => {
      this.observationTimer = undefined;
      this.flushPending();
    }, this.options.observationDebounceMs ?? OBSERVATION_DEBOUNCE_MS);
  }

  private flushPending(): void {
    if (this.disposed || this.options.isScanActive()) return;
    const observations: StatisticsObservation[] = [];
    for (const turn of this.pending) {
      if (!turn.isConnected || !this.options.root.contains(turn)) continue;
      const observation = collectTurnObservation(turn);
      if (!observation || observation.inputChars === undefined || this.measuredKeys.has(observation.turnKey)) continue;
      this.measuredKeys.add(observation.turnKey);
      observations.push(observation);
    }
    this.pending.clear();
    if (!observations.length) return;
    try { this.options.onObservations(observations); } catch { /* Statistics cannot interrupt page interaction. */ }
  }

  private hasRecentIntent(): boolean { return Date.now() <= this.intentUntil; }
}
