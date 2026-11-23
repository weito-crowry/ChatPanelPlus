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
import type { CodexBridgeTarget, CodexBridgeThread, CodexBridgeThreadPage } from '../shared/codexbridge-mcp-protocol.ts';
import { isConversationId } from '../shared/conversation-route.ts';
import type { LocalStorageLike } from './thread-monitor-storage.ts';
import { readAutoWatchState } from './thread-monitor-auto-registration-state.ts';
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

function ownerEntry(value: unknown, targetId: string, ownerTabId: number, conversationId: string) {
  const state = readAutoWatchState(value);
  return state ? state.entries.find((entry) => entry.enabled && entry.targetId === targetId
    && entry.ownerTabId === ownerTabId && entry.ownerConversationId === conversationId) ?? null : undefined;
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
    const entry = ownerEntry(stateValue, targetId, ownerTabId, conversationId);
    if (entry === undefined) return { ok: false, reason: 'storage-error' };
    if (!entry) return { ok: true, data: { connectionId: null, threadIds: [] } };

    let access: CodexBridgeMonitorAccess;
    try { access = await this.resolveAccess(); } catch (error) { return { ok: false, reason: failureFor(error) }; }
    if (!access.connectionId) return { ok: false, reason: access.failure ?? 'connection-unavailable' };
    if (access.connectionId !== entry.connectionId) return { ok: false, reason: 'connection-changed' };
    if (!await this.ownerTabMatches(ownerTabId, conversationId).catch(() => false)) {
      return { ok: false, reason: 'owner-tab-unavailable' };
    }
    if (!access.readTargets || !access.readRunningThreads) {
      return { ok: false, reason: access.failure ?? 'readonly-tool-unavailable' };
    }

    let page: CodexBridgeThreadPage;
    try {
      page = await this.monitor.scheduleTargetRequest(targetId, async () => {
        const targets: readonly CodexBridgeTarget[] = await access.readTargets!();
        if (!targets.some((candidate) => candidate.id === targetId && candidate.available !== false)) {
          throw Object.assign(new Error('target unavailable'), { code: 'target-unavailable' });
        }
        return access.readRunningThreads!(targetId);
      });
    } catch (error) { return { ok: false, reason: failureFor(error) }; }
    if (!page || page.nextCursor !== null || !Array.isArray(page.threads) || page.threads.length > MAX_RUNNING_THREADS
      || Array.from(page.threads).some((thread) => !isRecord(thread))) {
      return { ok: false, reason: 'protocol-error' };
    }

    try { stateValue = (await this.storage.get([CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]))[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]; }
    catch { return { ok: false, reason: 'storage-error' }; }
    const latestEntry = ownerEntry(stateValue, targetId, ownerTabId, conversationId);
    if (latestEntry === undefined) return { ok: false, reason: 'storage-error' };
    if (!latestEntry) return { ok: true, data: { connectionId: null, threadIds: [] } };
    if (latestEntry.connectionId !== entry.connectionId) return { ok: false, reason: 'connection-changed' };
    if (!await this.ownerTabMatches(ownerTabId, conversationId).catch(() => false)) {
      return { ok: false, reason: 'owner-tab-unavailable' };
    }
    let latestAccess: CodexBridgeMonitorAccess;
    try { latestAccess = await this.resolveAccess(); } catch (error) { return { ok: false, reason: failureFor(error) }; }
    if (latestAccess.connectionId !== entry.connectionId) return { ok: false, reason: 'connection-changed' };

    const seen = new Set<string>();
    const threadIds: string[] = [];
    let totalCharacters = 0;
    for (const thread of page.threads) {
      if (!isLiveCandidate(thread, targetId) || seen.has(thread.id) || thread.id.length > MAX_THREAD_ID_LENGTH) continue;
      totalCharacters += thread.id.length + 1;
      if (threadIds.length >= CODEX_BRIDGE_AUTO_WATCH_BRIDGE_CANDIDATE_IDS_LIMIT
        || totalCharacters > CODEX_BRIDGE_AUTO_WATCH_BRIDGE_CANDIDATE_CHARS_LIMIT) {
        return { ok: false, reason: 'protocol-error' };
      }
      seen.add(thread.id);
      threadIds.push(thread.id);
    }
    const data: CodexBridgeAutoWatchCandidateData = { connectionId: entry.connectionId, threadIds };
    return { ok: true, data };
  }
}
