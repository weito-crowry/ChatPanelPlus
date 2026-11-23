import {
  CODEX_BRIDGE_AUTO_WATCH_ALARM,
  CODEX_BRIDGE_AUTO_WATCH_MINUTES,
  CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY,
  isCodexBridgeWatchIdentifier,
  type CodexBridgeAutoWatchFailure,
  type CodexBridgeAutoWatchStatus,
  type CodexBridgeWatchOwnerMute,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeTarget, CodexBridgeThread, CodexBridgeThreadStatus } from '../shared/codexbridge-mcp-protocol.ts';
import { isConversationId } from '../shared/conversation-route.ts';
import type { LocalStorageLike } from './thread-monitor-storage.ts';
import type { CodexBridgeMonitorAccess, CodexBridgeThreadMonitor } from './thread-monitor.ts';

type AlarmLike = Readonly<{
  get(name: string): Promise<unknown>;
  create(name: string, alarmInfo: { delayInMinutes: number; periodInMinutes: number }): void;
  clear(name: string): Promise<boolean>;
}>;
type MonitorLike = Pick<CodexBridgeThreadMonitor, 'list' | 'read' | 'startWatch' | 'stopWatch' | 'updateOwnerMute'
  | 'scheduleTargetRequest' | 'refreshForeground'>;
type OwnerMuteResult = { readonly ok: true; readonly muted: boolean; readonly revision: number } | { readonly ok: false };
type SkippedExecution = Readonly<{ threadId: string; turnId: string | null }>;
type AutoEntry = Readonly<{
  connectionId: string;
  targetId: string;
  enabled: boolean;
  ownerTabId: number;
  ownerConversationId: string;
  ownerMuted: boolean | null;
  ownerMuteRevision: number;
  failure: CodexBridgeAutoWatchFailure | null;
  liveThreadCount: number | null;
  lastScannedAt: string | null;
  nextScanAt: number;
  failureCount: number;
  skippedExecutions: readonly SkippedExecution[];
}>;
type AutoState = Readonly<{ version: 1; entries: readonly AutoEntry[] }>;
type Cadence = 'foreground' | 'background';
type Result = Readonly<{ ok: true; status: CodexBridgeAutoWatchStatus }>
  | Readonly<{ ok: false; reason: CodexBridgeAutoWatchFailure | 'connection-unavailable' | 'auto-owner-conflict' }>;
type AutoOptions = Readonly<{ now?: () => number }>;

