import type { CodexBridgeThread } from '../shared/codexbridge-mcp-protocol.ts';
import type {
  CodexBridgeAutoWatchFailure,
  CodexBridgeAutoWatchRegistrationReason,
  CodexBridgeAutoWatchRegistrationResult,
  CodexBridgeWatchOwnerMute,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeMonitorAccess, CodexBridgeThreadMonitor } from './thread-monitor.ts';
import type { AutoEntry, AutoState } from './thread-monitor-auto-registration-state.ts';
import { currentExecution, failureFor, isLiveCandidate, statusFromThread, threadIdsMatch } from './thread-monitor-auto-registration-utils.ts';
import { readFreshRunningPage } from './thread-monitor-running-page.ts';
import type { CodexBridgeOwnerIdentity } from './thread-monitor-owner-lease.ts';
import type { OwnerMuteResult, RuntimeOwnerClaim } from './thread-monitor-auto-registration-owner.ts';

type Mutation<T> = (operation: (state: AutoState) => AutoState | { state: AutoState; value: T }) => Promise<T | null>;
type Dependencies = Readonly<{
  monitor: Pick<CodexBridgeThreadMonitor, 'read' | 'startWatch' | 'updateOwnerMute' | 'scheduleTargetRequest'>;
  resolveAccess: () => Promise<CodexBridgeMonitorAccess>;
  loadOwnerMute: (tabId: number, conversationId: string) => Promise<OwnerMuteResult>;
  ownerLeasesEnabled: boolean;
  claimRuntimeOwner: (identity: CodexBridgeOwnerIdentity, ownerTabId: number) => Promise<RuntimeOwnerClaim>;
  readState: () => Promise<AutoState | null>;
  mutate: Mutation<unknown>;
  ownerTabMatches: (tabId: number, conversationId: string) => Promise<boolean>;
  recordFailureForOwner: (connectionId: string, targetId: string, ownerTabId: number, conversationId: string,
    failure: CodexBridgeAutoWatchFailure) => Promise<void>;
  recordFailureForEntry: (entry: AutoEntry, failure: CodexBridgeAutoWatchFailure | null) => Promise<void>;
}>;

const ownerClaimReason: Record<Exclude<RuntimeOwnerClaim, 'current'>, CodexBridgeAutoWatchRegistrationReason> = {
  'other-tab': 'owner-claim-other-tab', recovering: 'owner-claim-recovering', 'storage-error': 'owner-claim-storage-error',
};

function result(registeredCount: number, outcomes: Map<CodexBridgeAutoWatchRegistrationReason, number>): CodexBridgeAutoWatchRegistrationResult {
  return { registeredCount, outcomes: Array.from(outcomes, ([reason, count]) => ({ reason, count })) };
}

function watchedReason(ownerConversationId: string | undefined, ownerTabId: number | undefined,
  conversationId: string, expectedTabId: number): CodexBridgeAutoWatchRegistrationReason {
  if (!ownerConversationId) return 'already-watching-ownerless';
  return ownerConversationId === conversationId && ownerTabId === expectedTabId
    ? 'already-watching-same-owner' : 'already-watching-different-owner';
}

