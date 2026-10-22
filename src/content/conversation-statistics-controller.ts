import {
  aggregateConversationStatistics,
  createStatisticsStore,
  type ConversationStatisticsAggregate,
} from '../shared/conversation-statistics.ts';
import {
  ConversationStatisticsRepository,
  type StatisticsRepositoryResult,
} from '../shared/conversation-statistics-repository.ts';
import {
  collectConversationIdentities,
  collectConversationSnapshot,
  collectConversationTurnKeys,
  collectTurnAssistantObservation,
  collectTurnIdentity,
  collectTurnKeysInSubtree,
  collectTurnObservation,
  conversationIdFromPath,
  findTurnElement,
  hasUserBubble,
} from './conversation-statistics-dom.ts';
import { ConversationStatisticsSession } from './conversation-statistics-session.ts';
import { ConversationStatisticsHistoryManager } from './conversation-statistics-history-manager.ts';
import type { ConversationStatisticsHistoryViewState, HistoryScanResult } from './conversation-statistics-history.ts';
import { AnswerCompletionTracker, type AnswerCompletionEvent } from './answer-completion-sound.ts';
import { observeConversationMutations } from './conversation-statistics-observer.ts';
import {
  findComposerForm,
  isComposerEnterIntent,
  isComposerSendButton,
  isComposerSubmitIntent,
} from './conversation-statistics-send-intent.ts';

export type StatisticsStorageError = 'corrupt-data' | 'unsupported-version' | 'storage-failed' | 'dom-failed';
export interface ConversationStatisticsViewState {
  readonly conversationId: string | null;
  readonly aggregate: ConversationStatisticsAggregate;
  readonly loading: boolean;
  readonly recounting: boolean;
  readonly historyScan: ConversationStatisticsHistoryViewState;
  readonly saving: boolean;
  readonly unsaved: boolean;
  readonly error: StatisticsStorageError | null;
}

export interface ConversationStatisticsControllerOptions {
  readonly document: Document;
  readonly window: Window;
  readonly repository: ConversationStatisticsRepository;
  readonly onState: (state: ConversationStatisticsViewState) => void;
  readonly onAnswerCompleted?: (event: AnswerCompletionEvent) => void;
}

const SAVE_DEBOUNCE_MS = 400;
const ROUTE_CHECK_MS = 1_000;

