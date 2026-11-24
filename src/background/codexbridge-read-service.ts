import {
  CODEX_BRIDGE_MCP_DEFAULT_URL,
  CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY,
  parseCodexBridgeMcpEndpoint,
  type CodexBridgeReadFailureReason,
  type CodexBridgeTarget,
  type CodexBridgeThreadPage,
  type CodexBridgeThreadStatus,
} from '../shared/codexbridge-mcp-protocol.ts';
import { createCodexBridgeConnectionId, type CodexBridgeFinalAnswerResult } from '../shared/codexbridge-thread-monitor-protocol.ts';
import { createChromeSettingsRepository, type SettingsRepository } from '../shared/settings-repository.ts';
import { CodexBridgeMcpClient } from './mcp-client.ts';
import { McpTransportError } from './mcp-transport.ts';

type SessionStorageLike = Readonly<{ get(keys: string[]): Promise<Record<string, unknown>> }>;
type PermissionApiLike = Readonly<{ contains(permissions: { origins: string[] }): Promise<boolean> }>;
export type CodexBridgeReadPriority = 'urgent' | 'manual' | 'foreground' | 'candidate' | 'background';
export type CodexBridgeReadOptions = Readonly<{ priority?: CodexBridgeReadPriority; force?: boolean; maxAgeMs?: number }>;
type Priority = CodexBridgeReadPriority;
type ReadOptions = CodexBridgeReadOptions;
type ClientOptions = Readonly<{ fetchImpl?: typeof fetch; timeoutMs: number }>;

export type CodexBridgeReadClient = Readonly<{
  readTargets(): Promise<readonly CodexBridgeTarget[]>;
  readThreads(targetId: string, cursor?: string, runningOnly?: boolean): Promise<CodexBridgeThreadPage>;
  readStatus(targetId: string, threadId: string): Promise<CodexBridgeThreadStatus>;
  readFinalAnswer(targetId: string, threadId: string, turnId: string): Promise<CodexBridgeFinalAnswerResult>;
}>;

export type CodexBridgeRunningSnapshot = Readonly<{
  ok: true;
  connectionId: string;
  generation: number;
  page: CodexBridgeThreadPage;
  freshness: 'fresh' | 'stale';
  observedAt: string;
  ageMs: number;
  failureReason: CodexBridgeReadFailureReason | null;
}> | Readonly<{
  ok: false;
  connectionId: string | null;
  generation: number | null;
  freshness: 'error';
  observedAt: string | null;
  ageMs: null;
  reason: CodexBridgeReadFailureReason;
}>;

export type CodexBridgeReadAccess = Readonly<{
  connectionId: string | null;
  generation?: number;
  readTargets?: (priority?: Priority) => Promise<readonly CodexBridgeTarget[]>;
  readRunningThreads?: (targetId: string) => Promise<CodexBridgeThreadPage>;
  readRunningSnapshot?: (targetId: string, options?: ReadOptions) => Promise<CodexBridgeRunningSnapshot>;
  readStatus?: (targetId: string, threadId: string, priority?: Priority) => Promise<CodexBridgeThreadStatus>;
  readFinalAnswer?: (targetId: string, threadId: string, turnId: string, priority?: Priority) => Promise<CodexBridgeFinalAnswerResult>;
  readsScheduled?: boolean;
  isCurrent?: () => boolean;
  failure?: CodexBridgeReadFailureReason;
}>;

export type CodexBridgeReadServiceOptions = Readonly<{
  sessionStorage: SessionStorageLike;
  permissions: PermissionApiLike;
  settings: Pick<SettingsRepository, 'loadSettings'>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  maxConcurrentReads?: number;
  maxQueuedReads?: number;
  connectionIdFactory?: (endpoint: string) => Promise<string | null>;
  clientFactory?: (endpoint: string, token: string, options: ClientOptions) => CodexBridgeReadClient;
}>;

