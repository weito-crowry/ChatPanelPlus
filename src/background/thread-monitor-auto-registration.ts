import {
  CODEX_BRIDGE_AUTO_WATCH_ALARM,
  CODEX_BRIDGE_AUTO_WATCH_THREAD_IDS_LIMIT,
  isCodexBridgeAutoWatchIdentity,
  linkLiveCodexBridgeExecutionTurn,
  CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY,
  isCodexBridgeWatchIdentifier,
  type CodexBridgeAutoWatchFailure,
  type CodexBridgeAutoWatchStatus,
  type CodexBridgeWatchOwnerMute,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeTarget, CodexBridgeThread, CodexBridgeThreadStatus } from '../shared/codexbridge-mcp-protocol.ts';
import { isConversationId } from '../shared/conversation-route.ts';
import type { LocalStorageLike } from './thread-monitor-storage.ts';
import { isAutoWatchFailure, MAX_ENTRIES, MAX_SKIPS_PER_ENTRY, readAutoWatchState,
  type AutoEntry, type AutoState } from './thread-monitor-auto-registration-state.ts';
import { CodexBridgeAutoWatchCandidates, type CodexBridgeAutoWatchCandidateLookupResult }
  from './thread-monitor-auto-registration-candidates.ts';
import type { CodexBridgeMonitorAccess, CodexBridgeThreadMonitor } from './thread-monitor.ts';

type AlarmLike = Readonly<{ clear(name: string): Promise<boolean> }>;
type MonitorLike = Pick<CodexBridgeThreadMonitor, 'list' | 'read' | 'startWatch' | 'stopWatch' | 'updateOwnerMute'
  | 'scheduleTargetRequest'>;
type OwnerMuteResult = { readonly ok: true; readonly muted: boolean; readonly revision: number } | { readonly ok: false };
type Result = Readonly<{ ok: true; status: CodexBridgeAutoWatchStatus }>
  | Readonly<{ ok: false; reason: CodexBridgeAutoWatchFailure | 'connection-unavailable' | 'auto-owner-conflict' }>;

const MAX_COMPLETION_DEDUPLICATION = 256;
const MAX_RUNNING_THREADS = 1_000;
const MAX_THREAD_ID_LENGTH = 512;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | null {
  return isRecord(error) && typeof error.code === 'string' ? error.code : null;
}

function failureFor(error: unknown): CodexBridgeAutoWatchFailure {
  const code = errorCode(error);
  return isAutoWatchFailure(code) ? code : 'unknown';
}

function currentExecution(thread: CodexBridgeThread) {
  return linkLiveCodexBridgeExecutionTurn(thread.currentExecution, thread.lastTurn);
}

function isLiveCandidate(thread: CodexBridgeThread, targetId: string): boolean {
  const execution = currentExecution(thread);
  return thread.targetId === targetId && isCodexBridgeWatchIdentifier(thread.id) && execution !== null
    && (execution.state === 'in_progress' || execution.state === 'running') && execution.evidence === 'live'
    && isCodexBridgeWatchIdentifier(execution.turnId);
}

function statusFromThread(thread: CodexBridgeThread): CodexBridgeThreadStatus {
  const execution = currentExecution(thread)!;
  const confirmedLastTurn = thread.lastTurn?.turnId === execution.turnId && thread.lastTurn.status === 'in_progress'
    && thread.lastTurn.evidence === 'live' ? thread.lastTurn : null;
  const lastTurn = confirmedLastTurn ?? {
    turnId: execution.turnId, status: 'in_progress' as const, category: null, evidence: execution.evidence,
    reason: execution.reason, observedAt: execution.observedAt, needsAttention: execution.needsAttention,
  };
  return {
    targetId: thread.targetId,
    threadId: thread.id,
    state: execution.state,
    currentExecution: execution,
    lastTurn,
    needsAttention: thread.needsAttention,
  };
}

