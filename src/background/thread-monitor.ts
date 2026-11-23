import {
  CODEX_BRIDGE_THREAD_MONITOR_ALARM,
  CODEX_BRIDGE_THREAD_MONITOR_FOREGROUND_MS,
  CODEX_BRIDGE_THREAD_MONITOR_MINUTES,
  CODEX_BRIDGE_WATCH_ACK_EVENT_IDS_LIMIT,
  codexBridgeTerminalEventKey,
  codexBridgeWatchKey,
  isCodexBridgeWatchIdentifier,
  type CodexBridgeNotificationReason,
  type CodexBridgeNotificationState,
  type CodexBridgeTerminalEvent,
  type CodexBridgeFinalAnswerResult,
  type CodexBridgeWatchFetchOutcome,
  type CodexBridgeWatchSnapshot,
  type CodexBridgeWatchOwnerMute,
  type CodexBridgeWatchTurnChange,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeTarget, CodexBridgeThreadPage, CodexBridgeThreadStatus } from '../shared/codexbridge-mcp-protocol.ts';
import { codexBridgeTerminalHoldReason, detectCodexBridgeTerminalStatus } from './thread-monitor-events.ts';
import { CodexBridgeThreadMonitorStorage, type LocalStorageLike } from './thread-monitor-storage.ts';
import { registerCodexBridgeWatch } from './thread-monitor-registration.ts';
import { mapMonitorError as mapError, monitorTimestamp as timestamp, statusEvidence } from './thread-monitor-utils.ts';

type AlarmLike = Readonly<{
  get(name: string): Promise<unknown>;
  create(name: string, alarmInfo: { delayInMinutes: number; periodInMinutes: number }): void;
  clear(name: string): Promise<boolean>;
}>;

export type CodexBridgeMonitorAccess = Readonly<{
  connectionId: string | null;
  readTargets?: () => Promise<readonly CodexBridgeTarget[]>;
  readRunningThreads?: (targetId: string) => Promise<CodexBridgeThreadPage>;
  readStatus?: (targetId: string, threadId: string) => Promise<CodexBridgeThreadStatus>;
  readFinalAnswer?: (targetId: string, threadId: string, turnId: string) => Promise<CodexBridgeFinalAnswerResult>;
  failure?: CodexBridgeWatchFetchOutcome;
}>;

export type CodexBridgeNotificationPreparation =
  | Readonly<{ state: 'skipped' | 'failed'; reason: CodexBridgeNotificationReason }>
  | Readonly<{ state: 'ready'; play: () => Promise<Readonly<{ ok: true } | { ok: false; reason: CodexBridgeNotificationReason }>> }>;
export type CodexBridgeNotificationHandler = Readonly<{
  prepare: (event: CodexBridgeTerminalEvent) => Promise<CodexBridgeNotificationPreparation>;
}>;

type PollCadence = 'foreground' | 'background';
type MonitorOptions = Readonly<{
  now?: () => number;
  createWatchId?: () => string;
  maxPollsPerCycle?: number;
  maxConcurrentRequests?: number;
  gapThresholdMs?: number;
  createEventId?: () => string;
  notification?: CodexBridgeNotificationHandler;
}>;

const MAX_POLL_FAILURES = 8;
const MAX_BACKOFF_MS = 5 * 60_000;
const MAX_POLLS_PER_TARGET_PER_CYCLE = 3;

export class CodexBridgeThreadMonitor {
  private readonly now: () => number;
  private readonly createWatchId: () => string;
  private readonly maxPollsPerCycle: number;
  private readonly maxConcurrentRequests: number;
  private readonly gapThresholdMs: number;
  private alarmTail: Promise<void> = Promise.resolve();
  private readonly pollFlights = new Map<string, Promise<void>>();
  private readonly targetTails = new Map<string, Promise<void>>();
  private readonly requestWaiters: Array<() => void> = [];
  private activeRequests = 0;
  private foregroundUntil = 0;
  private readonly storage: CodexBridgeThreadMonitorStorage;
  private readonly alarms: AlarmLike;
  private readonly resolveAccess: () => Promise<CodexBridgeMonitorAccess>;
  private readonly createEventId: () => string;
  private readonly notification: CodexBridgeNotificationHandler | undefined;