function sameConversation(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class ConversationStatisticsController {
  private readonly options: ConversationStatisticsControllerOptions;
  private readonly volatileSessions = new Map<string, ConversationStatisticsSession>();
  private readonly dirtyConversations = new Set<string>();
  private readonly failedConversations = new Map<string, StatisticsStorageError>();
  private readonly savingConversations = new Set<string>();
  private readonly routeTimer: number;
  private routeToken = 0;
  private disposed = false;
  private conversationId: string | null = null;
  private root: HTMLElement | null = null;
  private session: ConversationStatisticsSession | null = null;
  private storageReady = false;
  private loading = false;
  private recounting = false;
  private observer: MutationObserver | null = null;
  private historyScan: ConversationStatisticsHistoryManager | null = null;
  private activeForm: HTMLFormElement | null = null;
  private saveTimer: number | undefined;
  private submissionPendingUntil = 0;
  private submissionAt = 0;
  private lastSubmissionSource: 'click' | 'keydown' | 'submit' | null = null;
  private submissionBaselineTurnKeys: string[] = [];
  private submissionFromNewConversation = false;
  private automaticInputKeys = new Set<string>();
  private readonly answerCompletionTracker = new AnswerCompletionTracker();

  constructor(options: ConversationStatisticsControllerOptions) {
    this.options = options;
    this.routeTimer = options.window.setInterval(() => { void this.checkRoute(); }, ROUTE_CHECK_MS);
  }

  start(): void {
    this.options.document.addEventListener('submit', this.onDocumentSubmit, true);
    this.options.document.addEventListener('keydown', this.onDocumentKeyDown, true);
    this.options.document.addEventListener('click', this.onDocumentClick, true);
    this.options.window.addEventListener('popstate', this.onNavigation);
    this.options.window.addEventListener('pageshow', this.onNavigation);
    this.options.window.addEventListener('pagehide', this.onPageHide);
    void this.checkRoute();
  }
  stop(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.routeToken += 1;
    this.options.window.clearInterval(this.routeTimer);
    this.options.window.removeEventListener('popstate', this.onNavigation);
    this.options.window.removeEventListener('pageshow', this.onNavigation);
    this.options.window.removeEventListener('pagehide', this.onPageHide);
    this.options.document.removeEventListener('submit', this.onDocumentSubmit, true);
    this.options.document.removeEventListener('keydown', this.onDocumentKeyDown, true);
    this.options.document.removeEventListener('click', this.onDocumentClick, true);
    this.observer?.disconnect();
    this.observer = null;
    this.historyScan?.dispose();
    this.historyScan = null;
    this.unbindComposerForm();
    if (this.saveTimer !== undefined) this.options.window.clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.flushSave();
  }
  async recount(): Promise<void> {
    if (this.historyScan?.state.scanning) return;
    const conversationId = this.conversationId;
    const root = this.root;
    if (!conversationId || !root || this.disposed) return;
    this.recounting = true;
    this.publish();
    await new Promise<void>((resolve) => this.options.window.setTimeout(resolve, 0));
    if (this.disposed || this.conversationId !== conversationId || this.root !== root) return;

    try {
      const snapshot = collectConversationSnapshot(root);
      if (!snapshot.turnKeys.length) return;
      if (!this.storageReady) await this.reloadStorageForRecount(conversationId);
      if (this.disposed || this.conversationId !== conversationId || this.root !== root) return;
      if (!this.session) return;
      const before = JSON.stringify(this.session.conversation());
      this.session.recount(snapshot.turnKeys, snapshot.observations, snapshot.partial);
      this.automaticInputKeys.clear();
      if (!sameConversation(before, this.session.conversation())) this.markDirty(conversationId);
      if (this.storageReady) {
        this.failedConversations.delete(conversationId);
        if (this.dirtyConversations.has(conversationId)) this.markDirty(conversationId);
      }
    } catch {
      this.failedConversations.set(conversationId, 'dom-failed');
    } finally {
      this.recounting = false;
      this.publish();
    }
  }
  scanAllHistory(): Promise<HistoryScanResult> {
    if (this.recounting || !this.historyScan) {
      return Promise.resolve({ status: 'error', reason: 'scan-unavailable', steps: 0, turnKeysSeen: 0, newlyMeasuredTurns: 0 });
    }
    return this.historyScan.scan();
  }
  cancelHistoryScan(): void { this.historyScan?.cancel(); }
  private readonly onNavigation = (): void => { void this.checkRoute(); };
  private readonly onPageHide = (): void => { this.flushSave(); };
  private readonly onComposerSubmit = (): void => { this.recordSubmission('submit'); };
  private readonly onDocumentKeyDown = (event: Event): void => {
    if (isComposerEnterIntent(event as KeyboardEvent, this.options.document)) this.recordSubmission('keydown');
  };
  private readonly onDocumentClick = (event: Event): void => {
    if (isComposerSendButton(event.target, this.options.document)) this.recordSubmission('click');
  };
  private readonly onDocumentSubmit = (event: Event): void => {
    if (isComposerSubmitIntent(event, this.options.document, this.activeForm)) this.recordSubmission('submit');
  };
  private recordSubmission(source: 'click' | 'keydown' | 'submit'): void {
    const now = Date.now();
    const pairedIntent = source === 'submit' && (this.lastSubmissionSource === 'click' || this.lastSubmissionSource === 'keydown')
      && now - this.submissionAt < 250 && this.submissionPendingUntil >= now;
    if (pairedIntent) return;
    this.lastSubmissionSource = source;
    this.submissionAt = now;
    this.submissionPendingUntil = now + 15_000;
    this.submissionFromNewConversation = conversationIdFromPath(this.options.window.location.pathname) === null;
    try {
      this.submissionBaselineTurnKeys = !this.submissionFromNewConversation && this.root
        ? collectConversationTurnKeys(this.root)
        : [];
    } catch {
      this.submissionBaselineTurnKeys = [];
    }
    this.session?.noteSubmission(now, this.submissionBaselineTurnKeys);
  }
  private async checkRoute(): Promise<void> {
    if (this.disposed) return;
    const nextId = conversationIdFromPath(this.options.window.location.pathname);
    const nextRoot = this.options.document.querySelector<HTMLElement>('main');
    if (nextId === this.conversationId && nextRoot === this.root
      && (!nextId || (nextRoot !== null && (this.loading || this.session !== null)))) {
      this.bindComposerForm();
      return;
    }

    if (this.conversationId && this.session && this.dirtyConversations.has(this.conversationId)) {
      this.volatileSessions.set(this.conversationId, this.session);
      this.flushSave();
    }
    const pendingNewConversationSubmission = this.submissionFromNewConversation
      && this.submissionAt > 0 && this.submissionPendingUntil >= Date.now()
      ? { at: this.submissionAt, expiresAt: this.submissionPendingUntil, baseline: [...this.submissionBaselineTurnKeys] }
      : null;
    this.routeToken += 1;
    const token = this.routeToken;
    this.observer?.disconnect();
    this.observer = null;
    this.historyScan?.dispose(nextId !== this.conversationId ? 'route-changed' : 'root-disposed');
    this.historyScan = null;
    this.unbindComposerForm();
    if (this.saveTimer !== undefined) this.options.window.clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.conversationId = nextId;
    this.root = nextRoot;
    this.session = null;
    this.storageReady = false;
    this.loading = Boolean(nextId && nextRoot);
    this.recounting = false;
    this.submissionPendingUntil = 0;
    this.submissionAt = 0;
    this.submissionBaselineTurnKeys = [];
    this.submissionFromNewConversation = false;
    if (pendingNewConversationSubmission) {
      this.submissionAt = pendingNewConversationSubmission.at;
      this.submissionPendingUntil = pendingNewConversationSubmission.expiresAt;
      this.submissionBaselineTurnKeys = pendingNewConversationSubmission.baseline;
      this.submissionFromNewConversation = true;
    }
    this.automaticInputKeys.clear();
    if (!nextId || !nextRoot) {
      this.bindComposerForm();
      this.publish();
      return;
    }
    this.bindComposerForm();
    this.publish();

    let loaded: StatisticsRepositoryResult;
    try {
      loaded = await this.options.repository.loadStore();
    } catch {
      loaded = { ok: false, reason: 'storage-failed' };
    }
    if (this.disposed || token !== this.routeToken || this.conversationId !== nextId || this.root !== nextRoot) return;

    const initialStore = loaded.ok ? loaded.store : createStatisticsStore();
    try {
      const identities = collectConversationIdentities(nextRoot);
      this.answerCompletionTracker.reset(identities.identities);
      const cachedSession = this.volatileSessions.get(nextId);
      const session = cachedSession ?? new ConversationStatisticsSession(nextId, initialStore, identities.turnKeys, identities.identities);
      if (cachedSession && loaded.ok) session.rebaseStore(loaded.store);
      const newConversationStartConfirmed = this.submissionFromNewConversation
        && this.submissionBaselineTurnKeys.length === 0
        && this.submissionAt > 0 && this.submissionPendingUntil >= Date.now();
      if (newConversationStartConfirmed) session.confirmNewConversationStart(identities.turnKeys.at(-1));
      this.session = session;
      this.storageReady = loaded.ok;
      this.loading = false;
      identities.identities.forEach((identity) => session.syncVisibleIdentity(identity));
      if (this.submissionAt > 0 && this.submissionPendingUntil >= Date.now()) {
        session.noteSubmission(this.submissionAt, this.submissionBaselineTurnKeys);
        const submittedKey = identities.turnKeys.at(-1);
        if (submittedKey && !this.submissionBaselineTurnKeys.includes(submittedKey)) {
          const submittedTurn = findTurnElement(nextRoot, submittedKey);
          if (submittedTurn && hasUserBubble(submittedTurn)) {
            const observation = collectTurnObservation(submittedTurn);
            if (observation) {
              this.automaticInputKeys.add(submittedKey);
              const changed = session.observe(observation, true, identities.turnKeys, Date.now(), true);
              if (observation.inputChars !== undefined) this.automaticInputKeys.delete(submittedKey);
              if (changed) this.markDirty(nextId);
              this.submissionBaselineTurnKeys = [];
              this.submissionFromNewConversation = false;
              this.submissionPendingUntil = 0;
              this.lastSubmissionSource = null;
            }
          }
        }
      }
      const currentStored = loaded.ok ? loaded.store.conversations[nextId] : undefined;
      const nextStored = session.conversation();
      if (loaded.ok && !cachedSession && !sameConversation(currentStored, nextStored)) this.markDirty(nextId);
      if (!loaded.ok) this.failedConversations.set(nextId, loaded.reason);
      else this.failedConversations.delete(nextId);
      this.observer = observeConversationMutations(nextRoot, (records) => this.onMutations(records));
      this.historyScan = new ConversationStatisticsHistoryManager({
        document: this.options.document,
        window: this.options.window,
        root: nextRoot,
        conversationId: nextId,
        currentConversationId: () => this.conversationId,
        getCurrentRoot: () => this.root,
        getSession: () => this.session,
        isDisposed: () => this.disposed,
        onDirty: () => this.markDirty(nextId),
        onState: () => this.publish(),
      });
      this.bindComposerForm();
      if (this.storageReady && this.dirtyConversations.has(nextId)) this.markDirty(nextId);
      this.publish();
    } catch {
      this.loading = false;
      this.failedConversations.set(nextId, 'dom-failed');
      this.publish();
    }
  }

  private onMutations(records: readonly MutationRecord[]): void {
    this.historyScan?.handleMutations(records);
    const root = this.root;
    const session = this.session;
    const conversationId = this.conversationId;
    if (!root || !session || !conversationId) return;
    try {
      const candidates = new Set<Element>();
      const removedTurnKeys = new Set<string>();
      const addElement = (element: Element) => {
        if (element.matches('[data-turn-key]')) candidates.add(element);
        const ancestor = element.closest('[data-turn-key]');
        if (ancestor) candidates.add(ancestor);
        element.querySelectorAll('[data-turn-key]').forEach((turn) => candidates.add(turn));
      };
      for (const record of records) {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target) addElement(target);
        for (const node of Array.from(record.addedNodes)) {
          if (node instanceof Element) addElement(node);
        }
        for (const node of Array.from(record.removedNodes)) {
          if (node instanceof Element) collectTurnKeysInSubtree(node).forEach((key) => removedTurnKeys.add(key));
        }
      }

      let changed = false;
      for (const turn of candidates) {
        const identity = collectTurnIdentity(turn);
        if (!identity) continue;
        const completion = this.answerCompletionTracker.observe(identity);
        if (completion) {
          try { this.options.onAnswerCompleted?.(completion); } catch { /* Sound callbacks must not affect statistics. */ }
        }
        const key = identity.turnKey;
        const existing = session.hasIdentity(key);
        if (!existing) {
          if (Date.now() > this.submissionPendingUntil || !hasUserBubble(turn)) continue;
          const visibleTurnKeys = collectConversationTurnKeys(root);
          if (visibleTurnKeys.at(-1) !== key) continue;
          const observation = collectTurnObservation(turn);
          if (!observation) continue;
          this.automaticInputKeys.add(key);
          this.submissionPendingUntil = 0;
          changed = session.observe(observation, true, visibleTurnKeys, Date.now(), false, [...removedTurnKeys]) || changed;
          if (observation.inputChars !== undefined) this.automaticInputKeys.delete(key);
          this.submissionBaselineTurnKeys = [];
          this.submissionFromNewConversation = false;
          this.lastSubmissionSource = null;
          continue;
        }

        const previous = session.identity(key);
        const assistantChanged = previous?.assistantMessageId !== identity.assistantMessageId
          && previous?.assistantMessageId !== undefined;
        const generationStarted = previous?.assistantState !== 'in_progress' && identity.assistantState === 'in_progress';
        const answerMutation = assistantChanged || generationStarted
          || (session.hasPendingAnswer(key) && identity.assistantState === 'complete');
        const inputRetry = this.automaticInputKeys.has(key);
        if (answerMutation || inputRetry) {
          const observation = this.automaticInputKeys.has(key)
            ? collectTurnObservation(turn)
            : collectTurnAssistantObservation(turn);
          if (observation) {
            const visibleOrder = assistantChanged || generationStarted
              ? collectConversationTurnKeys(root)
              : session.conversation()?.turnOrder ?? [key];
            changed = session.observe(observation, hasUserBubble(turn), visibleOrder, Date.now()) || changed;
            if (observation.inputChars !== undefined) this.automaticInputKeys.delete(key);
          }
        }
        session.rememberIdentity({
          turnKey: identity.turnKey,
          ...(identity.assistantMessageId ? { assistantMessageId: identity.assistantMessageId } : {}),
          assistantState: identity.assistantState,
        });
      }
      if (changed) this.markDirty(conversationId);
    } catch {
      this.failedConversations.set(conversationId, 'dom-failed');
      this.publish();
    }
  }

  private bindComposerForm(): void {
    const form = findComposerForm(this.options.document);
    if (form === this.activeForm) return;
    this.unbindComposerForm();
    if (!form) return;
    this.activeForm = form;
    form.addEventListener('submit', this.onComposerSubmit, true);
  }
  private unbindComposerForm(): void {
    this.activeForm?.removeEventListener('submit', this.onComposerSubmit, true);
    this.activeForm = null;
  }
  private async reloadStorageForRecount(conversationId: string): Promise<void> {
    let result: StatisticsRepositoryResult;
    try {
      result = await this.options.repository.loadStore();
    } catch {
      result = { ok: false, reason: 'storage-failed' };
    }
    if (this.conversationId !== conversationId || !this.session) return;
    if (!result.ok) {
      this.failedConversations.set(conversationId, result.reason);
      return;
    }
    this.session.rebaseStore(result.store);
    this.storageReady = true;
    this.failedConversations.delete(conversationId);
  }
  private markDirty(conversationId: string): void {
    this.dirtyConversations.add(conversationId);
    if (this.session && this.conversationId === conversationId) this.volatileSessions.set(conversationId, this.session);
    if (this.storageReady && this.conversationId === conversationId) {
      if (this.saveTimer !== undefined) this.options.window.clearTimeout(this.saveTimer);
      this.saveTimer = this.options.window.setTimeout(() => {
        this.saveTimer = undefined;
        this.flushSave();
      }, SAVE_DEBOUNCE_MS);
    }
    this.publish();
  }
  private flushSave(): void {
    const conversationId = this.conversationId;
    const session = this.session;
    const conversation = session?.conversation();
    if (!conversationId || !session || !conversation || !this.storageReady || !this.dirtyConversations.has(conversationId) || this.savingConversations.has(conversationId)) {
      this.publish();
      return;
    }
    const snapshot = JSON.stringify(conversation);
    this.savingConversations.add(conversationId);
    this.publish();
    void this.options.repository.saveConversation(conversationId, conversation).then((result) => {
      if (!result.ok) {
        this.failedConversations.set(conversationId, result.reason);
        this.dirtyConversations.add(conversationId);
        return;
      }
      this.failedConversations.delete(conversationId);
      const unchanged = session === this.volatileSessions.get(conversationId)
        && JSON.stringify(session.conversation()) === snapshot;
      session.confirmPersisted(conversation, result.conversation);
      if (unchanged) {
        this.dirtyConversations.delete(conversationId);
        this.volatileSessions.delete(conversationId);
      }
    }).catch(() => {
      this.failedConversations.set(conversationId, 'storage-failed');
      this.dirtyConversations.add(conversationId);
    }).finally(() => {
      this.savingConversations.delete(conversationId);
      if (this.conversationId === conversationId) {
        if (this.dirtyConversations.has(conversationId) && !this.failedConversations.has(conversationId)) this.markDirty(conversationId);
        this.publish();
      }
    });
  }

  private publish(): void {
    if (this.disposed) return;
    const conversationId = this.conversationId;
    const session = this.session;
    const state: ConversationStatisticsViewState = {
      conversationId,
      aggregate: session?.statistics() ?? aggregateConversationStatistics(undefined),
      loading: this.loading,
      recounting: this.recounting,
      historyScan: this.historyScan?.state ?? {
        scanning: false, cancelRequested: false, direction: null,
        steps: 0, turnKeysSeen: 0, newlyMeasuredTurns: 0, outcome: null,
      },
      saving: conversationId ? this.savingConversations.has(conversationId) : false,
      unsaved: conversationId ? this.dirtyConversations.has(conversationId) : false,
      error: conversationId ? this.failedConversations.get(conversationId) ?? null : null,
    };
    try { this.options.onState(state); } catch { /* UI callbacks must not affect ChatGPT actions. */ }
  }
}