function targetThreadSuffix(targetId: string, threadId: string): string | null {
  if (!isCodexBridgeWatchIdentifier(threadId) || threadId.length > MAX_THREAD_ID_LENGTH) return null;
  const separator = threadId.indexOf('::');
  if (separator < 0) return threadId;
  if (threadId.slice(0, separator) !== targetId) return null;
  const suffix = threadId.slice(separator + 2);
  return suffix.length > 0 ? suffix : null;
}

function threadIdsMatch(targetId: string, candidateId: string, bridgeId: string): boolean {
  const candidate = targetThreadSuffix(targetId, candidateId);
  const returned = targetThreadSuffix(targetId, bridgeId);
  return candidate !== null && returned !== null && candidate === returned;
}

export class CodexBridgeAutoThreadRegistration {
  private readonly storage: LocalStorageLike;
  private readonly alarms: AlarmLike;
  private readonly monitor: MonitorLike;
  private readonly resolveAccess: () => Promise<CodexBridgeMonitorAccess>;
  private readonly loadOwnerMute: (tabId: number, conversationId: string) => Promise<OwnerMuteResult>;
  private readonly ownerTabMatches: (tabId: number, conversationId: string) => Promise<boolean>;
  private readonly candidates: CodexBridgeAutoWatchCandidates;
  private storageTail: Promise<void> = Promise.resolve();
  private readonly targetTails = new Map<string, Promise<void>>();
  private readonly completionFlights = new Set<string>();
  private readonly recentCompletions = new Set<string>();

  constructor(
    storage: LocalStorageLike,
    alarms: AlarmLike,
    monitor: MonitorLike,
    resolveAccess: () => Promise<CodexBridgeMonitorAccess>,
    loadOwnerMute: (tabId: number, conversationId: string) => Promise<OwnerMuteResult>,
    ownerTabMatches: (tabId: number, conversationId: string) => Promise<boolean>,
  ) {
    this.storage = storage; this.alarms = alarms; this.monitor = monitor; this.resolveAccess = resolveAccess;
    this.loadOwnerMute = loadOwnerMute; this.ownerTabMatches = ownerTabMatches;
    this.candidates = new CodexBridgeAutoWatchCandidates(storage, monitor, resolveAccess, ownerTabMatches);
  }

  async getStatus(targetId: string, conversationId: string): Promise<CodexBridgeAutoWatchStatus> {
    let access: CodexBridgeMonitorAccess | null = null;
    try { access = await this.resolveAccess(); } catch { /* Report the current connection state below. */ }
    const connectionId = access?.connectionId ?? null;
    const state = await this.readState();
    if (!state) return this.emptyStatus(targetId, connectionId, conversationId, 'error', 'storage-error');
    const conflict = connectionId ? state.entries.find((item) => item.connectionId === connectionId && item.targetId === targetId
      && item.enabled && item.ownerConversationId !== conversationId) : null;
    const ownedEntries = state.entries.filter((item) => item.targetId === targetId
      && item.ownerConversationId === conversationId).sort((left, right) => Number(right.connectionId === connectionId)
      - Number(left.connectionId === connectionId));
    const selected = ownedEntries.find((item) => item.enabled) ?? ownedEntries[0] ?? null;
    if (!selected && conflict) return this.emptyStatus(targetId, connectionId, conversationId, 'conflict', 'owner-conflict');
    if (!selected) return this.emptyStatus(targetId, connectionId, conversationId,
      connectionId ? 'off' : 'error', connectionId ? null : access?.failure ?? 'connection-unavailable');
    const items = await this.monitor.list();
    const staleConnection = selected.connectionId !== connectionId;
    const failure = conflict ? 'owner-conflict' : staleConnection
      ? access?.failure ?? (connectionId ? 'connection-changed' : 'connection-unavailable') : selected.failure;
    return {
      targetId,
      connectionId: selected.connectionId,
      enabled: selected.enabled,
      ownerConversationId: selected.ownerConversationId,
      state: failure ? 'error' : selected.enabled ? 'ready' : 'off',
      failure,
      watchingThreadCount: items.filter((item) => item.connectionId === selected.connectionId && item.targetId === targetId
        && item.ownerConversationId === conversationId).length,
    };
  }

