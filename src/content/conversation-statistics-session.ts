import {
  aggregateConversationStatistics,
  mergeConversationStatistics,
  mergeStoredConversationStatistics,
  type ConversationStatisticsAggregate,
  type StatisticsObservation,
  type StatisticsStore,
  type StoredConversationStatistics,
} from '../shared/conversation-statistics.ts';

const SUBMISSION_WINDOW_MS = 15_000;

function removedBranchStart(
  existingOrder: readonly string[],
  submissionBaseline: readonly string[],
  removedTurnKeys: readonly string[],
): string | undefined {
  const removed = new Set(removedTurnKeys);
  return existingOrder.find((key) => removed.has(key) && submissionBaseline.includes(key));
}

export class ConversationStatisticsSession {
  private readonly conversationId: string;
  private store: StatisticsStore;
  private baselineConversation: StoredConversationStatistics | undefined;
  private readonly identities = new Map<string, StatisticsObservation>();
  private readonly automaticAnswers = new Set<string>();
  private readonly automaticInputs = new Set<string>();
  private submissionExpiresAt = 0;
  private submissionBaselineTurnKeys: readonly string[] = [];
  private historyScopeConfirmed = false;
  private manualSnapshotPartial = false;

  constructor(
    conversationId: string,
    store: StatisticsStore,
    visibleTurnKeys: readonly string[],
    initialIdentities: readonly StatisticsObservation[],
  ) {
    this.conversationId = conversationId;
    this.baselineConversation = store.conversations[conversationId];
    this.store = mergeConversationStatistics(store, conversationId, visibleTurnKeys, initialIdentities, 'initial');
    for (const identity of initialIdentities) {
      this.identities.set(identity.turnKey, identity);
      if (identity.assistantState === 'in_progress') this.automaticAnswers.add(identity.turnKey);
    }
  }

  noteSubmission(now: number, visibleTurnKeys: readonly string[] = []): void {
    this.submissionExpiresAt = now + SUBMISSION_WINDOW_MS;
    this.submissionBaselineTurnKeys = [...visibleTurnKeys];
  }

  confirmNewConversationStart(submittedTurnKey?: string): void {
    const conversation = this.conversation();
    if (!conversation) return;
    const turnIds = Object.keys(conversation.turns);
    const emptyStart = conversation.turnOrder.length === 0 && turnIds.length === 0;
    const firstSubmittedTurn = submittedTurnKey !== undefined
      && conversation.turnOrder.length === 1
      && conversation.turnOrder[0] === submittedTurnKey
      && turnIds.length === 1
      && turnIds[0] === submittedTurnKey;
    if (emptyStart || firstSubmittedTurn) this.historyScopeConfirmed = true;
  }

  observe(
    observation: StatisticsObservation,
    hasUser: boolean,
    visibleTurnKeys: readonly string[],
    now: number,
    submittedDuringInitialization = false,
    removedTurnKeys: readonly string[] = [],
  ): boolean {
    const key = observation.turnKey;
    const previous = this.identities.get(key);
    const isNewSubmittedTurn = (!previous || submittedDuringInitialization)
      && now <= this.submissionExpiresAt
      && hasUser
      && visibleTurnKeys.at(-1) === key;
    if (!previous && !isNewSubmittedTurn) {
      return false;
    }

    let branchTurnKey: string | undefined;
    if (isNewSubmittedTurn) {
      this.submissionExpiresAt = 0;
      this.automaticInputs.add(key);
      this.automaticAnswers.add(key);
      const conversation = this.conversation();
      if (conversation) branchTurnKey = removedBranchStart(
        conversation.turnOrder,
        this.submissionBaselineTurnKeys,
        removedTurnKeys,
      ) ? key : undefined;
    } else if (previous) {
      const assistantChanged = previous.assistantMessageId !== observation.assistantMessageId
        && (previous.assistantMessageId !== undefined || observation.assistantMessageId !== undefined);
      const generationStarted = previous.assistantState !== 'in_progress' && observation.assistantState === 'in_progress';
      if (assistantChanged || generationStarted) {
        this.automaticAnswers.add(key);
        branchTurnKey = key;
      }
    }

    const canObserveAnswer = this.automaticAnswers.has(key);
    const canObserveInput = this.automaticInputs.has(key);
    const conversation = Object.hasOwn(this.store.conversations, this.conversationId)
      ? this.store.conversations[this.conversationId]
      : undefined;
    const stored = conversation && Object.hasOwn(conversation.turns, key) ? conversation.turns[key] : undefined;
    const answerChanged = previous?.assistantMessageId !== observation.assistantMessageId
      || previous?.assistantState !== observation.assistantState;
    const answerIncomplete = observation.assistantState === 'complete'
      && observation.outputChars !== undefined
      && stored?.outputChars === undefined;
    const inputIncomplete = canObserveInput && observation.inputChars !== undefined && stored?.inputChars === undefined;
    this.identities.set(key, observation);
    if ((!canObserveAnswer && !inputIncomplete)
      || (canObserveAnswer && !answerChanged && !answerIncomplete && !inputIncomplete)) return false;

    const safeObservation: StatisticsObservation = {
      turnKey: key,
      ...(canObserveInput && observation.inputChars !== undefined ? { inputChars: observation.inputChars } : {}),
      ...(observation.assistantMessageId ? { assistantMessageId: observation.assistantMessageId } : {}),
      ...(observation.outputChars === undefined ? {} : { outputChars: observation.outputChars }),
      ...(observation.assistantState ? { assistantState: observation.assistantState } : {}),
    };
    const before = JSON.stringify(this.store.conversations[this.conversationId]);
    this.store = mergeConversationStatistics(
      this.store,
      this.conversationId,
      visibleTurnKeys,
      [safeObservation],
      'automatic',
      isNewSubmittedTurn ? key : undefined,
      branchTurnKey,
      branchTurnKey ? removedBranchStart(
        this.conversation()?.turnOrder ?? [],
        this.submissionBaselineTurnKeys,
        removedTurnKeys,
      ) : undefined,
    );
    if (isNewSubmittedTurn) this.submissionBaselineTurnKeys = [];
    if (observation.assistantState === 'complete' && observation.outputChars !== undefined) this.automaticAnswers.delete(key);
    if (canObserveInput && observation.inputChars !== undefined) this.automaticInputs.delete(key);
    return before !== JSON.stringify(this.store.conversations[this.conversationId]);
  }