const MAX_ENTRIES = 100;
const MAX_SKIPS_PER_ENTRY = 256;
const MAX_FAILURES = 8;
const MAX_BACKOFF_MS = 5 * 60_000;
const MAX_SCANS_PER_CYCLE = 12;
const FAILURE_REASONS: readonly CodexBridgeAutoWatchFailure[] = [
  'ok', '401', '403', 'timeout', 'disconnected', 'unknown', 'permission-required', 'settings-unavailable',
  'endpoint-not-found', 'session-expired', 'http-error', 'protocol-error', 'protocol-version-unsupported',
  'readonly-tool-unavailable', 'readonly-probe-failed', 'running-only-unsupported', 'connection-changed',
  'target-unavailable', 'owner-conflict', 'ownerless-watch', 'watch-limit', 'owner-tab-unavailable', 'storage-error',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validFailure(value: unknown): value is CodexBridgeAutoWatchFailure | null {
  return value === null || (typeof value === 'string' && FAILURE_REASONS.includes(value as CodexBridgeAutoWatchFailure));
}

function readEntry(value: unknown): AutoEntry | null {
  if (!isRecord(value) || Object.keys(value).length !== 13 || !isCodexBridgeWatchIdentifier(value.connectionId)
    || value.connectionId.length > 96 || !isCodexBridgeWatchIdentifier(value.targetId)
    || typeof value.enabled !== 'boolean' || !Number.isSafeInteger(value.ownerTabId) || (value.ownerTabId as number) < 0
    || !isConversationId(value.ownerConversationId)
    || (typeof value.ownerMuted !== 'boolean' && value.ownerMuted !== null)
    || !Number.isSafeInteger(value.ownerMuteRevision) || (value.ownerMuteRevision as number) < 0
    || !validFailure(value.failure) || (value.liveThreadCount !== null
      && (!Number.isSafeInteger(value.liveThreadCount) || (value.liveThreadCount as number) < 0 || (value.liveThreadCount as number) > 1000))
    || (value.lastScannedAt !== null && (typeof value.lastScannedAt !== 'string' || value.lastScannedAt.length > 40))
    || !Number.isSafeInteger(value.nextScanAt) || (value.nextScanAt as number) < 0
    || !Number.isSafeInteger(value.failureCount) || (value.failureCount as number) < 0 || (value.failureCount as number) > MAX_FAILURES
    || !Array.isArray(value.skippedExecutions) || value.skippedExecutions.length > MAX_SKIPS_PER_ENTRY) return null;
  const skips: SkippedExecution[] = [];
  for (const candidate of value.skippedExecutions) {
    if (!isRecord(candidate) || Object.keys(candidate).length !== 2 || !isCodexBridgeWatchIdentifier(candidate.threadId)
      || (candidate.turnId !== null && !isCodexBridgeWatchIdentifier(candidate.turnId))) return null;
    skips.push({ threadId: candidate.threadId, turnId: candidate.turnId as string | null });
  }
  if (new Set(skips.map(({ threadId }) => threadId)).size !== skips.length) return null;
  return { ...value, skippedExecutions: skips } as unknown as AutoEntry;
}

function readState(value: unknown): AutoState | null {
  if (value === undefined) return { version: 1, entries: [] };
  if (!isRecord(value) || Object.keys(value).length !== 2 || value.version !== 1
    || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) return null;
  const entries = value.entries.map(readEntry);
  if (entries.some((entry) => entry === null)) return null;
  const validated = entries as AutoEntry[];
  const identities = new Set<string>();
  const owners = new Set<string>();
  for (const entry of validated) {
    const key = `${entry.connectionId}\u0000${entry.targetId}`;
    if (identities.has(key)) return null;
    identities.add(key);
    if (entry.enabled && owners.has(key)) return null;
    if (entry.enabled) owners.add(key);
  }
  return { version: 1, entries: validated };
}

function errorCode(error: unknown): string | null {
  return isRecord(error) && typeof error.code === 'string' ? error.code : null;
}

function failureFor(error: unknown): CodexBridgeAutoWatchFailure {
  const code = errorCode(error);
  return code && FAILURE_REASONS.includes(code as CodexBridgeAutoWatchFailure)
    ? code as CodexBridgeAutoWatchFailure : 'unknown';
}

function isLiveCandidate(thread: CodexBridgeThread, targetId: string): boolean {
  const execution = thread.currentExecution;
  return thread.targetId === targetId && isCodexBridgeWatchIdentifier(thread.id) && execution !== null
    && (execution.state === 'in_progress' || execution.state === 'running') && execution.evidence === 'live'
    && (execution.turnId === null || isCodexBridgeWatchIdentifier(execution.turnId));
}

function statusFromThread(thread: CodexBridgeThread): CodexBridgeThreadStatus {
  const execution = thread.currentExecution!;
  const lastTurn = execution.turnId !== null && thread.lastTurn?.turnId === execution.turnId ? thread.lastTurn : {
    turnId: execution.turnId, status: 'in_progress' as const, category: null, evidence: execution.evidence,
    reason: execution.reason, observedAt: execution.observedAt, needsAttention: execution.needsAttention,
  };
  return {
    targetId: thread.targetId,
    threadId: thread.id,
    state: thread.currentExecution?.state ?? null,
    currentExecution: thread.currentExecution,
    lastTurn,
    needsAttention: thread.needsAttention,
  };
}

export class CodexBridgeAutoThreadRegistration {
  private readonly storage: LocalStorageLike;
  private readonly alarms: AlarmLike;
  private readonly monitor: MonitorLike;
  private readonly resolveAccess: () => Promise<CodexBridgeMonitorAccess>;
  private readonly loadOwnerMute: (tabId: number, conversationId: string) => Promise<OwnerMuteResult>;
  private readonly ownerTabMatches: (tabId: number, conversationId: string) => Promise<boolean>;
  private readonly now: () => number;
  private storageTail: Promise<void> = Promise.resolve();
  private alarmTail: Promise<void> = Promise.resolve();
  private readonly targetTails = new Map<string, Promise<void>>();
  private readonly scanFlights = new Map<string, Promise<void>>();

  constructor(
    storage: LocalStorageLike,
    alarms: AlarmLike,
    monitor: MonitorLike,
    resolveAccess: () => Promise<CodexBridgeMonitorAccess>,
    loadOwnerMute: (tabId: number, conversationId: string) => Promise<OwnerMuteResult>,
    ownerTabMatches: (tabId: number, conversationId: string) => Promise<boolean>,
    options: AutoOptions = {},
  ) {
    this.storage = storage; this.alarms = alarms; this.monitor = monitor; this.resolveAccess = resolveAccess;
    this.loadOwnerMute = loadOwnerMute; this.ownerTabMatches = ownerTabMatches; this.now = options.now ?? Date.now;
  }

  async getStatus(targetId: string, conversationId: string): Promise<CodexBridgeAutoWatchStatus> {
    let access: CodexBridgeMonitorAccess | null = null;
    try { access = await this.resolveAccess(); } catch { /* Exposed as a failed state below. */ }
    const connectionId = access?.connectionId ?? null;
    const state = await this.readState();
    if (!state) return this.emptyStatus(targetId, connectionId, conversationId, 'error', 'storage-error');
    const matching = connectionId ? state.entries.find((item) => item.connectionId === connectionId && item.targetId === targetId) : null;
    const conflict = connectionId ? state.entries.find((item) => item.connectionId === connectionId && item.targetId === targetId
      && item.enabled && item.ownerConversationId !== conversationId) : null;
    const ownedActive = state.entries.filter((item) => item.targetId === targetId && item.enabled
      && item.ownerConversationId === conversationId).sort((left, right) => Number(right.connectionId === connectionId)
      - Number(left.connectionId === connectionId));
    const selected = ownedActive[0] ?? (matching?.ownerConversationId === conversationId ? matching : null);
    if (!selected && conflict) return this.emptyStatus(targetId, connectionId, conversationId, 'conflict', 'owner-conflict');
    if (!selected) return this.emptyStatus(targetId, connectionId, conversationId,
      connectionId ? 'off' : 'error', connectionId ? null : access?.failure ?? 'connection-unavailable');
    const items = await this.monitor.list();
    const staleConnection = selected.connectionId !== connectionId;
    const failure = conflict ? 'owner-conflict' : staleConnection
      ? access?.failure ?? (connectionId ? 'connection-changed' : 'connection-unavailable') : selected.failure;
    return {
      targetId, connectionId: selected.connectionId, enabled: selected.enabled, ownerConversationId: selected.ownerConversationId,
      state: failure ? 'error' : selected.enabled ? 'ready' : 'off', failure,
      liveThreadCount: selected.liveThreadCount,
      watchingThreadCount: items.filter((item) => item.connectionId === selected.connectionId && item.targetId === targetId
        && item.ownerConversationId === conversationId).length,
      lastScannedAt: selected.lastScannedAt, nextScanAt: selected.enabled ? selected.nextScanAt : null,
    };
  }

  async setEnabled(targetId: string, ownerTabId: number, conversationId: string, enabled: boolean): Promise<Result> {
    if (!isCodexBridgeWatchIdentifier(targetId) || !Number.isSafeInteger(ownerTabId) || ownerTabId < 0) {
      return { ok: false, reason: 'connection-unavailable' };
    }
    let access: CodexBridgeMonitorAccess | null = null;
    if (enabled) {
      try { access = await this.resolveAccess(); } catch (error) { return { ok: false, reason: failureFor(error) }; }
      if (!access.connectionId) return { ok: false, reason: access.failure ?? 'connection-unavailable' };
      const configured = await this.readState();
      if (!configured) return { ok: false, reason: 'storage-error' };
      if (configured.entries.some((item) => item.connectionId === access!.connectionId && item.targetId === targetId
        && item.enabled && item.ownerConversationId !== conversationId)) return { ok: false, reason: 'auto-owner-conflict' };
      if (!access.readTargets) return { ok: false, reason: access.failure ?? 'readonly-tool-unavailable' };
      try {
        const targets = await this.monitor.scheduleTargetRequest(targetId, () => access!.readTargets!());
        if (!targets.some((target) => target.id === targetId && target.available !== false)) {
          return { ok: false, reason: 'target-unavailable' };
        }
      } catch (error) { return { ok: false, reason: failureFor(error) }; }
    }
    const connectionId = access?.connectionId ?? null;
    if (!enabled) {
      const before = await this.readState();
      if (!before) return { ok: false, reason: 'storage-error' };
      const owners = before.entries.filter((entry) => entry.targetId === targetId
        && entry.ownerConversationId === conversationId && entry.enabled);
      for (const entry of owners) await this.withTarget(this.key(entry.connectionId, targetId), async () => {
        await this.mutate((state) => ({ ...state, entries: state.entries.map((item) => item.connectionId === entry.connectionId
          && item.targetId === targetId && item.ownerConversationId === conversationId ? { ...item, enabled: false,
            failure: null, nextScanAt: 0 } : item) }));
      });
      await this.syncAlarm();
      return { ok: true, status: await this.getStatus(targetId, conversationId) };
    }
    if (!connectionId) return { ok: false, reason: 'connection-unavailable' };
    const key = this.key(connectionId, targetId);
    const ownerMute = await this.readOwnerMute(ownerTabId, conversationId);
    const stored = await this.mutate((current) => {
      const competing = current.entries.find((item) => item.connectionId === connectionId && item.targetId === targetId
        && item.enabled && item.ownerConversationId !== conversationId);
      if (competing) return { state: current, value: 'conflict' as const };
      const existing = current.entries.find((item) => item.connectionId === connectionId && item.targetId === targetId);
      if (!existing && current.entries.length >= MAX_ENTRIES) return { state: current, value: 'storage-error' as const };
      const entry: AutoEntry = {
        connectionId, targetId, enabled: true, ownerTabId, ownerConversationId: conversationId,
        ownerMuted: ownerMute.muted, ownerMuteRevision: ownerMute.revision, failure: null, liveThreadCount: null,
        lastScannedAt: null, nextScanAt: this.now(), failureCount: 0,
        skippedExecutions: existing?.ownerConversationId === conversationId ? existing.skippedExecutions : [],
      };
      return { state: { version: 1 as const, entries: [...current.entries.filter((item) => item !== existing), entry] }, value: 'saved' as const };
    });
    if (!stored) return { ok: false, reason: 'storage-error' };
    if (stored === 'conflict') return { ok: false, reason: 'auto-owner-conflict' };
    if (stored === 'storage-error') return { ok: false, reason: 'storage-error' };
    await this.syncAlarm();
    void this.monitor.refreshForeground().catch(() => {});
    await this.scanEntry(key, 'foreground');
    return { ok: true, status: await this.getStatus(targetId, conversationId) };
  }

  async scanForeground(conversationId: string): Promise<void> {
    const state = await this.readState();
    if (!state) return;
    await this.scanEntries(state.entries.filter((entry) => entry.enabled && entry.ownerConversationId === conversationId), 'foreground');
  }

  async scanBackground(): Promise<void> {
    const state = await this.readState();
    if (!state) return;
    await this.scanEntries(state.entries.filter((entry) => entry.enabled), 'background');
  }

  async restore(): Promise<void> {
    await this.syncAlarm();
    await this.scanBackground();
  }

  async stopWatch(connectionId: string, targetId: string, threadId: string, ownerConversationId: string): Promise<boolean> {
    return this.withTarget(this.key(connectionId, targetId), async () => {
      const entry = await this.findEntry(connectionId, targetId);
      const item = await this.monitor.read(connectionId, targetId, threadId);
      if (entry?.enabled && entry.ownerConversationId === ownerConversationId
        && item?.ownerConversationId === ownerConversationId) {
        const turnId = item.currentExecutionTurnId;
        await this.mutate((state) => ({ ...state, entries: state.entries.map((candidate) => candidate.connectionId === connectionId
          && candidate.targetId === targetId && candidate.ownerConversationId === ownerConversationId
          ? { ...candidate, skippedExecutions: [...candidate.skippedExecutions.filter((skip) => skip.threadId !== threadId),
            { threadId, turnId }].slice(-MAX_SKIPS_PER_ENTRY) } : candidate) }));
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

  private async scanEntries(entries: readonly AutoEntry[], cadence: Cadence): Promise<void> {
    const due = entries.filter((entry) => entry.enabled && entry.nextScanAt <= this.now())
      .sort((left, right) => left.nextScanAt - right.nextScanAt).slice(0, MAX_SCANS_PER_CYCLE);
    await Promise.all(due.map((entry) => this.scanEntry(this.key(entry.connectionId, entry.targetId), cadence)));
  }

  private scanEntry(key: string, cadence: Cadence): Promise<void> {
    const existing = this.scanFlights.get(key);
    if (existing) return existing;
    const task = this.withTarget(key, () => this.scanEntryOnce(key, cadence));
    this.scanFlights.set(key, task);
    const clear = () => { if (this.scanFlights.get(key) === task) this.scanFlights.delete(key); };
    void task.then(clear, clear);
    return task;
  }

  private async scanEntryOnce(key: string, cadence: Cadence): Promise<void> {
    const entry = await this.findByKey(key);
    if (!entry?.enabled || entry.nextScanAt > this.now()) return;
    try {
      const currentOwnerTab = await this.ownerTabMatches(entry.ownerTabId, entry.ownerConversationId).catch(() => false);
      const mute = currentOwnerTab ? await this.readOwnerMute(entry.ownerTabId, entry.ownerConversationId) : { muted: null, revision: entry.ownerMuteRevision };
      if (mute.muted !== entry.ownerMuted || mute.revision !== entry.ownerMuteRevision) {
        await this.updateOwnerMute(entry.ownerTabId, entry.ownerConversationId, mute.muted, mute.revision);
      }
      const access = await this.resolveAccess();
      if (access.connectionId !== entry.connectionId) throw Object.assign(new Error('connection changed'), { code: 'connection-changed' });
      if (!access.readTargets || !access.readRunningThreads) throw Object.assign(new Error('running_only unavailable'), {
        code: access.failure ?? 'readonly-tool-unavailable',
      });
      const page = await this.monitor.scheduleTargetRequest(entry.targetId, async () => {
        const targets: readonly CodexBridgeTarget[] = await access.readTargets!();
        if (!targets.some((target) => target.id === entry.targetId && target.available !== false)) {
          throw Object.assign(new Error('target unavailable'), { code: 'target-unavailable' });
        }
        return access.readRunningThreads!(entry.targetId);
      });
      if (!page || page.nextCursor !== null || !Array.isArray(page.threads) || page.threads.length > 1000) {
        throw Object.assign(new Error('invalid running_only response'), { code: 'protocol-error' });
      }
      await this.registerCandidates(entry, page.threads.filter((thread) => isLiveCandidate(thread, entry.targetId)), cadence);
    } catch (error) {
      await this.recordFailure(entry, failureFor(error), cadence);
    }
  }

  private async registerCandidates(entry: AutoEntry, candidates: readonly CodexBridgeThread[], cadence: Cadence): Promise<void> {
    const latest = await this.findByKey(this.key(entry.connectionId, entry.targetId));
    if (!latest?.enabled || latest.ownerConversationId !== entry.ownerConversationId) return;
    const liveByThread = new Map(candidates.map((thread) => [thread.id, thread.currentExecution!.turnId]));
    const skips = latest.skippedExecutions.filter((skip) => {
      const currentTurn = liveByThread.get(skip.threadId);
      return currentTurn !== undefined && (skip.turnId === null || skip.turnId === currentTurn);
    });
    if (skips.length !== latest.skippedExecutions.length) {
      await this.mutate((state) => ({ ...state, entries: state.entries.map((item) => item.connectionId === latest.connectionId
        && item.targetId === latest.targetId ? { ...item, skippedExecutions: skips } : item) }));
    }
    const owner: CodexBridgeWatchOwnerMute = {
      ownerTabId: latest.ownerTabId, ownerConversationId: latest.ownerConversationId,
      ownerMuted: latest.ownerMuted, ownerMuteRevision: latest.ownerMuteRevision,
    };
    let failure: CodexBridgeAutoWatchFailure | null = null;
    for (const thread of candidates) {
      if (skips.some((skip) => skip.threadId === thread.id
        && (skip.turnId === null || skip.turnId === thread.currentExecution!.turnId))) continue;
      const current = await this.monitor.read(latest.connectionId, latest.targetId, thread.id);
      if (current) {
        if (current.ownerConversationId && current.ownerConversationId !== latest.ownerConversationId) failure = 'owner-conflict';
        else if (!current.ownerConversationId) failure = 'ownerless-watch';
        continue;
      }
      const status = statusFromThread(thread);
      const result = await this.monitor.startWatch(latest.targetId, thread.id, owner, {
        allowOwnerTransfer: false, expectedConnectionId: latest.connectionId, initialStatus: status,
      });
      if (!result.ok) {
        if (result.reason === 'watch-limit') { failure = 'watch-limit'; break; }
        if (result.reason === 'owner-unavailable') failure = 'ownerless-watch';
        else if (result.reason === 'owner-conflict') failure = 'owner-conflict';
        else if (result.reason === 'connection-changed') { failure = 'connection-changed'; break; }
      }
    }
    const now = this.now();
    await this.mutate((state) => ({ ...state, entries: state.entries.map((item) => item.connectionId === latest.connectionId
      && item.targetId === latest.targetId && item.ownerConversationId === latest.ownerConversationId ? {
        ...item, failure, liveThreadCount: candidates.length, lastScannedAt: new Date(now).toISOString(),
        nextScanAt: now + (cadence === 'foreground' ? 5_000 : 30_000), failureCount: 0,
      } : item) }));
  }

  private async recordFailure(entry: AutoEntry, failure: CodexBridgeAutoWatchFailure, cadence: Cadence): Promise<void> {
    const now = this.now();
    const count = Math.min(MAX_FAILURES, entry.failureCount + 1);
    const backoff = Math.min(MAX_BACKOFF_MS, 30_000 * (2 ** Math.min(count - 1, 4)));
    await this.mutate((state) => ({ ...state, entries: state.entries.map((item) => item.connectionId === entry.connectionId
      && item.targetId === entry.targetId && item.ownerConversationId === entry.ownerConversationId ? {
        ...item, failure, liveThreadCount: null, nextScanAt: now + Math.max(backoff, cadence === 'foreground' ? 5_000 : 30_000),
        failureCount: count,
      } : item) }));
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
      state, failure, liveThreadCount: null, watchingThreadCount: 0, lastScannedAt: null, nextScanAt: null };
  }

  private key(connectionId: string, targetId: string): string { return `${connectionId}\u0000${targetId}`; }
  private findByKey(key: string): Promise<AutoEntry | null> {
    return this.readState().then((state) => state?.entries.find((entry) => this.key(entry.connectionId, entry.targetId) === key) ?? null);
  }
  private findEntry(connectionId: string, targetId: string): Promise<AutoEntry | null> { return this.findByKey(this.key(connectionId, targetId)); }

  private readState(): Promise<AutoState | null> {
    return this.withStorage(async () => {
      try { return readState((await this.storage.get([CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]))[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]); }
      catch { return null; }
    });
  }

  private mutate<T>(operation: (state: AutoState) => AutoState | { state: AutoState; value: T }): Promise<T | null> {
    return this.withStorage(async () => {
      try {
        const state = readState((await this.storage.get([CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]))[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]);
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

  private syncAlarm(): Promise<void> {
    const operation = this.alarmTail.then(async () => {
      const state = await this.readState();
      if (!state) return;
      if (state.entries.some((entry) => entry.enabled)) {
        if (!await this.alarms.get(CODEX_BRIDGE_AUTO_WATCH_ALARM)) this.alarms.create(CODEX_BRIDGE_AUTO_WATCH_ALARM, {
          delayInMinutes: CODEX_BRIDGE_AUTO_WATCH_MINUTES, periodInMinutes: CODEX_BRIDGE_AUTO_WATCH_MINUTES,
        });
      } else await this.alarms.clear(CODEX_BRIDGE_AUTO_WATCH_ALARM);
    });
    this.alarmTail = operation.catch(() => undefined);
    return operation;
  }
}