  async setEnabled(targetId: string, ownerTabId: number, conversationId: string, enabled: boolean): Promise<Result> {
    if (!isCodexBridgeWatchIdentifier(targetId) || targetId.length > MAX_THREAD_ID_LENGTH
      || !Number.isSafeInteger(ownerTabId) || ownerTabId < 0 || !isConversationId(conversationId)) {
      return { ok: false, reason: 'connection-unavailable' };
    }
    if (!enabled) {
      const before = await this.readState();
      if (!before) return { ok: false, reason: 'storage-error' };
      await this.withTarget(this.ownerKey(ownerTabId, targetId), () => this.mutate((state) => ({ ...state,
        entries: state.entries.map((item) => item.targetId === targetId && item.ownerTabId === ownerTabId
          && item.ownerConversationId === conversationId ? {
            ...item, enabled: false, failure: null, liveThreadCount: null, lastScannedAt: null, nextScanAt: 0, failureCount: 0,
          } : item),
      })));
      return { ok: true, status: await this.getStatus(targetId, conversationId) };
    }

    let access: CodexBridgeMonitorAccess;
    try { access = await this.resolveAccess(); } catch (error) { return { ok: false, reason: failureFor(error) }; }
    if (!access.connectionId) return { ok: false, reason: access.failure ?? 'connection-unavailable' };
    if (!await this.ownerTabMatches(ownerTabId, conversationId).catch(() => false)) {
      return { ok: false, reason: 'owner-tab-unavailable' };
    }
    const configured = await this.readState();
    if (!configured) return { ok: false, reason: 'storage-error' };
    if (configured.entries.some((item) => item.connectionId === access.connectionId && item.targetId === targetId
      && item.enabled && (item.ownerConversationId !== conversationId || item.ownerTabId !== ownerTabId))) {
      return { ok: false, reason: 'auto-owner-conflict' };
    }
    if (!access.readTargets) return { ok: false, reason: access.failure ?? 'readonly-tool-unavailable' };
    try {
      const targets = await this.monitor.scheduleTargetRequest(targetId, () => access.readTargets!());
      if (!targets.some((candidate) => candidate.id === targetId && candidate.available !== false)) {
        return { ok: false, reason: 'target-unavailable' };
      }
    } catch (error) { return { ok: false, reason: failureFor(error) }; }
    let latestAccess: CodexBridgeMonitorAccess;
    try { latestAccess = await this.resolveAccess(); } catch (error) { return { ok: false, reason: failureFor(error) }; }
    if (latestAccess.connectionId !== access.connectionId) return { ok: false, reason: 'connection-changed' };

    const ownerMute = await this.readOwnerMute(ownerTabId, conversationId);
    const key = this.ownerKey(ownerTabId, targetId);
    const stored = await this.withTarget(key, () => this.mutate((current) => {
      const competing = current.entries.find((item) => item.connectionId === access.connectionId && item.targetId === targetId
        && item.enabled && (item.ownerConversationId !== conversationId || item.ownerTabId !== ownerTabId));
      if (competing) return { state: current, value: 'conflict' as const };
      const existing = current.entries.find((item) => item.connectionId === access.connectionId && item.targetId === targetId);
      if (!existing && current.entries.length >= MAX_ENTRIES) return { state: current, value: 'storage-error' as const };
      const entry: AutoEntry = {
        connectionId: access.connectionId!, targetId, enabled: true, ownerTabId, ownerConversationId: conversationId,
        ownerMuted: ownerMute.muted, ownerMuteRevision: ownerMute.revision, failure: null, liveThreadCount: null,
        lastScannedAt: null, nextScanAt: 0, failureCount: 0,
        skippedExecutions: existing?.ownerConversationId === conversationId && existing.ownerTabId === ownerTabId
          ? existing.skippedExecutions : [],
      };
      return { state: { version: 1 as const, entries: [...current.entries.filter((item) => item !== existing), entry] }, value: 'saved' as const };
    }));
    if (!stored) return { ok: false, reason: 'storage-error' };
    if (stored === 'conflict') return { ok: false, reason: 'auto-owner-conflict' };
    if (stored === 'storage-error') return { ok: false, reason: 'storage-error' };
    return { ok: true, status: await this.getStatus(targetId, conversationId) };
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
    if (!isCodexBridgeWatchIdentifier(targetId) || targetId.length > MAX_THREAD_ID_LENGTH
      || !isCodexBridgeWatchIdentifier(candidateConnectionId) || candidateConnectionId.length > 96
      || !Number.isSafeInteger(ownerTabId) || ownerTabId < 0 || !isConversationId(conversationId)
      || !isCodexBridgeAutoWatchIdentity(turnKey) || !isCodexBridgeAutoWatchIdentity(assistantMessageId)
      || !Array.isArray(candidateThreadIds) || !candidateThreadIds.length
      || candidateThreadIds.length > CODEX_BRIDGE_AUTO_WATCH_THREAD_IDS_LIMIT
      || Array.from(candidateThreadIds).some((id) => !isCodexBridgeWatchIdentifier(id) || id.length > MAX_THREAD_ID_LENGTH)) return 0;
    const threadIds = [...new Set(candidateThreadIds)];
    const dedupeKey = `${candidateConnectionId}\u0000${targetId}\u0000${ownerTabId}\u0000${conversationId}\u0000${turnKey}\u0000${assistantMessageId}`;
    if (this.recentCompletions.has(dedupeKey) || this.completionFlights.has(dedupeKey)) return 0;
    this.completionFlights.add(dedupeKey);
    try {
      return await this.withTarget(this.ownerKey(ownerTabId, targetId),
        () => this.registerCompletedAnswerOnce(targetId, candidateConnectionId, ownerTabId, conversationId, threadIds));
    } finally {
      this.rememberCompletion(dedupeKey);
      this.completionFlights.delete(dedupeKey);
    }
  }