  recount(visibleTurnKeys: readonly string[], observations: readonly StatisticsObservation[], partial = false): void {
    if (!visibleTurnKeys.length) return;
    this.store = mergeConversationStatistics(this.store, this.conversationId, visibleTurnKeys, observations, 'manual-recount');
    this.manualSnapshotPartial = partial;
    this.identities.clear();
    this.automaticAnswers.clear();
    this.automaticInputs.clear();
    for (const observation of observations) {
      this.identities.set(observation.turnKey, observation);
      if (observation.assistantState === 'in_progress') this.automaticAnswers.add(observation.turnKey);
    }
  }

  observeHistory(observations: readonly StatisticsObservation[]): readonly string[] {
    const conversation = this.conversation();
    const newInputKeys = new Set<string>();
    const visibleTurnKeys = observations.map((observation) => observation.turnKey);
    for (const observation of observations) {
      if (observation.inputChars !== undefined && conversation?.turns[observation.turnKey]?.inputChars === undefined) {
        newInputKeys.add(observation.turnKey);
      }
      this.identities.set(observation.turnKey, observation);
      if (observation.assistantState === 'in_progress') this.automaticAnswers.add(observation.turnKey);
      else if (observation.assistantState === 'complete' && observation.outputChars !== undefined) {
        this.automaticAnswers.delete(observation.turnKey);
      }
    }
    const safeObservations = observations.map((observation) => observation.assistantState === 'unknown' ? {
      turnKey: observation.turnKey,
      ...(observation.inputChars === undefined ? {} : { inputChars: observation.inputChars }),
      assistantState: 'unknown' as const,
    } : observation);
    this.store = mergeConversationStatistics(this.store, this.conversationId, visibleTurnKeys, safeObservations, 'manual');
    this.manualSnapshotPartial = true;
    return [...newInputKeys];
  }

  rebaseStore(store: StatisticsStore): void {
    const current = this.conversation();
    const latest = store.conversations[this.conversationId];
    if (!current) {
      this.store = store;
      this.baselineConversation = latest;
      return;
    }
    const conversation = mergeStoredConversationStatistics(this.baselineConversation, current, latest);
    const conversations = Object.assign(Object.create(null) as Record<string, StoredConversationStatistics>, store.conversations);
    conversations[this.conversationId] = conversation;
    this.store = { schemaVersion: 1, conversations };
    this.baselineConversation = latest;
  }

  confirmPersisted(
    submitted: StoredConversationStatistics,
    persisted: StoredConversationStatistics,
  ): void {
    const current = this.conversation();
    if (!current) {
      this.baselineConversation = persisted;
      return;
    }
    const conversation = mergeStoredConversationStatistics(submitted, current, persisted);
    const conversations = Object.assign(Object.create(null) as Record<string, StoredConversationStatistics>, this.store.conversations);
    conversations[this.conversationId] = conversation;
    this.store = { schemaVersion: 1, conversations };
    this.baselineConversation = persisted;
  }

  hasIdentity(turnKey: string): boolean {
    return this.identities.has(turnKey);
  }

  identity(turnKey: string): StatisticsObservation | undefined { return this.identities.get(turnKey); }

  rememberIdentity(identity: StatisticsObservation): void { this.identities.set(identity.turnKey, identity); }

  syncVisibleIdentity(identity: StatisticsObservation): void {
    this.rememberIdentity(identity);
    if (identity.assistantState === 'in_progress') this.automaticAnswers.add(identity.turnKey);
    else this.automaticAnswers.delete(identity.turnKey);
  }

  hasPendingAnswer(turnKey: string): boolean { return this.automaticAnswers.has(turnKey); }

  getStore(): StatisticsStore {
    return this.store;
  }

  conversation(): StoredConversationStatistics | undefined {
    return Object.hasOwn(this.store.conversations, this.conversationId)
      ? this.store.conversations[this.conversationId]
      : undefined;
  }

  statistics(): ConversationStatisticsAggregate {
    const aggregate = aggregateConversationStatistics(this.conversation(), this.historyScopeConfirmed);
    return this.manualSnapshotPartial ? { ...aggregate, partial: true } : aggregate;
  }
}
