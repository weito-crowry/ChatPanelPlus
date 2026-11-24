import {
  CODEX_BRIDGE_AUTO_WATCH_BRIDGE_CANDIDATE_CHARS_LIMIT,
  CODEX_BRIDGE_AUTO_WATCH_BRIDGE_CANDIDATE_IDS_LIMIT,
  CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY,
  isCodexBridgeAutoWatchIdentity,
  isCodexBridgeWatchIdentifier,
  linkLiveCodexBridgeExecutionTurn,
  type CodexBridgeAutoWatchCandidateData,
  type CodexBridgeAutoWatchFailure,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeThread } from '../shared/codexbridge-mcp-protocol.ts';
import { isConversationId } from '../shared/conversation-route.ts';
import type { LocalStorageLike } from './thread-monitor-storage.ts';
import { readAutoWatchState } from './thread-monitor-auto-registration-state.ts';
import { readFreshRunningPage } from './thread-monitor-running-page.ts';
import type { CodexBridgeMonitorAccess, CodexBridgeThreadMonitor } from './thread-monitor.ts';

type MonitorLike = Pick<CodexBridgeThreadMonitor, 'scheduleTargetRequest'>;
export type CodexBridgeAutoWatchCandidateLookupResult = Readonly<{ ok: true; data: CodexBridgeAutoWatchCandidateData }>
  | Readonly<{ ok: false; reason: CodexBridgeAutoWatchFailure | 'connection-unavailable' }>;

const MAX_THREAD_ID_LENGTH = 512;
const MAX_RUNNING_THREADS = 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failureFor(error: unknown): CodexBridgeAutoWatchFailure {
  return isRecord(error) && typeof error.code === 'string'
    && ['ok', '401', '403', 'timeout', 'disconnected', 'unknown', 'permission-required', 'settings-unavailable',
      'endpoint-not-found', 'session-expired', 'http-error', 'protocol-error', 'protocol-version-unsupported',
      'readonly-tool-unavailable', 'readonly-probe-failed', 'running-only-unsupported', 'connection-changed',
      'authentication-required', 'forbidden', 'invalid-endpoint', 'read-queue-full', 'response-too-large', 'unknown-error',
      'target-unavailable', 'owner-conflict', 'ownerless-watch', 'watch-limit', 'owner-tab-unavailable',
      'connection-unavailable', 'storage-error'].includes(error.code)
    ? error.code as CodexBridgeAutoWatchFailure : 'unknown';
}

function isLiveCandidate(thread: CodexBridgeThread, targetId: string): boolean {
  const separator = thread.id.indexOf('::');
  const targetMatches = separator < 0 || thread.id.slice(0, separator) === targetId;
  const execution = linkLiveCodexBridgeExecutionTurn(thread.currentExecution, thread.lastTurn);
  return targetMatches && thread.targetId === targetId && isCodexBridgeWatchIdentifier(thread.id)
    && execution !== null && (execution.state?.toLowerCase() === 'in_progress' || execution.state?.toLowerCase() === 'running')
    && execution.evidence?.toLowerCase() === 'live' && isCodexBridgeWatchIdentifier(execution.turnId);
}

function ownerEntries(value: unknown, targetId: string, ownerTabId: number, conversationId: string) {
  const state = readAutoWatchState(value);
  return state ? state.entries.filter((entry) => entry.enabled && entry.targetId === targetId
    && entry.ownerTabId === ownerTabId && entry.ownerConversationId === conversationId) : undefined;
}

export class CodexBridgeAutoWatchCandidates {
  private readonly storage: LocalStorageLike;
  private readonly monitor: MonitorLike;
  private readonly resolveAccess: () => Promise<CodexBridgeMonitorAccess>;
  private readonly ownerTabMatches: (tabId: number, conversationId: string) => Promise<boolean>;

  constructor(storage: LocalStorageLike, monitor: MonitorLike, resolveAccess: () => Promise<CodexBridgeMonitorAccess>,
    ownerTabMatches: (tabId: number, conversationId: string) => Promise<boolean>) {
    this.storage = storage;
    this.monitor = monitor;
    this.resolveAccess = resolveAccess;
    this.ownerTabMatches = ownerTabMatches;
  }