  async restore(): Promise<void> {
    try { await this.alarms.clear(CODEX_BRIDGE_AUTO_WATCH_ALARM); } catch { /* Retire legacy discovery alarms only. */ }
  }

  getRunningCandidates(targetId: string, ownerTabId: number, conversationId: string, turnKey: string,
    assistantMessageId: string): Promise<CodexBridgeAutoWatchCandidateLookupResult> {
    return this.candidates.get(targetId, ownerTabId, conversationId, turnKey, assistantMessageId);
  }

  async stopWatch(connectionId: string, targetId: string, threadId: string, ownerConversationId: string): Promise<boolean> {
    return this.withTarget(this.key(connectionId, targetId), async () => {
      const entry = await this.findEntry(connectionId, targetId);
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

  private async registerCompletedAnswerOnce(
    targetId: string,
    candidateConnectionId: string,
    ownerTabId: number,
    conversationId: string,
    candidateThreadIds: readonly string[],
  ): Promise<number> {
    const state = await this.readState();
    if (!state) return 0;
    const hasEnabledOwner = state.entries.some((entry) => entry.enabled && entry.targetId === targetId
      && entry.ownerTabId === ownerTabId && entry.ownerConversationId === conversationId);
    if (!hasEnabledOwner) return 0;

    let access: CodexBridgeMonitorAccess;
    try { access = await this.resolveAccess(); } catch (error) {
      await this.recordFailureForOwner(targetId, ownerTabId, conversationId, failureFor(error));
      return 0;
    }
    if (!access.connectionId) {
      await this.recordFailureForOwner(targetId, ownerTabId, conversationId, access.failure ?? 'connection-unavailable');
      return 0;
    }
    if (access.connectionId !== candidateConnectionId) {
      await this.recordFailureForOwner(targetId, ownerTabId, conversationId, 'connection-changed');
      return 0;
    }
    let entry = state.entries.find((candidate) => candidate.enabled && candidate.connectionId === access.connectionId
      && candidate.targetId === targetId && candidate.ownerTabId === ownerTabId
      && candidate.ownerConversationId === conversationId);
    if (!entry) return 0;
    if (!await this.ownerTabMatches(ownerTabId, conversationId).catch(() => false)) {
      await this.recordFailureForEntry(entry, 'owner-tab-unavailable');
      return 0;
    }
    if (!access.readTargets || !access.readRunningThreads) {
      await this.recordFailureForEntry(entry, access.failure ?? 'readonly-tool-unavailable');
      return 0;
    }

    let threads: readonly CodexBridgeThread[];
    try {
      const page = await this.monitor.scheduleTargetRequest(targetId, async () => {
        const targets: readonly CodexBridgeTarget[] = await access.readTargets!();
        if (!targets.some((candidate) => candidate.id === targetId && candidate.available !== false)) {
          throw Object.assign(new Error('target unavailable'), { code: 'target-unavailable' });
        }
        return access.readRunningThreads!(targetId);
      });
      if (!page || page.nextCursor !== null || !Array.isArray(page.threads) || page.threads.length > MAX_RUNNING_THREADS
        || Array.from(page.threads).some((thread) => !isRecord(thread))) {
        throw Object.assign(new Error('invalid running_only response'), { code: 'protocol-error' });
      }
      threads = page.threads;
    } catch (error) {
      await this.recordFailureForEntry(entry, failureFor(error));
      return 0;
    }

    const latestState = await this.readState();
    if (!latestState) return 0;
    entry = latestState.entries.find((candidate) => candidate.enabled && candidate.connectionId === access.connectionId
      && candidate.targetId === targetId && candidate.ownerTabId === ownerTabId
      && candidate.ownerConversationId === conversationId);
    if (!entry) return 0;
    if (!await this.ownerTabMatches(ownerTabId, conversationId).catch(() => false)) {
      await this.recordFailureForEntry(entry, 'owner-tab-unavailable');
      return 0;
    }
    let latestAccess: CodexBridgeMonitorAccess;
    try { latestAccess = await this.resolveAccess(); } catch (error) {
      await this.recordFailureForEntry(entry, failureFor(error));
      return 0;
    }
    if (latestAccess.connectionId !== entry.connectionId || latestAccess.connectionId !== candidateConnectionId) {
      await this.recordFailureForEntry(entry, 'connection-changed');
      return 0;
    }
    const liveCandidates = threads.filter((thread) => isLiveCandidate(thread, targetId));
    const liveByThread = new Map(liveCandidates.map((thread) => [thread.id, currentExecution(thread)!.turnId]));
    const remainingSkips = entry.skippedExecutions.filter((skip) => {
      const activeTurnId = liveByThread.get(skip.threadId);
      return activeTurnId !== undefined && (skip.turnId === null || skip.turnId === activeTurnId);
    });
    if (remainingSkips.length !== entry.skippedExecutions.length) {
      await this.mutate((current) => ({ ...current, entries: current.entries.map((candidate) => candidate.connectionId === entry!.connectionId
        && candidate.targetId === targetId && candidate.ownerTabId === ownerTabId
        && candidate.ownerConversationId === conversationId ? { ...candidate, skippedExecutions: remainingSkips } : candidate) }));
    }
    const ownerMute = await this.readOwnerMute(ownerTabId, conversationId);
    if (ownerMute.muted !== entry.ownerMuted || ownerMute.revision !== entry.ownerMuteRevision) {
      entry = { ...entry, ownerMuted: ownerMute.muted, ownerMuteRevision: ownerMute.revision };
      await this.mutate((current) => ({ ...current, entries: current.entries.map((candidate) => candidate.connectionId === entry!.connectionId
        && candidate.targetId === targetId && candidate.ownerTabId === ownerTabId
        && candidate.ownerConversationId === conversationId ? entry! : candidate) }));
      await this.monitor.updateOwnerMute(ownerTabId, conversationId, ownerMute.muted, ownerMute.revision);
    }

    const candidates = liveCandidates.filter((thread) => candidateThreadIds.some((candidateId) =>
      threadIdsMatch(targetId, candidateId, thread.id)));
    let registeredCount = 0;
    let failure: CodexBridgeAutoWatchFailure | null = null;
    const owner: CodexBridgeWatchOwnerMute = {
      ownerTabId, ownerConversationId: conversationId, ownerMuted: entry.ownerMuted, ownerMuteRevision: entry.ownerMuteRevision,
    };
    for (const thread of candidates) {
      const turnId = liveByThread.get(thread.id) ?? null;
      if (remainingSkips.some((skip) => skip.threadId === thread.id
        && (skip.turnId === null || skip.turnId === turnId))) continue;
      const current = await this.monitor.read(entry.connectionId, targetId, thread.id);
      if (current) {
        if (current.ownerConversationId && current.ownerConversationId !== conversationId) failure = 'owner-conflict';
        else if (!current.ownerConversationId) failure = 'ownerless-watch';
        continue;
      }
      const result = await this.monitor.startWatch(targetId, thread.id, owner, {
        allowOwnerTransfer: false, expectedConnectionId: entry.connectionId, initialStatus: statusFromThread(thread),
      });
      if (result.ok) {
        if (result.created) registeredCount += 1;
        continue;
      }
      if (result.reason === 'watch-limit') { failure = 'watch-limit'; break; }
      if (result.reason === 'owner-unavailable') failure = 'owner-tab-unavailable';
      else if (result.reason === 'owner-conflict') failure = 'owner-conflict';
      else if (result.reason === 'connection-changed') { failure = 'connection-changed'; break; }
    }
    await this.recordFailureForEntry(entry, failure);
    return registeredCount;
  }

  private rememberCompletion(key: string): void {
    this.recentCompletions.add(key);
    while (this.recentCompletions.size > MAX_COMPLETION_DEDUPLICATION) {
      this.recentCompletions.delete(this.recentCompletions.values().next().value!);
    }
  }

  private async recordFailureForOwner(targetId: string, ownerTabId: number, conversationId: string,
    failure: CodexBridgeAutoWatchFailure): Promise<void> {
    await this.mutate((state) => ({ ...state, entries: state.entries.map((entry) => entry.targetId === targetId
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

  private async readOwnerMute(tabId: number, conversationId: string): Promise<{ muted: boolean | null; revision: number }> {
    try {
      const value = await this.loadOwnerMute(tabId, conversationId);
      return value.ok && typeof value.muted === 'boolean' && Number.isSafeInteger(value.revision) && value.revision >= 0
        ? { muted: value.muted, revision: value.revision } : { muted: null, revision: 0 };
    } catch { return { muted: null, revision: 0 }; }
  }

  private emptyStatus(targetId: string, connectionId: string | null, conversationId: string,
    state: CodexBridgeAutoWatchStatus['state'], failure: CodexBridgeAutoWatchFailure | null): CodexBridgeAutoWatchStatus {
    return { targetId, connectionId, enabled: false, ownerConversationId: state === 'conflict' ? null : conversationId,
      state, failure, watchingThreadCount: 0 };
  }

  private key(connectionId: string, targetId: string): string { return `${connectionId}\u0000${targetId}`; }
  private ownerKey(ownerTabId: number, targetId: string): string { return `owner\u0000${ownerTabId}\u0000${targetId}`; }
  private findByKey(key: string): Promise<AutoEntry | null> {
    return this.readState().then((state) => state?.entries.find((entry) => this.key(entry.connectionId, entry.targetId) === key) ?? null);
  }
  private findEntry(connectionId: string, targetId: string): Promise<AutoEntry | null> { return this.findByKey(this.key(connectionId, targetId)); }

  private readState(): Promise<AutoState | null> {
    return this.withStorage(async () => {
      try { return readAutoWatchState((await this.storage.get([CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]))[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]); }
      catch { return null; }
    });
  }

  private mutate<T>(operation: (state: AutoState) => AutoState | { state: AutoState; value: T }): Promise<T | null> {
    return this.withStorage(async () => {
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

  private withStorage<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.storageTail.then(operation, operation);
    this.storageTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private withTarget<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.targetTails.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    this.targetTails.set(key, tail);
    void tail.then(() => { if (this.targetTails.get(key) === tail) this.targetTails.delete(key); });
    return result;
  }
}