type Context = Readonly<{
  endpoint: string;
  originPattern: string;
  token: string;
  connectionId: string;
  generation: number;
  client: CodexBridgeReadClient;
}>;
type SnapshotEntry = {
  page: CodexBridgeThreadPage | null;
  observedAtMs: number | null;
  failureReason: CodexBridgeReadFailureReason | null;
  failureCount: number;
  retryAtMs: number;
  flight: Promise<CodexBridgeRunningSnapshot> | null;
};
type QueuedRead = {
  key: string;
  generation: number;
  targetId: string;
  priority: Priority;
  sequence: number;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  promise: Promise<unknown>;
  started: boolean;
};

const FOREGROUND_TTL_MS = 5_000;
const BACKGROUND_TTL_MS = 30_000;
const CANDIDATE_TTL_MS = 2_000;
const INITIAL_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const MAX_ACTIVE_READS = 3;
const MAX_QUEUED_READS = 48;
const PRIORITY: Readonly<Record<Priority, number>> = {
  urgent: 0, manual: 1, foreground: 2, candidate: 3, background: 4,
};

function readFailure(error: unknown): CodexBridgeReadFailureReason {
  return error instanceof McpTransportError ? error.code : 'unknown-error';
}

function codedError(reason: CodexBridgeReadFailureReason): McpTransportError {
  return new McpTransportError(reason);
}

function emptySnapshot(reason: CodexBridgeReadFailureReason, connectionId: string | null = null,
  generation: number | null = null): CodexBridgeRunningSnapshot {
  return { ok: false, connectionId, generation, freshness: 'error', observedAt: null, ageMs: null, reason };
}

export class CodexBridgeReadService {
  private readonly sessionStorage: SessionStorageLike;
  private readonly permissions: PermissionApiLike;
  private readonly settings: Pick<SettingsRepository, 'loadSettings'>;
  private readonly fetchImpl?: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly maxConcurrentReads: number;
  private readonly maxQueuedReads: number;
  private readonly connectionIdFactory: (endpoint: string) => Promise<string | null>;
  private readonly clientFactory: (endpoint: string, token: string, options: ClientOptions) => CodexBridgeReadClient;
  private context: Context | null = null;
  private generation = 0;
  private accessFlight: Readonly<{ generation: number; promise: Promise<Context> }> | null = null;
  private readonly snapshots = new Map<string, SnapshotEntry>();
  private readonly queue: QueuedRead[] = [];
  private readonly reads = new Map<string, QueuedRead>();
  private activeReads = 0;
  private sequence = 0;

  constructor(options: CodexBridgeReadServiceOptions) {
    this.sessionStorage = options.sessionStorage;
    this.permissions = options.permissions;
    this.settings = options.settings;
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? 4_000;
    this.now = options.now ?? Date.now;
    this.maxConcurrentReads = options.maxConcurrentReads ?? MAX_ACTIVE_READS;
    this.maxQueuedReads = options.maxQueuedReads ?? MAX_QUEUED_READS;
    this.connectionIdFactory = options.connectionIdFactory ?? createCodexBridgeConnectionId;
    this.clientFactory = options.clientFactory ?? ((endpoint, token, clientOptions) => new CodexBridgeMcpClient(endpoint, token, clientOptions));
  }

  invalidate(): void {
    this.generation += 1;
    this.context = null;
    this.snapshots.clear();
    const stale = this.queue.splice(0);
    for (const job of stale) {
      if (this.reads.get(job.key) === job) this.reads.delete(job.key);
      job.reject(new McpTransportError('connection-changed'));
    }
  }

  invalidatePermissionRemoval(origins: readonly string[]): void {
    if (this.context && origins.includes(this.context.originPattern)) this.invalidate();
  }

  async readTargets(priority: Priority = 'foreground'): Promise<readonly CodexBridgeTarget[]> {
    const context = await this.requireContext();
    return this.schedule(context, '*', priority, 'targets', () => context.client.readTargets());
  }