export async function registerCompletedAnswerOnce(dependencies: Dependencies, targetId: string, candidateConnectionId: string,
  ownerTabId: number, conversationId: string, candidateThreadIds: readonly string[]): Promise<CodexBridgeAutoWatchRegistrationResult> {
  const outcomes = new Map<CodexBridgeAutoWatchRegistrationReason, number>();
  const add = (reason: CodexBridgeAutoWatchRegistrationReason, count = 1) => outcomes.set(reason, (outcomes.get(reason) ?? 0) + count);
  const stop = async (reason: CodexBridgeAutoWatchRegistrationReason, failure?: CodexBridgeAutoWatchFailure) => {
    add(reason);
    if (failure) await dependencies.recordFailureForOwner(candidateConnectionId, targetId, ownerTabId, conversationId, failure);
    return result(0, outcomes);
  };

  if (dependencies.ownerLeasesEnabled) {
    let claim: RuntimeOwnerClaim;
    try { claim = await dependencies.claimRuntimeOwner({ connectionId: candidateConnectionId, targetId, conversationId }, ownerTabId); }
    catch { return stop('owner-claim-storage-error', 'storage-error'); }
    if (claim !== 'current') return stop(ownerClaimReason[claim], claim === 'storage-error' ? 'storage-error'
      : claim === 'recovering' ? 'owner-recovering' : 'auto-owner-conflict');
  }

  const state = await dependencies.readState();
  if (!state) return stop('owner-state-unavailable', 'storage-error');
  let entry = state.entries.find((item) => item.enabled && item.connectionId === candidateConnectionId
    && item.targetId === targetId && item.ownerTabId === ownerTabId && item.ownerConversationId === conversationId);
  if (!entry) return stop('auto-watch-disabled');

  let access: CodexBridgeMonitorAccess;
  try { access = await dependencies.resolveAccess(); }
  catch (error) {
    const failure = failureFor(error);
    return stop('bridge-read-failed', failure);
  }
  if (!access.connectionId) return stop('connection-unavailable', access.failure ?? 'connection-unavailable');
  if (access.connectionId !== candidateConnectionId) return stop('connection-changed', 'connection-changed');
  if (!dependencies.ownerLeasesEnabled && !await dependencies.ownerTabMatches(ownerTabId, conversationId).catch(() => false)) {
    return stop('owner-tab-unavailable', 'owner-tab-unavailable');
  }
  if (!access.readTargets || (!access.readRunningThreads && !access.readRunningSnapshot)) {
    return stop('bridge-read-failed', access.failure ?? 'readonly-tool-unavailable');
  }

  let threads: readonly CodexBridgeThread[];
  try {
    const page = await readFreshRunningPage(access, dependencies.monitor, targetId,
      { priority: 'manual', maxAgeMs: 0, force: true });
    if (!page || page.nextCursor !== null || !Array.isArray(page.threads) || page.threads.length > 1_000
      || Array.from(page.threads).some((thread) => typeof thread !== 'object' || thread === null || Array.isArray(thread))) {
      throw Object.assign(new Error('invalid running_only response'), { code: 'protocol-error' });
    }
    threads = page.threads;
  } catch (error) {
    const failure = failureFor(error);
    await dependencies.recordFailureForEntry(entry, failure);
    return stop('bridge-read-failed');
  }

  const latestState = await dependencies.readState();
  if (!latestState) return stop('owner-state-unavailable', 'storage-error');
  entry = latestState.entries.find((item) => item.enabled && item.connectionId === access.connectionId
    && item.targetId === targetId && item.ownerTabId === ownerTabId && item.ownerConversationId === conversationId);
  if (!entry) return stop('auto-watch-disabled');
  if (!dependencies.ownerLeasesEnabled && !await dependencies.ownerTabMatches(ownerTabId, conversationId).catch(() => false)) {
    return stop('owner-tab-unavailable', 'owner-tab-unavailable');
  }
  let latestAccess: CodexBridgeMonitorAccess;
  try { latestAccess = await dependencies.resolveAccess(); }
  catch (error) {
    const failure = failureFor(error);
    await dependencies.recordFailureForEntry(entry, failure);
    return stop('bridge-read-failed');
  }
  if (latestAccess.connectionId !== entry.connectionId || latestAccess.connectionId !== candidateConnectionId) {
    await dependencies.recordFailureForEntry(entry, 'connection-changed');
    return stop('connection-changed');
  }
  if (access.generation !== undefined && latestAccess.generation !== access.generation) {
    await dependencies.recordFailureForEntry(entry, 'connection-changed');
    return stop('generation-changed');
  }

  const liveCandidates = threads.filter((thread) => isLiveCandidate(thread, targetId));
  const liveByThread = new Map(liveCandidates.map((thread) => [thread.id, currentExecution(thread)!.turnId]));
  const priorSkips = entry.skippedExecutions;
  const remainingSkips = priorSkips.flatMap((skip) => {
    const activeTurnId = liveByThread.get(skip.threadId);
    if (activeTurnId === undefined) return [];
    if (skip.turnId === null) return [{ threadId: skip.threadId, turnId: activeTurnId }];
    return skip.turnId === activeTurnId ? [skip] : [];
  });
  const skipsChanged = remainingSkips.length !== priorSkips.length
    || remainingSkips.some((skip, index) => skip.threadId !== priorSkips[index]?.threadId
      || skip.turnId !== priorSkips[index]?.turnId);
  if (skipsChanged) {
    entry = { ...entry, skippedExecutions: remainingSkips };
    const saved = await dependencies.mutate((current) => ({
      state: { ...current, entries: current.entries.map((candidate) => candidate.connectionId === entry!.connectionId
        && candidate.targetId === targetId && candidate.ownerTabId === ownerTabId
        && candidate.ownerConversationId === conversationId ? entry! : candidate) }, value: undefined,
    }));
    if (saved === null) return stop('owner-state-unavailable', 'storage-error');
  }

  const candidates = liveCandidates.filter((thread) => candidateThreadIds.some((candidateId) => threadIdsMatch(targetId, candidateId, thread.id)));
  const missingCount = candidateThreadIds.filter((candidateId) => !liveCandidates.some((thread) =>
    threadIdsMatch(targetId, candidateId, thread.id))).length;
  if (missingCount) add('candidate-no-longer-live', missingCount);
  const ownerMute = await (async () => {
    try { return await dependencies.loadOwnerMute(ownerTabId, conversationId); } catch { return { ok: false as const }; }
  })();
  const mute = ownerMute.ok ? { muted: ownerMute.muted, revision: ownerMute.revision } : { muted: null, revision: 0 };
  if (mute.muted !== entry.ownerMuted || mute.revision !== entry.ownerMuteRevision) {
    entry = { ...entry, ownerMuted: mute.muted, ownerMuteRevision: mute.revision };
    const saved = await dependencies.mutate((current) => ({
      state: { ...current, entries: current.entries.map((candidate) => candidate.connectionId === entry!.connectionId
        && candidate.targetId === targetId && candidate.ownerTabId === ownerTabId
        && candidate.ownerConversationId === conversationId ? entry! : candidate) }, value: undefined,
    }));
    if (saved === null) return stop('owner-state-unavailable', 'storage-error');
    await dependencies.monitor.updateOwnerMute(ownerTabId, conversationId, mute.muted, mute.revision);
  }

  let registeredCount = 0;
  let failure: CodexBridgeAutoWatchFailure | null = null;
  const owner: CodexBridgeWatchOwnerMute = {
    ownerTabId, ownerConversationId: conversationId, ownerMuted: entry.ownerMuted, ownerMuteRevision: entry.ownerMuteRevision,
  };
  for (const thread of candidates) {
    const turnId = liveByThread.get(thread.id) ?? null;
    if (remainingSkips.some((skip) => skip.threadId === thread.id && skip.turnId === turnId)) {
      add('explicit-skip');
      continue;
    }
    if (!dependencies.ownerLeasesEnabled && !await dependencies.ownerTabMatches(ownerTabId, conversationId).catch(() => false)) {
      add('owner-tab-unavailable'); failure = 'owner-tab-unavailable'; break;
    }
    const current = await dependencies.monitor.read(entry.connectionId, targetId, thread.id);
    if (current) {
      const reason = watchedReason(current.ownerConversationId, current.ownerTabId, conversationId, ownerTabId);
      add(reason);
      if (reason === 'already-watching-different-owner') failure = 'owner-conflict';
      else if (reason === 'already-watching-ownerless') failure = 'ownerless-watch';
      continue;
    }
    if (!dependencies.ownerLeasesEnabled && !await dependencies.ownerTabMatches(ownerTabId, conversationId).catch(() => false)) {
      add('owner-tab-unavailable'); failure = 'owner-tab-unavailable'; break;
    }
    let started;
    try {
      started = await dependencies.monitor.startWatch(targetId, thread.id, owner, {
        allowOwnerTransfer: false, expectedConnectionId: entry.connectionId, expectedGeneration: access.generation,
        initialStatus: statusFromThread(thread),
      });
    } catch {
      add('start-watch-failed'); failure = 'storage-error'; break;
    }
    if (started.ok) {
      if (started.created) { registeredCount += 1; add('registered'); }
      else add(watchedReason(started.item.ownerConversationId, started.item.ownerTabId, conversationId, ownerTabId));
      continue;
    }
    if (started.reason === 'watch-limit') { add('start-watch-watch-limit'); failure = 'watch-limit'; break; }
    if (started.reason === 'connection-unavailable') { add('start-watch-connection-unavailable'); failure = 'connection-unavailable'; break; }
    if (started.reason === 'connection-changed') { add('start-watch-connection-changed'); failure = 'connection-changed'; break; }
    if (started.reason === 'owner-unavailable') { add('start-watch-owner-unavailable'); failure = 'owner-tab-unavailable'; }
    else { add('start-watch-owner-conflict'); failure = 'owner-conflict'; }
  }
  await dependencies.recordFailureForEntry(entry, failure);
  return result(registeredCount, outcomes);
}