  constructor(
    storage: LocalStorageLike,
    alarms: AlarmLike,
    resolveAccess: () => Promise<CodexBridgeMonitorAccess>,
    options: MonitorOptions = {},
  ) {
    this.storage = new CodexBridgeThreadMonitorStorage(storage);
    this.alarms = alarms;
    this.resolveAccess = resolveAccess;
    this.now = options.now ?? Date.now;
    this.createWatchId = options.createWatchId ?? (() => globalThis.crypto?.randomUUID?.()
      ?? `${this.now()}-${Math.random().toString(36).slice(2, 12)}`);
    this.createEventId = options.createEventId ?? this.createWatchId;
    this.notification = options.notification;
    this.maxPollsPerCycle = options.maxPollsPerCycle ?? 12;
    this.maxConcurrentRequests = options.maxConcurrentRequests ?? 3;
    this.gapThresholdMs = options.gapThresholdMs ?? 90_000;
  }

  async list(): Promise<readonly CodexBridgeWatchSnapshot[]> {
    return this.storage.listItems();
  }

  async listEvents(): Promise<readonly CodexBridgeTerminalEvent[]> {
    return [...await this.storage.listEvents()].sort((left, right) => right.detectedAt.localeCompare(left.detectedAt));
  }

  async readEvent(eventId: string, ownerConversationId?: string): Promise<CodexBridgeTerminalEvent | null> {
    const event = await this.storage.readEvent(eventId);
    return ownerConversationId === undefined || event?.ownerConversationId === ownerConversationId ? event : null;
  }

  async read(connectionId: string, targetId: string, threadId: string): Promise<CodexBridgeWatchSnapshot | null> {
    const key = codexBridgeWatchKey(connectionId, targetId, threadId);
    return (await this.list()).find((item) => codexBridgeWatchKey(item.connectionId, item.targetId, item.threadId) === key) ?? null;
  }

  async startWatch(targetId: string, threadId: string, owner?: CodexBridgeWatchOwnerMute, registration: {
    allowOwnerTransfer?: boolean;
    expectedConnectionId?: string;
    initialStatus?: CodexBridgeThreadStatus;
  } = {}): Promise<
    | Readonly<{ ok: true; item: CodexBridgeWatchSnapshot; created: boolean; transferred: boolean }>
    | Readonly<{ ok: false; reason: 'watch-limit' | 'connection-unavailable' | 'connection-changed' | 'owner-unavailable' | 'owner-conflict' }>
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
    if (registration.expectedConnectionId && access.connectionId !== registration.expectedConnectionId) {
      return { ok: false, reason: 'connection-changed' };
    }

