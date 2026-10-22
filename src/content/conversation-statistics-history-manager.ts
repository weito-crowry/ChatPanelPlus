import type { StatisticsObservation } from '../shared/conversation-statistics.ts';
import type { ConversationStatisticsSession } from './conversation-statistics-session.ts';
import {
  ConversationStatisticsHistory,
  type ConversationStatisticsHistoryViewState,
  type HistoryScanResult,
} from './conversation-statistics-history.ts';
import { ConversationStatisticsHistoryCollector } from './conversation-statistics-history-collector.ts';

export interface ConversationStatisticsHistoryManagerOptions {
  readonly document: Document;
  readonly window: Window;
  readonly root: HTMLElement;
  readonly conversationId: string;
  readonly currentConversationId: () => string | null;
  readonly getCurrentRoot: () => HTMLElement | null;
  readonly getSession: () => ConversationStatisticsSession | null;
  readonly isDisposed: () => boolean;
  readonly onDirty: () => void;
  readonly onState: () => void;
  readonly intersectionObserver?: typeof IntersectionObserver;
}

export class ConversationStatisticsHistoryManager {
  private readonly options: ConversationStatisticsHistoryManagerOptions;
  private readonly scanner: ConversationStatisticsHistory;
  private readonly collector: ConversationStatisticsHistoryCollector;

  constructor(options: ConversationStatisticsHistoryManagerOptions) {
    this.options = options;
    this.scanner = new ConversationStatisticsHistory({
      document: options.document,
      window: options.window,
      root: options.root,
      conversationId: options.conversationId,
      currentConversationId: options.currentConversationId,
      onSnapshot: (snapshot) => this.apply(snapshot.observations),
      onState: options.onState,
    });
    this.collector = new ConversationStatisticsHistoryCollector({
      document: options.document,
      window: options.window,
      root: options.root,
      onObservations: (observations) => { this.apply(observations); },
      isScanActive: () => this.state.scanning,
      ...(options.intersectionObserver ? { intersectionObserver: options.intersectionObserver } : {}),
    });
  }

  get state(): ConversationStatisticsHistoryViewState { return this.scanner.state; }
  get isScanning(): boolean { return this.state.scanning; }

  scan(): Promise<HistoryScanResult> {
    return this.scanner.scan().finally(() => this.collector.resumeVisible());
  }

  cancel(): void { this.scanner.cancel(); }
  handleMutations(records: readonly MutationRecord[]): void { this.collector.handleMutations(records); }

  dispose(reason: 'route-changed' | 'root-disposed' = 'root-disposed'): void {
    this.scanner.dispose(reason);
    this.collector.dispose();
  }

  private apply(observations: readonly StatisticsObservation[]): number {
    const session = this.options.getSession();
    if (this.options.isDisposed() || this.options.currentConversationId() !== this.options.conversationId
      || this.options.getCurrentRoot() !== this.options.root || !session) return 0;
    const before = JSON.stringify(session.conversation());
    const newlyMeasured = session.observeHistory(observations).length;
    if (before !== JSON.stringify(session.conversation())) this.options.onDirty();
    return newlyMeasured;
  }
}
