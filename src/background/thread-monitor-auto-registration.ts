import {
  CODEX_BRIDGE_AUTO_WATCH_ALARM,
  CODEX_BRIDGE_AUTO_WATCH_THREAD_IDS_LIMIT,
  isCodexBridgeAutoWatchIdentity,
  CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY,
  isCodexBridgeWatchIdentifier,
  type CodexBridgeAutoWatchFailure,
  type CodexBridgeAutoWatchRegistrationReason,
  type CodexBridgeAutoWatchRegistrationResult,
  type CodexBridgeAutoWatchStatus,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import { isConversationId } from '../shared/conversation-route.ts';
import type { LocalStorageLike } from './thread-monitor-storage.ts';
import { MAX_ENTRIES, MAX_SKIPS_PER_ENTRY, readAutoWatchState,
  type AutoEntry, type AutoState } from './thread-monitor-auto-registration-state.ts';
import { CodexBridgeAutoWatchCandidates, type CodexBridgeAutoWatchCandidateLookupResult }
  from './thread-monitor-auto-registration-candidates.ts';
import { failureFor } from './thread-monitor-auto-registration-utils.ts';
import { registerCompletedAnswerOnce } from './thread-monitor-auto-registration-completion.ts';
import { CodexBridgeAutoRegistrationQueue } from './thread-monitor-auto-registration-queue.ts';
import type { CodexBridgeOwnerIdentity } from './thread-monitor-owner-lease.ts';
import type { CodexBridgeSessionOwnerLeases } from './thread-monitor-owner-lease.ts';
import { CodexBridgeAutoRegistrationOwner, claimOwnerForIdentity, hasOwnerRecords, readOwnerMute,
  rebindAutoEntryState, type OwnerClaimResult, type OwnerMuteResult, type RuntimeOwnerClaim }
  from './thread-monitor-auto-registration-owner.ts';
import type { CodexBridgeMonitorAccess, CodexBridgeThreadMonitor } from './thread-monitor.ts';

type AlarmLike = Readonly<{ clear(name: string): Promise<boolean> }>;
type MonitorLike = Pick<CodexBridgeThreadMonitor, 'list' | 'read' | 'startWatch' | 'stopWatch' | 'updateOwnerMute'
  | 'scheduleTargetRequest'> & Partial<Pick<CodexBridgeThreadMonitor, 'listEvents' | 'rebindOwner'>>;
type Result = Readonly<{ ok: true; status: CodexBridgeAutoWatchStatus }>
  | Readonly<{ ok: false; reason: CodexBridgeAutoWatchFailure | 'connection-unavailable' | 'auto-owner-conflict' }>;

const MAX_COMPLETION_DEDUPLICATION = 256;
const MAX_THREAD_ID_LENGTH = 512;

function completionOutcome(reason: CodexBridgeAutoWatchRegistrationReason): CodexBridgeAutoWatchRegistrationResult {
  return { registeredCount: 0, outcomes: [{ reason, count: 1 }] };
}

export class CodexBridgeAutoThreadRegistration {
  private readonly storage: LocalStorageLike;
  private readonly alarms: AlarmLike;
  private readonly monitor: MonitorLike;
  private readonly resolveAccess: () => Promise<CodexBridgeMonitorAccess>;
  private readonly loadOwnerMute: (tabId: number, conversationId: string) => Promise<OwnerMuteResult>;
  private readonly ownerTabMatches: (tabId: number, conversationId: string) => Promise<boolean>;
  private readonly ownerTabCanBeRebound: (tabId: number, conversationId: string) => Promise<boolean>;
  private readonly ownerLeases?: Pick<CodexBridgeSessionOwnerLeases, 'claim' | 'release'>;
  private readonly runtimeOwner?: CodexBridgeAutoRegistrationOwner;
  private readonly candidates: CodexBridgeAutoWatchCandidates;
  private readonly queues = new CodexBridgeAutoRegistrationQueue();
  private readonly completionFlights = new Set<string>();
  private readonly recentCompletions = new Set<string>();

  constructor(
    storage: LocalStorageLike,
    alarms: AlarmLike,
    monitor: MonitorLike,
    resolveAccess: () => Promise<CodexBridgeMonitorAccess>,
    loadOwnerMute: (tabId: number, conversationId: string) => Promise<OwnerMuteResult>,
    ownerTabMatches: (tabId: number, conversationId: string) => Promise<boolean>,
    ownerTabCanBeRebound: (tabId: number, conversationId: string) => Promise<boolean> = async () => false,
    ownerLeases?: Pick<CodexBridgeSessionOwnerLeases, 'claim' | 'release'>,
    onOwnerClaim?: (identity: CodexBridgeOwnerIdentity, tabId: number) => Promise<void>,
  ) {
    this.storage = storage; this.alarms = alarms; this.monitor = monitor; this.resolveAccess = resolveAccess;
    this.loadOwnerMute = loadOwnerMute; this.ownerTabMatches = ownerTabMatches; this.ownerTabCanBeRebound = ownerTabCanBeRebound;
    this.ownerLeases = ownerLeases;
    if (ownerLeases) this.runtimeOwner = new CodexBridgeAutoRegistrationOwner({
      leases: ownerLeases, loadMute: loadOwnerMute,
      persist: async (identity, binding) => await this.mutate((state) => rebindAutoEntryState(state, identity, binding)) !== null,
      rebind: (identity, binding) => this.monitor.rebindOwner?.(identity, binding) ?? Promise.resolve(),
      onClaim: onOwnerClaim,
    });
    this.candidates = new CodexBridgeAutoWatchCandidates(storage, monitor, resolveAccess,
      ownerLeases ? async () => true : ownerTabMatches);
  }

  async getStatus(targetId: string, conversationId: string, ownerTabId: number): Promise<CodexBridgeAutoWatchStatus> {
    let access: CodexBridgeMonitorAccess | null = null;
    try { access = await this.resolveAccess(); } catch { /* Report the current connection state below. */ }
    const connectionId = access?.connectionId ?? null;
    let state = await this.readState();
    if (!state) return this.emptyStatus(targetId, connectionId, conversationId, 'error', 'storage-error');
    if (!connectionId) return this.emptyStatus(targetId, null, conversationId, 'error', access?.failure ?? 'connection-unavailable');
    let selected = state.entries.find((item) => item.connectionId === connectionId && item.targetId === targetId
      && item.ownerConversationId === conversationId) ?? null;
    const items = await this.monitor.list();
    const events = await this.monitor.listEvents?.() ?? [];
    const hasWork = selected?.enabled || hasOwnerRecords({ connectionId, targetId, conversationId }, [...items, ...events]);
    const ownerState = this.ownerLeases && hasWork
      ? await this.claimRuntimeOwner({ connectionId, targetId, conversationId }, ownerTabId) : null;
    if (ownerState === 'storage-error') return this.emptyStatus(targetId, connectionId, conversationId, 'error', 'storage-error');
    if (ownerState) {
      state = await this.readState();
      if (!state) return this.emptyStatus(targetId, connectionId, conversationId, 'error', 'storage-error');
      selected = state.entries.find((item) => item.connectionId === connectionId && item.targetId === targetId
        && item.ownerConversationId === conversationId) ?? null;
    }
    const watchingThreadCount = items.filter((item) => item.connectionId === connectionId && item.targetId === targetId
      && item.ownerConversationId === conversationId).length;
    if (!selected) {
      const staleEnabled = state.entries.some((item) => item.targetId === targetId && item.enabled
        && item.ownerConversationId === conversationId && item.connectionId !== connectionId);
      if (staleEnabled) return this.emptyStatus(targetId, connectionId, conversationId, 'error', 'connection-changed');
      if (ownerState === 'other-tab') return this.emptyStatus(targetId, connectionId, conversationId, 'conflict', 'auto-owner-conflict');
      if (ownerState === 'recovering') return this.emptyStatus(targetId, connectionId, conversationId, 'recovering', 'owner-recovering');
      return this.emptyStatus(targetId, connectionId, conversationId, 'off', null);
    }
    if (ownerState === 'other-tab') return { targetId, connectionId: selected.connectionId, enabled: selected.enabled,
      ownerConversationId: null, state: 'conflict', failure: 'auto-owner-conflict', watchingThreadCount };
    if (ownerState === 'recovering') return { targetId, connectionId: selected.connectionId, enabled: selected.enabled,
      ownerConversationId: conversationId, state: 'recovering', failure: 'owner-recovering', watchingThreadCount };
    if (!this.ownerLeases && selected.enabled && (selected.ownerTabId !== ownerTabId
      || !await this.ownerTabMatches(ownerTabId, conversationId).catch(() => false))) {
      return this.emptyStatus(targetId, selected.connectionId, conversationId, 'error', 'owner-tab-unavailable');
    }
    return {
      targetId,
      connectionId: selected.connectionId,
      enabled: selected.enabled,
      ownerConversationId: selected.ownerConversationId,
      state: selected.failure && selected.failure !== 'owner-tab-unavailable' ? 'error' : selected.enabled ? 'ready' : 'off',
      failure: selected.failure === 'owner-tab-unavailable' ? null : selected.failure,
      watchingThreadCount,
    };
  }

  async claimOwner(targetId: string, conversationId: string, ownerTabId: number): Promise<OwnerClaimResult> {
    if (!this.ownerLeases) return 'current';
    return claimOwnerForIdentity(targetId, conversationId, ownerTabId,
      async () => (await this.resolveAccess()).connectionId ?? null,
      async (identity) => {
        const state = await this.readState();
        if (!state) return null;
        const [items, events] = await Promise.all([this.monitor.list(), this.monitor.listEvents?.() ?? Promise.resolve([])]);
        return state.entries.some((entry) => entry.connectionId === identity.connectionId && entry.targetId === targetId
          && entry.ownerConversationId === conversationId && entry.enabled) || hasOwnerRecords(identity, [...items, ...events]);
      }, this.ownerLeases, (identity, tabId) => this.claimRuntimeOwner(identity, tabId));
  }

  async setEnabled(targetId: string, ownerTabId: number, conversationId: string, enabled: boolean): Promise<Result> {
    if (!isCodexBridgeWatchIdentifier(targetId) || targetId.length > MAX_THREAD_ID_LENGTH
      || !Number.isSafeInteger(ownerTabId) || ownerTabId < 0 || !isConversationId(conversationId)) {
      return { ok: false, reason: 'connection-unavailable' };
    }
    let initialAccess: CodexBridgeMonitorAccess;
    try { initialAccess = await this.resolveAccess(); } catch (error) { return { ok: false, reason: failureFor(error) }; }
    if (!initialAccess.connectionId) return { ok: false, reason: initialAccess.failure ?? 'connection-unavailable' };
    const expectedConnectionId = initialAccess.connectionId;
    return this.queues.withTarget(this.entryKey(expectedConnectionId, targetId, conversationId),
      () => this.setEnabledForConnection(targetId, ownerTabId, conversationId, expectedConnectionId, enabled));
  }

  private async setEnabledForConnection(targetId: string, ownerTabId: number, conversationId: string,
    expectedConnectionId: string, enabled: boolean): Promise<Result> {
    let access: CodexBridgeMonitorAccess;
    try { access = await this.resolveAccess(); } catch (error) { return { ok: false, reason: failureFor(error) }; }
    if (access.connectionId !== expectedConnectionId) return { ok: false, reason: access.connectionId ? 'connection-changed'
      : access.failure ?? 'connection-unavailable' };
    if (!enabled) {
      const before = await this.readState();
      if (!before) return { ok: false, reason: 'storage-error' };
      const saved = await this.mutate((state) => ({ ...state, entries: state.entries.map((item) =>
        item.connectionId === expectedConnectionId && item.targetId === targetId
          && item.ownerConversationId === conversationId ? { ...item, enabled: false, failure: null,
            liveThreadCount: null, lastScannedAt: null, nextScanAt: 0, failureCount: 0 } : item) }));
      if (saved === null) return { ok: false, reason: 'storage-error' };
      return { ok: true, status: await this.getStatus(targetId, conversationId, ownerTabId) };
    }
    if (this.ownerLeases) {
      const claim = await this.claimOwner(targetId, conversationId, ownerTabId);
      if (claim === 'storage-error') return { ok: false, reason: 'storage-error' };
      if (claim === 'other-tab') return { ok: false, reason: 'auto-owner-conflict' };
      if (claim === 'recovering') return { ok: false, reason: 'owner-recovering' };
      if (claim === 'connection-unavailable') return { ok: false, reason: 'connection-unavailable' };
    } else if (!await this.ownerTabMatches(ownerTabId, conversationId).catch(() => false)) {
      return { ok: false, reason: 'owner-tab-unavailable' };
    }
    const configured = await this.readState();
    if (!configured) return { ok: false, reason: 'storage-error' };
    const competingOwner = configured.entries.find((item) => item.connectionId === expectedConnectionId && item.targetId === targetId
      && item.ownerConversationId === conversationId && item.enabled && item.ownerTabId !== ownerTabId);
    const staleOwnerTabId = competingOwner && await this.ownerTabCanBeRebound(competingOwner.ownerTabId, conversationId)
      .catch(() => false)
      ? competingOwner.ownerTabId : null;
    if (competingOwner && staleOwnerTabId === null) return { ok: false, reason: 'auto-owner-conflict' };
    if (!access.readTargets) return { ok: false, reason: access.failure ?? 'readonly-tool-unavailable' };
    try {
      const targets = access.readsScheduled ? await access.readTargets('manual')
        : await this.monitor.scheduleTargetRequest(targetId, () => access.readTargets!('manual'));
      if (!targets.some((candidate) => candidate.id === targetId && candidate.available !== false)) {
        return { ok: false, reason: 'target-unavailable' };
      }
    } catch (error) { return { ok: false, reason: failureFor(error) }; }
    let latestAccess: CodexBridgeMonitorAccess;
    try { latestAccess = await this.resolveAccess(); } catch (error) { return { ok: false, reason: failureFor(error) }; }
    if (latestAccess.connectionId !== expectedConnectionId || (access.generation !== undefined
      && latestAccess.generation !== access.generation)) return { ok: false, reason: 'connection-changed' };
    if (!this.ownerLeases && !await this.ownerTabMatches(ownerTabId, conversationId).catch(() => false)) {
      return { ok: false, reason: 'owner-tab-unavailable' };
    }
    const ownerMute = await readOwnerMute(this.loadOwnerMute, ownerTabId, conversationId);
    if (!this.ownerLeases && staleOwnerTabId !== null
      && !await this.ownerTabCanBeRebound(staleOwnerTabId, conversationId).catch(() => false)) return { ok: false, reason: 'auto-owner-conflict' };
    const stored = await this.mutate((current) => {
      const competing = current.entries.find((item) => item.connectionId === expectedConnectionId && item.targetId === targetId
        && item.ownerConversationId === conversationId && item.enabled && item.ownerTabId !== ownerTabId);
      if (competing && competing.ownerTabId !== staleOwnerTabId) return { state: current, value: 'conflict' as const };
      const existing = current.entries.find((item) => item.connectionId === expectedConnectionId && item.targetId === targetId
        && item.ownerConversationId === conversationId);
      if (!existing && current.entries.length >= MAX_ENTRIES) return { state: current, value: 'storage-error' as const };
      const entry: AutoEntry = { connectionId: expectedConnectionId, targetId, enabled: true, ownerTabId,
        ownerConversationId: conversationId, ownerMuted: ownerMute.muted, ownerMuteRevision: ownerMute.revision,
        failure: null, liveThreadCount: null, lastScannedAt: null, nextScanAt: 0, failureCount: 0,
        skippedExecutions: existing?.skippedExecutions ?? [] };
      return { state: { version: 1 as const, entries: [...current.entries.filter((item) => item !== existing), entry] },
        value: 'saved' as const };
    });
    if (!stored) return { ok: false, reason: 'storage-error' };
    if (stored === 'conflict') return { ok: false, reason: 'auto-owner-conflict' };
    if (stored === 'storage-error') return { ok: false, reason: 'storage-error' };
    return { ok: true, status: await this.getStatus(targetId, conversationId, ownerTabId) };
  }

  async registerCompletedAnswer(
    targetId: string,
    candidateConnectionId: string,
    ownerTabId: number,
    conversationId: string,
    turnKey: string,
    assistantMessageId: string,
    candidateThreadIds: readonly string[],
  ): Promise<number> {
    return (await this.registerCompletedAnswerWithDiagnostics(targetId, candidateConnectionId, ownerTabId, conversationId,
      turnKey, assistantMessageId, candidateThreadIds)).registeredCount;
  }

  async registerCompletedAnswerWithDiagnostics(
    targetId: string,
    candidateConnectionId: string,
    ownerTabId: number,
    conversationId: string,
    turnKey: string,
    assistantMessageId: string,
    candidateThreadIds: readonly string[],
  ): Promise<CodexBridgeAutoWatchRegistrationResult> {
    if (!isCodexBridgeWatchIdentifier(targetId) || targetId.length > MAX_THREAD_ID_LENGTH
      || !isCodexBridgeWatchIdentifier(candidateConnectionId) || candidateConnectionId.length > 96
      || !Number.isSafeInteger(ownerTabId) || ownerTabId < 0 || !isConversationId(conversationId)
      || !isCodexBridgeAutoWatchIdentity(turnKey) || !isCodexBridgeAutoWatchIdentity(assistantMessageId)
      || !Array.isArray(candidateThreadIds) || !candidateThreadIds.length
      || candidateThreadIds.length > CODEX_BRIDGE_AUTO_WATCH_THREAD_IDS_LIMIT
      || Array.from(candidateThreadIds).some((id) => !isCodexBridgeWatchIdentifier(id) || id.length > MAX_THREAD_ID_LENGTH)) {
      return completionOutcome('invalid-request');
    }
    const threadIds = [...new Set(candidateThreadIds)];
    const dedupeKey = `${candidateConnectionId}\u0000${targetId}\u0000${ownerTabId}\u0000${conversationId}\u0000${turnKey}\u0000${assistantMessageId}`;
    if (this.recentCompletions.has(dedupeKey)) return completionOutcome('completion-already-processed');
    if (this.completionFlights.has(dedupeKey)) return completionOutcome('completion-in-progress');
    this.completionFlights.add(dedupeKey);
    try {
      return await this.queues.withTarget(this.entryKey(candidateConnectionId, targetId, conversationId),
        () => registerCompletedAnswerOnce({
          monitor: this.monitor, resolveAccess: this.resolveAccess, loadOwnerMute: this.loadOwnerMute,
          ownerLeasesEnabled: Boolean(this.ownerLeases),
          claimRuntimeOwner: (identity, tabId) => this.claimRuntimeOwner(identity, tabId),
          readState: () => this.readState(), mutate: <T>(operation: (state: AutoState) => AutoState | { state: AutoState; value: T }) => this.mutate(operation),
          ownerTabMatches: this.ownerTabMatches,
          recordFailureForOwner: (connectionId, targetId, tabId, ownerConversationId, failure) =>
            this.recordFailureForOwner(connectionId, targetId, tabId, ownerConversationId, failure),
          recordFailureForEntry: (entry, failure) => this.recordFailureForEntry(entry, failure),
        }, targetId, candidateConnectionId, ownerTabId, conversationId, threadIds));
    } finally {
      this.rememberCompletion(dedupeKey);
      this.completionFlights.delete(dedupeKey);
    }
  }

  async restore(): Promise<void> {
    try { await this.alarms.clear(CODEX_BRIDGE_AUTO_WATCH_ALARM); } catch { /* Retire legacy discovery alarms only. */ }
  }

  async getRunningCandidates(targetId: string, ownerTabId: number, conversationId: string, turnKey: string,
    assistantMessageId: string): Promise<CodexBridgeAutoWatchCandidateLookupResult> {
    if (this.ownerLeases) {
      let access: CodexBridgeMonitorAccess;
      try { access = await this.resolveAccess(); } catch (error) { return { ok: false, reason: failureFor(error) }; }
      if (!access.connectionId) return { ok: false, reason: access.failure ?? 'connection-unavailable' };
      const claim = await this.claimRuntimeOwner({ connectionId: access.connectionId, targetId, conversationId }, ownerTabId);
      if (claim === 'storage-error') return { ok: false, reason: 'storage-error' };
      if (claim === 'other-tab') return { ok: false, reason: 'auto-owner-conflict' };
      if (claim === 'recovering') return { ok: false, reason: 'owner-recovering' };
    }
    return this.candidates.get(targetId, ownerTabId, conversationId, turnKey, assistantMessageId);
  }

  async stopWatch(connectionId: string, targetId: string, threadId: string, ownerConversationId: string): Promise<boolean> {
    return this.queues.withTarget(this.entryKey(connectionId, targetId, ownerConversationId), async () => {
      const entry = await this.findEntry(connectionId, targetId, ownerConversationId);
      const item = await this.monitor.read(connectionId, targetId, threadId);
      if (entry?.enabled && entry.ownerConversationId === ownerConversationId
        && item?.ownerConversationId === ownerConversationId) {
        const turnId = item.currentExecutionTurnId;
        await this.mutate((state) => ({ ...state, entries: state.entries.map((candidate) => candidate.connectionId === connectionId
          && candidate.targetId === targetId && candidate.ownerConversationId === ownerConversationId ? {
            ...candidate,
            skippedExecutions: [...candidate.skippedExecutions.filter((skip) => skip.threadId !== threadId), { threadId, turnId }]
              .slice(-MAX_SKIPS_PER_ENTRY),
          } : candidate) }));
      }
      return this.monitor.stopWatch(connectionId, targetId, threadId, ownerConversationId);
    });
  }

  async updateOwnerMute(ownerTabId: number, ownerConversationId: string, ownerMuted: boolean | null, revision?: number): Promise<void> {
    await this.mutate((state) => ({ ...state, entries: state.entries.map((entry) => entry.ownerTabId === ownerTabId
      && entry.ownerConversationId === ownerConversationId ? { ...entry, ownerMuted,
        ...(revision === undefined ? {} : { ownerMuteRevision: revision }) } : entry) }));
    await this.monitor.updateOwnerMute(ownerTabId, ownerConversationId, ownerMuted, revision);
  }

  private rememberCompletion(key: string): void {
    this.recentCompletions.add(key);
    while (this.recentCompletions.size > MAX_COMPLETION_DEDUPLICATION) {
      this.recentCompletions.delete(this.recentCompletions.values().next().value!);
    }
  }

  private async recordFailureForOwner(connectionId: string, targetId: string, ownerTabId: number, conversationId: string,
    failure: CodexBridgeAutoWatchFailure): Promise<void> {
    await this.mutate((state) => ({ ...state, entries: state.entries.map((entry) => entry.connectionId === connectionId
      && entry.targetId === targetId
      && entry.ownerTabId === ownerTabId && entry.ownerConversationId === conversationId && entry.enabled
      ? { ...entry, failure, liveThreadCount: null, lastScannedAt: null, nextScanAt: 0 } : entry) }));
  }

  private async recordFailureForEntry(entry: AutoEntry, failure: CodexBridgeAutoWatchFailure | null): Promise<void> {
    await this.mutate((state) => ({ ...state, entries: state.entries.map((candidate) => candidate.connectionId === entry.connectionId
      && candidate.targetId === entry.targetId && candidate.ownerTabId === entry.ownerTabId
      && candidate.ownerConversationId === entry.ownerConversationId ? {
        ...candidate, failure, liveThreadCount: null, lastScannedAt: null, nextScanAt: 0, failureCount: 0,
      } : candidate) }));
  }

  private claimRuntimeOwner(identity: CodexBridgeOwnerIdentity, ownerTabId: number): Promise<RuntimeOwnerClaim> {
    return this.runtimeOwner!.claim(identity, ownerTabId);
  }
  private emptyStatus(targetId: string, connectionId: string | null, conversationId: string,
    state: CodexBridgeAutoWatchStatus['state'], failure: CodexBridgeAutoWatchFailure | null): CodexBridgeAutoWatchStatus {
    return { targetId, connectionId, enabled: false, ownerConversationId: state === 'conflict' ? null : conversationId,
      state, failure, watchingThreadCount: 0 };
  }

  private entryKey(connectionId: string, targetId: string, conversationId: string): string {
    return `${connectionId}\u0000${targetId}\u0000${conversationId}`;
  }

  private findEntry(connectionId: string, targetId: string, conversationId: string): Promise<AutoEntry | null> {
    return this.readState().then((state) => state?.entries.find((entry) => entry.connectionId === connectionId
      && entry.targetId === targetId && entry.ownerConversationId === conversationId) ?? null);
  }
  private readState(): Promise<AutoState | null> {
    return this.queues.withStorage(async () => {
      try { return readAutoWatchState((await this.storage.get([CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]))[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]); }
      catch { return null; }
    });
  }

  private mutate<T>(operation: (state: AutoState) => AutoState | { state: AutoState; value: T }): Promise<T | null> {
    return this.queues.withStorage(async () => {
      try {
        const state = readAutoWatchState((await this.storage.get([CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]))[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]);
        if (!state) return null;
        const result = operation(state);
        if ('state' in result && 'value' in result) {
          if (result.state !== state) await this.storage.set({ [CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]: result.state });
          return result.value;
        }
        if (result !== state) await this.storage.set({ [CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]: result });
        return undefined as T;
      } catch { return null; }
    });
  }
}
