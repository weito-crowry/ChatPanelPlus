import {
  CODEX_BRIDGE_THREAD_MONITOR_ALARM,
  CODEX_BRIDGE_THREAD_MONITOR_FOREGROUND_MS,
  CODEX_BRIDGE_THREAD_MONITOR_MAX_WATCHES,
  CODEX_BRIDGE_THREAD_MONITOR_MINUTES,
  CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY,
  codexBridgeWatchKey,
  isCodexBridgeWatchFetchOutcome,
  isCodexBridgeWatchIdentifier,
  type CodexBridgeWatchFetchOutcome,
  type CodexBridgeWatchSnapshot,
  type CodexBridgeWatchTurnChange,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeThreadStatus } from '../shared/codexbridge-mcp-protocol.ts';

type LocalStorageLike = Readonly<{
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}>;

type AlarmLike = Readonly<{
  get(name: string): Promise<unknown>;
  create(name: string, alarmInfo: { delayInMinutes: number; periodInMinutes: number }): void;
  clear(name: string): Promise<boolean>;
}>;

export type CodexBridgeMonitorAccess = Readonly<{
  connectionId: string | null;
  readStatus?: (targetId: string, threadId: string) => Promise<CodexBridgeThreadStatus>;
  failure?: CodexBridgeWatchFetchOutcome;
}>;

type PollCadence = 'foreground' | 'background';
type MonitorOptions = Readonly<{
  now?: () => number;
  createWatchId?: () => string;
  maxPollsPerCycle?: number;
  maxConcurrentRequests?: number;
  gapThresholdMs?: number;
}>;

type StoredValue = Readonly<{ version: 1; items: readonly CodexBridgeWatchSnapshot[] }>;
type StorageMutation<T> = (items: CodexBridgeWatchSnapshot[]) => Readonly<{ items: CodexBridgeWatchSnapshot[]; result: T }>;

const MAX_POLL_FAILURES = 8;
const MAX_BACKOFF_MS = 5 * 60_000;
const MAX_POLLS_PER_TARGET_PER_CYCLE = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is CodexBridgeWatchSnapshot['lastTurnStatus'] {
  return value === null || value === 'completed' || value === 'failed' || value === 'interrupted'
    || value === 'in_progress' || value === 'unknown';
}

function isBaselineTurnKind(value: unknown): value is CodexBridgeWatchSnapshot['baselineTurnKind'] {
  return value === 'turn' || value === 'none' || value === 'unknown';
}

function nullableText(value: unknown, maxLength = 512): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= maxLength
    && !Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    }));
}

function readSnapshot(value: unknown): CodexBridgeWatchSnapshot | null {
  if (!isRecord(value)) return null;
  const baselineTurnKind = value.baselineTurnKind === undefined
    ? (value.baselineTurnId === null ? 'unknown' : 'turn')
    : value.baselineTurnKind;
  if (!isBaselineTurnKind(baselineTurnKind)
    || (baselineTurnKind === 'turn') !== (typeof value.baselineTurnId === 'string')
    || (baselineTurnKind === 'none' && value.baselineCaptured !== true)
    || (value.baselineCaptured === false && baselineTurnKind !== 'unknown')
    || typeof value.watchId !== 'string' || value.watchId.length > 96
    || !isCodexBridgeWatchIdentifier(value.connectionId) || value.connectionId.length > 96
    || !isCodexBridgeWatchIdentifier(value.targetId) || !isCodexBridgeWatchIdentifier(value.threadId)
    || value.enabled !== true || typeof value.baselineCaptured !== 'boolean'
    || !nullableText(value.baselineTurnId) || !isStatus(value.baselineTurnStatus)
    || !nullableText(value.lastObservedTurnId) || !isStatus(value.lastTurnStatus)
    || !nullableText(value.statusState, 80) || !nullableText(value.lastTurnEvidence, 80)
    || !nullableText(value.currentExecutionState, 80)
    || !nullableText(value.currentExecutionEvidence, 80) || !nullableText(value.currentExecutionTurnId)
    || (typeof value.needsAttention !== 'boolean' && value.needsAttention !== null)
    || !['baseline', 'same', 'advanced', 'gap', 'unknown'].includes(String(value.turnChange))
    || !nullableText(value.observedAt, 40) || !nullableText(value.lastSuccessAt, 40)
    || !isCodexBridgeWatchFetchOutcome(value.fetchOutcome)
    || !Number.isSafeInteger(value.nextPollAt) || (value.nextPollAt as number) < 0
    || !Number.isSafeInteger(value.failureCount) || (value.failureCount as number) < 0
    || (value.failureCount as number) > MAX_POLL_FAILURES) return null;
  return { ...value, baselineTurnKind } as unknown as CodexBridgeWatchSnapshot;
}