  async readThreads(targetId: string, cursor?: string, priority: Priority = 'foreground'): Promise<CodexBridgeThreadPage> {
    const context = await this.requireContext();
    const key = `threads:${targetId}:${cursor ?? ''}`;
    return this.schedule(context, targetId, priority, key, () => context.client.readThreads(targetId, cursor, false));
  }

  async readStatus(targetId: string, threadId: string, priority: Priority = 'background'): Promise<CodexBridgeThreadStatus> {
    const context = await this.requireContext();
    return this.schedule(context, targetId, priority, `status:${targetId}:${threadId}`,
      () => context.client.readStatus(targetId, threadId));
  }

  async readFinalAnswer(targetId: string, threadId: string, turnId: string,
    priority: Priority = 'background'): Promise<CodexBridgeFinalAnswerResult> {
    const context = await this.requireContext();
    return this.schedule(context, targetId, priority, `final:${targetId}:${threadId}:${turnId}`,
      () => context.client.readFinalAnswer(targetId, threadId, turnId));
  }

  async readRunningSnapshot(targetId: string, options: ReadOptions = {}): Promise<CodexBridgeRunningSnapshot> {
    let context: Context;
    try { context = await this.requireContext(); }
    catch (error) { return emptySnapshot(readFailure(error)); }
    return this.readRunningSnapshotFor(context, targetId, options);
  }

  async resolveAccess(): Promise<CodexBridgeReadAccess> {
    try {
      const context = await this.requireContext();
      return {
        connectionId: context.connectionId,
        generation: context.generation,
        readsScheduled: true,
        isCurrent: () => this.isCurrent(context),
        readTargets: (priority = 'candidate') => this.readTargetsFor(context, priority),
        readRunningThreads: (targetId) => this.readRunningThreadsFor(context, targetId),
        readRunningSnapshot: (targetId, options) => this.readRunningSnapshotFor(context, targetId, options ?? {}),
        readStatus: (targetId, threadId, priority = 'background') => this.readStatusFor(context, targetId, threadId, priority),
        readFinalAnswer: (targetId, threadId, turnId, priority = 'manual') =>
          this.readFinalAnswerFor(context, targetId, threadId, turnId, priority),
      };
    } catch (error) { return { connectionId: null, failure: readFailure(error) }; }
  }