    const initial: CodexBridgeWatchSnapshot = {
      watchId: this.createWatchId(), connectionId: access.connectionId, targetId, threadId, enabled: true,
      ...(owner ?? {}),
      baselineCaptured: false, baselineTurnKind: 'unknown', baselineTurnId: null, baselineTurnStatus: null,
      lastObservedTurnId: null, statusState: null, lastTurnStatus: null, lastTurnEvidence: null,
      currentExecutionState: null, currentExecutionEvidence: null, currentExecutionReason: null, currentExecutionTurnId: null,
      terminalHoldReason: null, needsAttention: null, turnChange: 'unknown', observedAt: null, lastSuccessAt: null,
      fetchOutcome: 'unknown', nextPollAt: this.now(), failureCount: 0,
    };
    const result = await this.storage.mutate((items, events) => registerCodexBridgeWatch(
      items, events, initial, owner, registration.allowOwnerTransfer !== false,
    ));
    if (result.ownerConflict) return { ok: false, reason: 'owner-conflict' };
    if (result.ownerUnavailable) return { ok: false, reason: 'owner-unavailable' };
    if (!result.item) return { ok: false, reason: 'watch-limit' };
    await this.syncAlarm();
    if (result.created) {
      if (registration.initialStatus) await this.saveSuccess(result.item, registration.initialStatus, 'background');
      else await this.poll(result.item, access, 'background');
    }
    return { ok: true, item: (await this.read(access.connectionId, targetId, threadId)) ?? result.item,
      created: result.created, transferred: result.transferred };
  }

  async stopWatch(connectionId: string, targetId: string, threadId: string, ownerConversationId?: string): Promise<boolean> {
    const key = codexBridgeWatchKey(connectionId, targetId, threadId);
    const removed = await this.storage.mutate((items, events) => {
      const next = items.filter((item) => codexBridgeWatchKey(item.connectionId, item.targetId, item.threadId) !== key
        || (ownerConversationId !== undefined && item.ownerConversationId !== ownerConversationId));
      return { items: next, events, result: next.length !== items.length };
    });
    if (removed) await this.syncAlarm();
    return removed;
  }

  async updateOwnerMute(ownerTabId: number, ownerConversationId: string, ownerMuted: boolean | null, ownerMuteRevision?: number): Promise<void> {
    await this.storage.mutate((items, events) => ({
      items: items.map((item) => item.ownerTabId === ownerTabId && item.ownerConversationId === ownerConversationId
        ? { ...item, ownerMuted, ...(ownerMuteRevision === undefined ? {} : { ownerMuteRevision }) } : item),
      events: events.map((event) => event.ownerTabId === ownerTabId && event.ownerConversationId === ownerConversationId
        ? { ...event, ownerMuted, ...(ownerMuteRevision === undefined ? {} : { ownerMuteRevision }) } : event),
      result: undefined,
    }));
  }

  async acknowledgeEvents(ownerConversationId: string, eventIds: readonly string[], acknowledgedAt: string): Promise<boolean> {
    return this.storage.mutate((items, events) => {
      const unique = [...new Set(eventIds)];
      const selected = events.filter((event) => unique.includes(event.eventId));
      if (unique.length !== eventIds.length || selected.length !== unique.length
        || selected.some((event) => event.ownerConversationId !== ownerConversationId)) {
        return { items, events, result: false };
      }
      const ids = new Set(unique);
      return {
        items,
        events: events.map((event) => ids.has(event.eventId)
          ? { ...event, acknowledgedAt: event.acknowledgedAt ?? acknowledgedAt } : event),
        result: true,
      };
    });
  }

  async clearEvents(ownerConversationId: string, eventIds: readonly string[]): Promise<boolean> {
    return this.storage.mutate((items, events) => {
      const ids = new Set(eventIds);
      if (ids.size !== eventIds.length || ids.size === 0 || ids.size > CODEX_BRIDGE_WATCH_ACK_EVENT_IDS_LIMIT
        || events.some((event) => ids.has(event.eventId) && event.ownerConversationId !== ownerConversationId)) {
        return { items, events, result: false };
      }
      return { items, events: events.filter((event) => !ids.has(event.eventId)), result: true };
    });
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

  scheduleTargetRequest<T>(targetId: string, operation: () => Promise<T>): Promise<T> {
    return this.withTarget(targetId, () => this.withRequestSlot(operation));
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
      if (!access.readStatus) { await this.saveFailure(item, access.failure ?? 'unknown', cadence); return; }
      let status: CodexBridgeThreadStatus;
      try {
        status = await access.readStatus(item.targetId, item.threadId);
      } catch (error) {
        await this.saveFailure(item, mapError(error), cadence);
        return;
      }
      try {
        await this.saveSuccess(item, status, cadence, interval);
      } catch { /* Keep the last persisted observation for terminal detection on the next poll. */ }
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
    const result = await this.storage.mutate((items, events) => {
      const index = items.findIndex((candidate) => candidate.watchId === item.watchId
        && codexBridgeWatchKey(candidate.connectionId, candidate.targetId, candidate.threadId)
          === codexBridgeWatchKey(item.connectionId, item.targetId, item.threadId));
      if (index < 0) return { items, events, result: { event: null, unregistered: false } };
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
        nextPollAt: now + (interval ?? (cadence === 'foreground' || this.foregroundUntil > now ? CODEX_BRIDGE_THREAD_MONITOR_FOREGROUND_MS : 30_000)),
        failureCount: 0, terminalHoldReason: null,
      };
      const terminalStatus = detectCodexBridgeTerminalStatus(previous, success, this.gapThresholdMs);
      const holdReason = terminalStatus ? null : codexBridgeTerminalHoldReason(previous, success, this.gapThresholdMs);
      const next = [...items];
      next[index] = { ...success, terminalHoldReason: holdReason };
      if (!terminalStatus) return { items: next, events, result: { event: null, unregistered: false } };
      const eventKey = codexBridgeTerminalEventKey(success.connectionId, success.targetId, success.threadId,
        success.lastObservedTurnId!);
      const duplicate = events.some((record) => codexBridgeTerminalEventKey(record.connectionId, record.targetId,
        record.threadId, record.turnId) === eventKey);
      const created: CodexBridgeTerminalEvent | null = duplicate ? null : {
        eventId: this.createEventId(), watchId: success.watchId, connectionId: success.connectionId,
        targetId: success.targetId, threadId: success.threadId, turnId: success.lastObservedTurnId!,
        status: terminalStatus, detectedAt: timestamp(now) ?? new Date(now).toISOString(),
        notificationState: 'pending', notificationReason: null,
        ...(success.ownerTabId !== undefined && success.ownerConversationId !== undefined
          && success.ownerMuted !== undefined && success.ownerMuteRevision !== undefined
          ? {
            ownerTabId: success.ownerTabId, ownerConversationId: success.ownerConversationId,
            ownerMuted: success.ownerMuted, ownerMuteRevision: success.ownerMuteRevision,
          } : {}),
      };
      const remaining = items.filter((_, candidateIndex) => candidateIndex !== index);
      return {
        items: remaining,
        events: created ? [...events, created] : events,
        result: { event: created, unregistered: true },
      };
    });
    if (result.unregistered) {
      try {
        await this.syncAlarm();
      } catch {
        // Keep notification delivery independent of alarm API errors.
      }
    }
    if (result.event) await this.notifyForEvent(result.event);
  }

  private async saveFailure(item: CodexBridgeWatchSnapshot, outcome: CodexBridgeWatchFetchOutcome, cadence: PollCadence): Promise<void> {
    const now = this.now();
    await this.storage.mutate((items, events) => {
      const index = items.findIndex((candidate) => candidate.watchId === item.watchId
        && codexBridgeWatchKey(candidate.connectionId, candidate.targetId, candidate.threadId)
          === codexBridgeWatchKey(item.connectionId, item.targetId, item.threadId));
      if (index < 0) return { items, events, result: undefined };
      const previous = items[index]!;
      const failureCount = Math.min(MAX_POLL_FAILURES, previous.failureCount + 1);
      const backoff = Math.min(MAX_BACKOFF_MS, 30_000 * (2 ** Math.min(failureCount - 1, 4)));
      const next = [...items];
      next[index] = {
        ...previous, observedAt: timestamp(now), fetchOutcome: outcome, failureCount,
        nextPollAt: now + Math.max(backoff, cadence === 'foreground' ? CODEX_BRIDGE_THREAD_MONITOR_FOREGROUND_MS : 30_000),
      };
      return { items: next, events, result: undefined };
    });
  }

  private async notifyForEvent(event: CodexBridgeTerminalEvent): Promise<void> {
    const latestEvent = await this.storage.readEvent(event.eventId) ?? event;
    let preparation: CodexBridgeNotificationPreparation;
    try {
      preparation = this.notification
        ? await this.notification.prepare(latestEvent)
        : { state: 'failed', reason: 'settings-unavailable' };
    } catch {
      await this.updateNotification(event.eventId, 'failed', 'settings-unavailable');
      return;
    }
    if (preparation.state !== 'ready') {
      await this.updateNotification(event.eventId, preparation.state, preparation.reason);
      return;
    }
    const reserved = await this.updateNotification(event.eventId, 'requested', null, true);
    if (!reserved) return;
    try {
      const result = await preparation.play();
      const suppressed = !result.ok && (result.reason === 'muted' || result.reason === 'owner-unavailable');
      await this.updateNotification(event.eventId, result.ok ? 'played' : suppressed ? 'skipped' : 'failed',
        result.ok ? null : result.reason);
    } catch {
      await this.updateNotification(event.eventId, 'failed', 'playback-failed');
    }
  }

  private async updateNotification(
    eventId: string,
    state: CodexBridgeNotificationState,
    reason: CodexBridgeNotificationReason | null,
    reservePending = false,
  ): Promise<boolean> {
    try {
      return await this.storage.mutate((items, events) => {
        const index = events.findIndex((event) => event.eventId === eventId);
        if (index < 0 || (reservePending && events[index]!.notificationState !== 'pending')) {
          return { items, events, result: false };
        }
        const next = [...events];
        next[index] = { ...events[index]!, notificationState: state, notificationReason: reason };
        return { items, events: next, result: true };
      });
    } catch {
      return false;
    }
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