  async get(targetId: string, ownerTabId: number, conversationId: string, turnKey: string,
    assistantMessageId: string): Promise<CodexBridgeAutoWatchCandidateLookupResult> {
    if (!isCodexBridgeWatchIdentifier(targetId) || targetId.length > MAX_THREAD_ID_LENGTH
      || !Number.isSafeInteger(ownerTabId) || ownerTabId < 0 || !isConversationId(conversationId)
      || !isCodexBridgeAutoWatchIdentity(turnKey) || !isCodexBridgeAutoWatchIdentity(assistantMessageId)) {
      return { ok: false, reason: 'connection-unavailable' };
    }
    let stateValue: unknown;
    try { stateValue = (await this.storage.get([CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]))[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]; }
    catch { return { ok: false, reason: 'storage-error' }; }
    const configuredEntries = ownerEntries(stateValue, targetId, ownerTabId, conversationId);
    if (configuredEntries === undefined) return { ok: false, reason: 'storage-error' };
    if (!configuredEntries.length) return { ok: true, data: { connectionId: null, threads: [] } };

    let access: CodexBridgeMonitorAccess;
    try { access = await this.resolveAccess(); } catch (error) { return { ok: false, reason: failureFor(error) }; }
    if (!access.connectionId) return { ok: false, reason: access.failure ?? 'connection-unavailable' };
    const entry = configuredEntries.find((candidate) => candidate.connectionId === access.connectionId);
    if (!entry) return { ok: false, reason: 'connection-changed' };
    if (!await this.ownerTabMatches(ownerTabId, conversationId).catch(() => false)) {
      return { ok: false, reason: 'owner-tab-unavailable' };
    }
    if (!access.readTargets || (!access.readRunningThreads && !access.readRunningSnapshot)) {
      return { ok: false, reason: access.failure ?? 'readonly-tool-unavailable' };
    }

    let page;
    try {
      page = await readFreshRunningPage(access, this.monitor, targetId,
        { priority: 'candidate', maxAgeMs: 2_000 });
    } catch (error) { return { ok: false, reason: failureFor(error) }; }
    if (!page || page.nextCursor !== null || !Array.isArray(page.threads) || page.threads.length > MAX_RUNNING_THREADS
      || Array.from(page.threads).some((thread) => !isRecord(thread))) {
      return { ok: false, reason: 'protocol-error' };
    }

    try { stateValue = (await this.storage.get([CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]))[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]; }
    catch { return { ok: false, reason: 'storage-error' }; }
    const latestEntries = ownerEntries(stateValue, targetId, ownerTabId, conversationId);
    if (latestEntries === undefined) return { ok: false, reason: 'storage-error' };
    const latestEntry = latestEntries.find((candidate) => candidate.connectionId === entry.connectionId);
    if (!latestEntry) return { ok: true, data: { connectionId: null, threads: [] } };
    if (!await this.ownerTabMatches(ownerTabId, conversationId).catch(() => false)) {
      return { ok: false, reason: 'owner-tab-unavailable' };
    }
    let latestAccess: CodexBridgeMonitorAccess;
    try { latestAccess = await this.resolveAccess(); } catch (error) { return { ok: false, reason: failureFor(error) }; }
    if (latestAccess.connectionId !== entry.connectionId || (access.generation !== undefined
      && latestAccess.generation !== access.generation)) return { ok: false, reason: 'connection-changed' };

    const seen = new Map<string, string>();
    const threads: { threadId: string; turnId: string }[] = [];
    let totalCharacters = 0;
    for (const thread of page.threads) {
      if (!isLiveCandidate(thread, targetId) || thread.id.length > MAX_THREAD_ID_LENGTH) continue;
      const execution = linkLiveCodexBridgeExecutionTurn(thread.currentExecution, thread.lastTurn);
      if (!execution?.turnId) continue;
      const turnId = execution.turnId;
      const priorTurnId = seen.get(thread.id);
      if (priorTurnId !== undefined) {
        if (priorTurnId !== turnId) return { ok: false, reason: 'protocol-error' };
        continue;
      }
      totalCharacters += thread.id.length + turnId.length + 2;
      if (threads.length >= CODEX_BRIDGE_AUTO_WATCH_BRIDGE_CANDIDATE_IDS_LIMIT
        || totalCharacters > CODEX_BRIDGE_AUTO_WATCH_BRIDGE_CANDIDATE_CHARS_LIMIT) {
        return { ok: false, reason: 'protocol-error' };
      }
      seen.set(thread.id, turnId);
      threads.push({ threadId: thread.id, turnId });
    }
    const data: CodexBridgeAutoWatchCandidateData = { connectionId: entry.connectionId, threads };
    return { ok: true, data };
  }
}