function mapError(error: unknown): CodexBridgeWatchFetchOutcome {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    switch (error.code) {
      case 'authentication-required': return '401';
      case 'forbidden': return '403';
      case 'timeout': return 'timeout';
      case 'disconnected': return 'disconnected';
      case 'endpoint-not-found': return 'endpoint-not-found';
      case 'session-expired': return 'session-expired';
      case 'http-error': return 'http-error';
      case 'protocol-version-unsupported': return 'protocol-version-unsupported';
      case 'readonly-tool-unavailable': return 'readonly-tool-unavailable';
      case 'readonly-probe-failed': return 'readonly-probe-failed';
      case 'protocol-error': return 'protocol-error';
    }
  }
  return 'unknown';
}

function timestamp(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function statusEvidence(status: CodexBridgeThreadStatus): Omit<CodexBridgeWatchSnapshot, 'watchId' | 'connectionId' | 'targetId' | 'threadId' | 'enabled' | 'baselineCaptured' | 'baselineTurnKind' | 'baselineTurnId' | 'baselineTurnStatus' | 'lastObservedTurnId' | 'turnChange' | 'observedAt' | 'lastSuccessAt' | 'fetchOutcome' | 'nextPollAt' | 'failureCount'> {
  return {
    statusState: status.state,
    lastTurnStatus: status.lastTurn?.status ?? null,
    lastTurnEvidence: status.lastTurn?.evidence ?? null,
    currentExecutionState: status.currentExecution?.state ?? null,
    currentExecutionEvidence: status.currentExecution?.evidence ?? null,
    currentExecutionTurnId: status.currentExecution?.turnId ?? null,
    needsAttention: status.needsAttention,
  };
}

export class CodexBridgeThreadMonitor {
  private readonly now: () => number;
  private readonly createWatchId: () => string;
  private readonly maxPollsPerCycle: number;
  private readonly maxConcurrentRequests: number;
  private readonly gapThresholdMs: number;
  private storageTail: Promise<void> = Promise.resolve();
  private alarmTail: Promise<void> = Promise.resolve();
  private readonly pollFlights = new Map<string, Promise<void>>();
  private readonly targetTails = new Map<string, Promise<void>>();
  private readonly requestWaiters: Array<() => void> = [];
  private activeRequests = 0;
  private foregroundUntil = 0;
  private readonly storage: LocalStorageLike;
  private readonly alarms: AlarmLike;
  private readonly resolveAccess: () => Promise<CodexBridgeMonitorAccess>;

  constructor(
    storage: LocalStorageLike,
    alarms: AlarmLike,
    resolveAccess: () => Promise<CodexBridgeMonitorAccess>,
    options: MonitorOptions = {},
  ) {
    this.storage = storage;
    this.alarms = alarms;
    this.resolveAccess = resolveAccess;
    this.now = options.now ?? Date.now;
    this.createWatchId = options.createWatchId ?? (() => globalThis.crypto?.randomUUID?.()
      ?? `${this.now()}-${Math.random().toString(36).slice(2, 12)}`);
    this.maxPollsPerCycle = options.maxPollsPerCycle ?? 12;
    this.maxConcurrentRequests = options.maxConcurrentRequests ?? 3;
    this.gapThresholdMs = options.gapThresholdMs ?? 90_000;
  }

  async list(): Promise<readonly CodexBridgeWatchSnapshot[]> {
    return this.withStorage(() => this.readItems());
  }

  async read(connectionId: string, targetId: string, threadId: string): Promise<CodexBridgeWatchSnapshot | null> {
    const key = codexBridgeWatchKey(connectionId, targetId, threadId);
    return (await this.list()).find((item) => codexBridgeWatchKey(item.connectionId, item.targetId, item.threadId) === key) ?? null;
  }

  async startWatch(targetId: string, threadId: string): Promise<
    | Readonly<{ ok: true; item: CodexBridgeWatchSnapshot; created: boolean }>
    | Readonly<{ ok: false; reason: 'watch-limit' | 'connection-unavailable' }>
  > {
    if (!isCodexBridgeWatchIdentifier(targetId) || !isCodexBridgeWatchIdentifier(threadId)) {
      return { ok: false, reason: 'connection-unavailable' };
    }
    let access: CodexBridgeMonitorAccess;
    try {
      access = await this.resolveAccess();
    } catch {
      access = { connectionId: null, failure: 'settings-unavailable' };
    }
    if (!access.connectionId) return { ok: false, reason: 'connection-unavailable' };

    const key = codexBridgeWatchKey(access.connectionId, targetId, threadId);
    const initial: CodexBridgeWatchSnapshot = {
      watchId: this.createWatchId(), connectionId: access.connectionId, targetId, threadId, enabled: true,
      baselineCaptured: false, baselineTurnKind: 'unknown', baselineTurnId: null, baselineTurnStatus: null,
      lastObservedTurnId: null, statusState: null, lastTurnStatus: null, lastTurnEvidence: null,
      currentExecutionState: null, currentExecutionEvidence: null, currentExecutionTurnId: null,
      needsAttention: null, turnChange: 'unknown', observedAt: null, lastSuccessAt: null,
      fetchOutcome: 'unknown', nextPollAt: this.now(), failureCount: 0,
    };
    const result = await this.mutate<Readonly<{ item: CodexBridgeWatchSnapshot | null; created: boolean }>>((items) => {
      const existing = items.find((item) => codexBridgeWatchKey(item.connectionId, item.targetId, item.threadId) === key);
      if (existing) return { items, result: { item: existing, created: false } };
      if (items.length >= CODEX_BRIDGE_THREAD_MONITOR_MAX_WATCHES) {
        return { items, result: { item: null, created: false } };
      }
      return { items: [...items, initial], result: { item: initial, created: true } };
    });
    if (!result.item) return { ok: false, reason: 'watch-limit' };
    await this.syncAlarm();
    if (result.created) {
      await this.poll(result.item, access, 'background');
    }
    return { ok: true, item: (await this.read(access.connectionId, targetId, threadId)) ?? result.item, created: result.created };
  }

  async stopWatch(connectionId: string, targetId: string, threadId: string): Promise<boolean> {
    const key = codexBridgeWatchKey(connectionId, targetId, threadId);
    const removed = await this.mutate((items) => {
      const next = items.filter((item) => codexBridgeWatchKey(item.connectionId, item.targetId, item.threadId) !== key);
      return { items: next, result: next.length !== items.length };
    });
    if (removed) await this.syncAlarm();
    return removed;
  }

  async restore(): Promise<void> {
    const items = await this.list();
    await this.syncAlarm(items);
    if (items.some((item) => item.enabled)) await this.refresh('background');
  }

  async refreshForeground(): Promise<void> {
    this.foregroundUntil = this.now() + 35_000;
    await this.refresh('foreground');
  }

  async refreshAlarm(): Promise<void> {
    await this.refresh('background');
  }

  private async refresh(cadence: PollCadence, force = false): Promise<void> {
    let access: CodexBridgeMonitorAccess;
    try {
      access = await this.resolveAccess();
    } catch {
      access = { connectionId: null, failure: 'settings-unavailable' };
    }
    if (!access.connectionId) return;
    const now = this.now();
    const interval = cadence === 'foreground' || this.foregroundUntil > now ? CODEX_BRIDGE_THREAD_MONITOR_FOREGROUND_MS : 30_000;
    const candidates = (await this.list())
      .filter((item) => {
        if (!item.enabled || item.connectionId !== access.connectionId) return false;
        if (force || item.nextPollAt <= now) return true;
        if (cadence !== 'foreground' || item.fetchOutcome !== 'ok' || !item.lastSuccessAt) return false;
        return Date.parse(item.lastSuccessAt) + CODEX_BRIDGE_THREAD_MONITOR_FOREGROUND_MS <= now;
      })
      .sort((left, right) => left.nextPollAt - right.nextPollAt || (left.lastSuccessAt ?? '').localeCompare(right.lastSuccessAt ?? ''))
    const perTarget = new Map<string, number>();
    const due: CodexBridgeWatchSnapshot[] = [];
    for (const item of candidates) {
      const count = perTarget.get(item.targetId) ?? 0;
      if (count >= MAX_POLLS_PER_TARGET_PER_CYCLE) continue;
      perTarget.set(item.targetId, count + 1);
      due.push(item);
      if (due.length >= this.maxPollsPerCycle) break;
    }
    await Promise.all(due.map((item) => this.poll(item, access, cadence, interval)));
  }

  private poll(item: CodexBridgeWatchSnapshot, access: CodexBridgeMonitorAccess, cadence: PollCadence, interval?: number): Promise<void> {
    const key = codexBridgeWatchKey(item.connectionId, item.targetId, item.threadId);
    const flightKey = `${key}\u0000${item.watchId}`;
    const current = this.pollFlights.get(flightKey);
    if (current) return current;
    const task = this.withTarget(item.targetId, () => this.withRequestSlot(async () => {
      const active = (await this.read(item.connectionId, item.targetId, item.threadId))?.watchId === item.watchId;
      if (!active) return;
      if (!access.readStatus) {
        await this.saveFailure(item, access.failure ?? 'unknown', cadence);
        return;
      }
      try {
        const status = await access.readStatus(item.targetId, item.threadId);
        await this.saveSuccess(item, status, cadence, interval);
      } catch (error) {
        await this.saveFailure(item, mapError(error), cadence);
      }
    }));
    this.pollFlights.set(flightKey, task);
    const cleanup = () => {
      if (this.pollFlights.get(flightKey) === task) this.pollFlights.delete(flightKey);
    };
    void task.then(cleanup, cleanup);
    return task;
  }

  private async saveSuccess(item: CodexBridgeWatchSnapshot, status: CodexBridgeThreadStatus, cadence: PollCadence, interval?: number): Promise<void> {
    const now = this.now();
    await this.mutate((items) => {
      const index = items.findIndex((candidate) => candidate.watchId === item.watchId
        && codexBridgeWatchKey(candidate.connectionId, candidate.targetId, candidate.threadId)
          === codexBridgeWatchKey(item.connectionId, item.targetId, item.threadId));
      if (index < 0) return { items, result: undefined };
      const previous = items[index]!;
      const currentTurnId = status.lastTurn?.turnId ?? null;
      let baselineCaptured = previous.baselineCaptured;
      let baselineTurnKind = previous.baselineTurnKind;
      let baselineTurnId = previous.baselineTurnId;
      let baselineTurnStatus = previous.baselineTurnStatus;
      let turnChange: CodexBridgeWatchTurnChange;
      if (!baselineCaptured) {
        baselineCaptured = true;
        baselineTurnKind = currentTurnId !== null
          ? 'turn'
          : status.state === 'idle' && status.lastTurn === null && status.currentExecution === null ? 'none' : 'unknown';
        baselineTurnId = currentTurnId;
        baselineTurnStatus = status.lastTurn?.status ?? null;
        turnChange = 'baseline';
      } else if (!currentTurnId) {
        turnChange = previous.turnChange === 'gap' ? 'gap' : 'unknown';
      } else if (previous.lastObservedTurnId === currentTurnId) {
        turnChange = previous.turnChange === 'gap' ? 'gap' : 'same';
      } else if (!previous.lastObservedTurnId) {
        if (previous.baselineTurnKind === 'none') {
          const lastSuccessMs = previous.lastSuccessAt === null ? null : Date.parse(previous.lastSuccessAt);
          turnChange = lastSuccessMs !== null && now - lastSuccessMs >= this.gapThresholdMs ? 'gap' : 'advanced';
        } else {
          turnChange = 'unknown';
        }
      } else {
        const lastSuccessMs = previous.lastSuccessAt === null ? null : Date.parse(previous.lastSuccessAt);
        turnChange = lastSuccessMs !== null && now - lastSuccessMs >= this.gapThresholdMs ? 'gap' : 'advanced';
      }
      const success: CodexBridgeWatchSnapshot = {
        ...previous, ...statusEvidence(status), baselineCaptured, baselineTurnKind, baselineTurnId, baselineTurnStatus,
        lastObservedTurnId: currentTurnId ?? previous.lastObservedTurnId,
        turnChange, observedAt: timestamp(now), lastSuccessAt: timestamp(now), fetchOutcome: 'ok',
        nextPollAt: now + (interval ?? (cadence === 'foreground' || this.foregroundUntil > now ? 15_000 : 30_000)),
        failureCount: 0,
      };
      const next = [...items];
      next[index] = success;
      return { items: next, result: undefined };
    });
  }

  private async saveFailure(item: CodexBridgeWatchSnapshot, outcome: CodexBridgeWatchFetchOutcome, cadence: PollCadence): Promise<void> {
    const now = this.now();
    await this.mutate((items) => {
      const index = items.findIndex((candidate) => candidate.watchId === item.watchId
        && codexBridgeWatchKey(candidate.connectionId, candidate.targetId, candidate.threadId)
          === codexBridgeWatchKey(item.connectionId, item.targetId, item.threadId));
      if (index < 0) return { items, result: undefined };
      const previous = items[index]!;
      const failureCount = Math.min(MAX_POLL_FAILURES, previous.failureCount + 1);
      const backoff = Math.min(MAX_BACKOFF_MS, 30_000 * (2 ** Math.min(failureCount - 1, 4)));
      const next = [...items];
      next[index] = {
        ...previous, observedAt: timestamp(now), fetchOutcome: outcome, failureCount,
        nextPollAt: now + Math.max(backoff, cadence === 'foreground' ? CODEX_BRIDGE_THREAD_MONITOR_FOREGROUND_MS : 30_000),
      };
      return { items: next, result: undefined };
    });
  }

  private async readItems(): Promise<readonly CodexBridgeWatchSnapshot[]> {
    const stored = await this.storage.get([CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY]);
    const value = stored[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY];
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.items)) return [];
    const items = value.items.map(readSnapshot).filter((item): item is CodexBridgeWatchSnapshot => item !== null);
    const unique = new Map<string, CodexBridgeWatchSnapshot>();
    for (const item of items.slice(0, CODEX_BRIDGE_THREAD_MONITOR_MAX_WATCHES)) {
      const key = codexBridgeWatchKey(item.connectionId, item.targetId, item.threadId);
      if (!unique.has(key)) unique.set(key, item);
    }
    return [...unique.values()];
  }

  private mutate<T>(mutation: StorageMutation<T>): Promise<T> {
    return this.withStorage(async () => {
      const current = [...await this.readItems()];
      const changed = mutation(current);
      const value: StoredValue = { version: 1, items: changed.items.slice(0, CODEX_BRIDGE_THREAD_MONITOR_MAX_WATCHES) };
      await this.storage.set({ [CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY]: value });
      return changed.result;
    });
  }

  private withStorage<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.storageTail.then(operation, operation);
    this.storageTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private syncAlarm(items?: readonly CodexBridgeWatchSnapshot[]): Promise<void> {
    const operation = this.alarmTail.then(async () => {
      const saved = items ?? await this.list();
      if (saved.some((item) => item.enabled)) {
        if (!await this.alarms.get(CODEX_BRIDGE_THREAD_MONITOR_ALARM)) {
          this.alarms.create(CODEX_BRIDGE_THREAD_MONITOR_ALARM, {
            delayInMinutes: CODEX_BRIDGE_THREAD_MONITOR_MINUTES,
            periodInMinutes: CODEX_BRIDGE_THREAD_MONITOR_MINUTES,
          });
        }
      } else {
        await this.alarms.clear(CODEX_BRIDGE_THREAD_MONITOR_ALARM);
      }
    });
    this.alarmTail = operation.catch(() => undefined);
    return operation;
  }

  private withTarget<T>(targetId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.targetTails.get(targetId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    this.targetTails.set(targetId, tail);
    void tail.then(() => {
      if (this.targetTails.get(targetId) === tail) this.targetTails.delete(targetId);
    });
    return result;
  }

  private async withRequestSlot<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeRequests >= this.maxConcurrentRequests) {
      await new Promise<void>((resolve) => this.requestWaiters.push(resolve));
    }
    this.activeRequests += 1;
    try {
      return await operation();
    } finally {
      this.activeRequests -= 1;
      this.requestWaiters.shift()?.();
    }
  }
}