  private async readRunningSnapshotFor(context: Context, targetId: string, options: ReadOptions): Promise<CodexBridgeRunningSnapshot> {
    if (!this.isCurrent(context)) return emptySnapshot('connection-changed', context.connectionId, context.generation);
    const priority = options.priority ?? 'foreground';
    const maxAgeMs = options.maxAgeMs ?? (priority === 'candidate' ? CANDIDATE_TTL_MS
      : priority === 'background' ? BACKGROUND_TTL_MS : FOREGROUND_TTL_MS);
    const key = `${context.generation}\u0000${targetId}`;
    let entry = this.snapshots.get(key);
    if (entry?.page && !entry.failureReason && !options.force && this.now() - (entry.observedAtMs ?? 0) <= maxAgeMs) {
      return this.snapshotResult(context, entry, maxAgeMs);
    }
    if (entry?.flight) {
      void this.schedule(context, targetId, priority, `running:${targetId}`,
        () => context.client.readThreads(targetId, undefined, true)).catch(() => {});
      return entry.flight;
    }
    if (entry && !options.force && entry.retryAtMs > this.now()) {
      return entry.page ? this.snapshotResult(context, entry, maxAgeMs) : emptySnapshot(entry.failureReason ?? 'timeout', context.connectionId, context.generation);
    }
    if (!entry) {
      entry = { page: null, observedAtMs: null, failureReason: null, failureCount: 0, retryAtMs: 0, flight: null };
      this.snapshots.set(key, entry);
    }
    const current = entry;
    const flight = this.schedule(context, targetId, priority, `running:${targetId}`,
      () => context.client.readThreads(targetId, undefined, true)).then((page) => {
      this.assertCurrent(context);
      if (page.nextCursor !== null || !Array.isArray(page.threads)) throw new McpTransportError('protocol-error');
      current.page = page;
      current.observedAtMs = this.now();
      current.failureReason = null;
      current.failureCount = 0;
      current.retryAtMs = 0;
      return this.snapshotResult(context, current, maxAgeMs);
    }).catch((error: unknown) => {
      if (!this.isCurrent(context)) return emptySnapshot('connection-changed', context.connectionId, context.generation);
      const reason = readFailure(error);
      current.failureReason = reason;
      current.failureCount = Math.min(8, current.failureCount + 1);
      const backoff = reason === 'running-only-unsupported' ? MAX_BACKOFF_MS
        : Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * (2 ** (current.failureCount - 1)));
      current.retryAtMs = this.now() + backoff;
      return current.page ? this.snapshotResult(context, current, maxAgeMs)
        : emptySnapshot(reason, context.connectionId, context.generation);
    }).finally(() => {
      if (current.flight === flight) current.flight = null;
    });
    current.flight = flight;
    return flight;
  }

  private readTargetsFor(context: Context, priority: Priority): Promise<readonly CodexBridgeTarget[]> {
    return this.schedule(context, '*', priority, 'targets', () => context.client.readTargets());
  }

  private readRunningThreadsFor(context: Context, targetId: string): Promise<CodexBridgeThreadPage> {
    return this.readRunningSnapshotFor(context, targetId, { priority: 'candidate', maxAgeMs: CANDIDATE_TTL_MS })
      .then((snapshot) => {
        if (!snapshot.ok) throw codedError(snapshot.reason);
        if (snapshot.freshness !== 'fresh') throw codedError(snapshot.failureReason ?? 'timeout');
        return snapshot.page;
      });
  }

  private readStatusFor(context: Context, targetId: string, threadId: string, priority: Priority): Promise<CodexBridgeThreadStatus> {
    return this.schedule(context, targetId, priority, `status:${targetId}:${threadId}`,
      () => context.client.readStatus(targetId, threadId));
  }

  private readFinalAnswerFor(context: Context, targetId: string, threadId: string, turnId: string,
    priority: Priority): Promise<CodexBridgeFinalAnswerResult> {
    return this.schedule(context, targetId, priority, `final:${targetId}:${threadId}:${turnId}`,
      () => context.client.readFinalAnswer(targetId, threadId, turnId));
  }

  private snapshotResult(context: Context, entry: SnapshotEntry, maxAgeMs: number): CodexBridgeRunningSnapshot {
    if (!entry.page || entry.observedAtMs === null) return emptySnapshot(entry.failureReason ?? 'unknown-error', context.connectionId, context.generation);
    const ageMs = Math.max(0, this.now() - entry.observedAtMs);
    return {
      ok: true, connectionId: context.connectionId, generation: context.generation, page: entry.page,
      freshness: entry.failureReason || ageMs > maxAgeMs ? 'stale' : 'fresh',
      observedAt: new Date(entry.observedAtMs).toISOString(), ageMs, failureReason: entry.failureReason,
    };
  }

  private schedule<T>(context: Context, targetId: string, priority: Priority, operationKey: string,
    operation: () => Promise<T>): Promise<T> {
    try { this.assertCurrent(context); } catch (error) { return Promise.reject(error); }
    const key = `${context.generation}\u0000${targetId}\u0000${operationKey}`;
    const current = this.reads.get(key);
    if (current) {
      if (!current.started && PRIORITY[priority] < PRIORITY[current.priority]) {
        current.priority = priority;
        this.sortQueue();
      }
      return current.promise as Promise<T>;
    }
    if (this.activeReads >= this.maxConcurrentReads && this.queue.length >= this.maxQueuedReads) {
      return Promise.reject(new McpTransportError('read-queue-full'));
    }
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
    const job: QueuedRead = { key, generation: context.generation, targetId, priority,
      sequence: this.sequence++, run: () => operation(), resolve, reject, promise, started: false };
    this.reads.set(key, job);
    if (this.activeReads >= this.maxConcurrentReads) this.queue.push(job);
    else void this.runJob(job);
    return promise as Promise<T>;
  }

  private async runJob(job: QueuedRead): Promise<void> {
    job.started = true;
    this.activeReads += 1;
    try {
      if (job.generation !== this.generation) throw new McpTransportError('connection-changed');
      const value = await job.run();
      if (job.generation !== this.generation) throw new McpTransportError('connection-changed');
      job.resolve(value);
    } catch (error) { job.reject(error); }
    finally {
      if (this.reads.get(job.key) === job) this.reads.delete(job.key);
      this.activeReads -= 1;
      this.pump();
    }
  }

  private pump(): void {
    this.sortQueue();
    while (this.activeReads < this.maxConcurrentReads && this.queue.length) {
      const next = this.queue.shift()!;
      void this.runJob(next);
    }
  }

  private sortQueue(): void {
    this.queue.sort((left, right) => PRIORITY[left.priority] - PRIORITY[right.priority] || left.sequence - right.sequence);
  }

  private async requireContext(): Promise<Context> {
    if (this.accessFlight?.generation === this.generation) return this.accessFlight.promise;
    const generation = this.generation;
    const promise = this.loadContext(generation);
    const flight = { generation, promise };
    this.accessFlight = flight;
    try { return await promise; }
    finally { if (this.accessFlight === flight) this.accessFlight = null; }
  }

  private async loadContext(generation: number): Promise<Context> {
    const loaded = await this.settings.loadSettings();
    if (!loaded.ok) return this.failContext(generation, 'settings-unavailable');
    const endpoint = parseCodexBridgeMcpEndpoint(loaded.settings.codexBridgeMcpUrl ?? CODEX_BRIDGE_MCP_DEFAULT_URL);
    if (!endpoint) return this.failContext(generation, 'invalid-endpoint');
    let permitted = false;
    try { permitted = await this.permissions.contains({ origins: [endpoint.originPattern] }); }
    catch { /* Treat permission API errors as no access. */ }
    if (!permitted) return this.failContext(generation, 'permission-required');
    let token = '';
    try {
      const stored = await this.sessionStorage.get([CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY]);
      const value = stored[CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY];
      if (value !== undefined && typeof value !== 'string') return this.failContext(generation, 'settings-unavailable');
      if (typeof value === 'string') token = value;
    } catch { return this.failContext(generation, 'settings-unavailable'); }
    if (generation !== this.generation) throw new McpTransportError('connection-changed');
    if (this.context?.endpoint === endpoint.url && this.context.token === token
      && this.context.originPattern === endpoint.originPattern) return this.context;
    const connectionId = await this.connectionIdFactory(endpoint.url);
    if (generation !== this.generation) throw new McpTransportError('connection-changed');
    if (!connectionId) return this.failContext(generation, 'unknown-error');
    this.generation += 1;
    this.snapshots.clear();
    const context: Context = {
      endpoint: endpoint.url, originPattern: endpoint.originPattern, token, connectionId,
      generation: this.generation,
      client: this.clientFactory(endpoint.url, token, { fetchImpl: this.fetchImpl, timeoutMs: this.timeoutMs }),
    };
    this.context = context;
    return context;
  }

  private failContext(generation: number, reason: CodexBridgeReadFailureReason): never {
    if (generation !== this.generation) throw new McpTransportError('connection-changed');
    if (this.context) this.invalidate();
    throw codedError(reason);
  }

  private isCurrent(context: Context): boolean {
    return context.generation === this.generation && this.context === context;
  }

  private assertCurrent(context: Context): void {
    if (!this.isCurrent(context)) throw new McpTransportError('connection-changed');
  }
}

export function createDefaultCodexBridgeReadService(): CodexBridgeReadService {
  return new CodexBridgeReadService({ sessionStorage: chrome.storage.session, permissions: chrome.permissions,
    settings: createChromeSettingsRepository() });
}
