import {
  CODEX_BRIDGE_THREAD_MONITOR_MAX_WATCHES,
  CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY,
  codexBridgeTerminalEventKey,
  codexBridgeWatchKey,
  isCodexBridgeTerminalEvent,
  isCodexBridgeWatchFetchOutcome,
  isCodexBridgeWatchIdentifier,
  type CodexBridgeTerminalEvent,
  type CodexBridgeTerminalHoldReason,
  type CodexBridgeWatchSnapshot,
  type CodexBridgeWatchOwnerMute,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import { isConversationId } from '../shared/conversation-route.ts';

export const CODEX_BRIDGE_THREAD_MONITOR_MAX_EVENTS = 128;

type LocalStorageLike = Readonly<{
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}>;
type MonitorState = Readonly<{ items: readonly CodexBridgeWatchSnapshot[]; events: readonly CodexBridgeTerminalEvent[] }>;
type Mutation<T> = (items: CodexBridgeWatchSnapshot[], events: CodexBridgeTerminalEvent[]) =>
  Readonly<{ items: CodexBridgeWatchSnapshot[]; events: CodexBridgeTerminalEvent[]; result: T }>;

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

function isTerminalHoldReason(value: unknown): value is CodexBridgeTerminalHoldReason | null {
  return value === null || ['previous-fetch-failed', 'observation-gap', 'thread-still-active',
    'terminal-evidence-unconfirmed', 'execution-evidence-unconfirmed', 'terminal-transition-not-confirmed'].includes(String(value));
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
  const hasOwner = ['ownerTabId', 'ownerConversationId', 'ownerMuted', 'ownerMuteRevision'].some((key) => key in value);
  const validOwner = !hasOwner || (Number.isSafeInteger(value.ownerTabId) && (value.ownerTabId as number) >= 0
    && isConversationId(value.ownerConversationId) && (typeof value.ownerMuted === 'boolean' || value.ownerMuted === null)
    && Number.isSafeInteger(value.ownerMuteRevision) && (value.ownerMuteRevision as number) >= 0);
  const currentExecutionReason = value.currentExecutionReason === undefined ? null : value.currentExecutionReason;
  const terminalHoldReason = value.terminalHoldReason === undefined ? null : value.terminalHoldReason;
  const baselineTurnKind = value.baselineTurnKind === undefined
    ? (value.baselineTurnId === null ? 'unknown' : 'turn') : value.baselineTurnKind;
  if (!validOwner || !isBaselineTurnKind(baselineTurnKind)
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
    || !nullableText(value.currentExecutionState, 80) || !nullableText(value.currentExecutionEvidence, 80)
    || !nullableText(currentExecutionReason, 160)
    || !nullableText(value.currentExecutionTurnId)
    || !isTerminalHoldReason(terminalHoldReason)
    || (typeof value.needsAttention !== 'boolean' && value.needsAttention !== null)
    || !['baseline', 'same', 'advanced', 'gap', 'unknown'].includes(String(value.turnChange))
    || !nullableText(value.observedAt, 40) || !nullableText(value.lastSuccessAt, 40)
    || !isCodexBridgeWatchFetchOutcome(value.fetchOutcome)
    || !Number.isSafeInteger(value.nextPollAt) || (value.nextPollAt as number) < 0
    || !Number.isSafeInteger(value.failureCount) || (value.failureCount as number) < 0
    || (value.failureCount as number) > 8) return null;
  return { ...value, baselineTurnKind, currentExecutionReason, terminalHoldReason } as unknown as CodexBridgeWatchSnapshot;
}

function readState(value: unknown): MonitorState {
  if (!isRecord(value) || !Array.isArray(value.items) || (value.version !== 1 && value.version !== 2)) {
    return { items: [], events: [] };
  }
  const items = new Map<string, CodexBridgeWatchSnapshot>();
  for (const candidate of value.items.map(readSnapshot).filter((item): item is CodexBridgeWatchSnapshot => item !== null)) {
    const key = codexBridgeWatchKey(candidate.connectionId, candidate.targetId, candidate.threadId);
    if (!items.has(key) && items.size < CODEX_BRIDGE_THREAD_MONITOR_MAX_WATCHES) items.set(key, candidate);
  }
  const events = new Map<string, CodexBridgeTerminalEvent>();
  const storedEvents = value.version === 2 && Array.isArray(value.events) ? value.events : [];
  for (const candidate of storedEvents.filter(isCodexBridgeTerminalEvent)) {
    const key = codexBridgeTerminalEventKey(candidate.connectionId, candidate.targetId,
      candidate.threadId, candidate.turnId);
    const existing = events.get(key);
    events.set(key, existing ? mergeDuplicateEvent(existing, candidate) : candidate);
  }
  return {
    items: [...items.values()],
    events: retainEvents([...events.values()]),
  };
}

function notificationStatePriority(state: CodexBridgeTerminalEvent['notificationState']): number {
  return { pending: 0, skipped: 1, failed: 2, requested: 3, played: 4 }[state];
}

export class CodexBridgeThreadMonitorStorage {
  private readonly area: LocalStorageLike;
  private tail: Promise<void> = Promise.resolve();

  constructor(area: LocalStorageLike) {
    this.area = area;
  }

  async listItems(): Promise<readonly CodexBridgeWatchSnapshot[]> {
    return this.withStorage(async () => (await this.read()).items);
  }

  async listEvents(): Promise<readonly CodexBridgeTerminalEvent[]> {
    return this.withStorage(async () => (await this.read()).events);
  }

  async readEvent(eventId: string): Promise<CodexBridgeTerminalEvent | null> {
    return this.withStorage(async () => (await this.read()).events.find((event) => event.eventId === eventId) ?? null);
  }

  rebindOwner(
    identity: Readonly<{ connectionId: string; targetId: string; conversationId: string }>,
    owner: CodexBridgeWatchOwnerMute,
  ): Promise<void> {
    return this.mutate((items, events) => {
      const matches = (record: { connectionId: string; targetId: string; ownerConversationId?: string }) =>
        record.connectionId === identity.connectionId && record.targetId === identity.targetId
        && record.ownerConversationId === identity.conversationId;
      return {
        items: items.map((item) => matches(item) ? { ...item, ...owner } : item),
        events: events.map((event) => matches(event) ? { ...event, ...owner } : event),
        result: undefined,
      };
    });
  }

  mutate<T>(mutation: Mutation<T>): Promise<T> {
    return this.withStorage(async () => {
      const current = await this.read();
      const changed = mutation([...current.items], [...current.events]);
      await this.area.set({ [CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY]: {
        version: 2,
        items: changed.items.slice(0, CODEX_BRIDGE_THREAD_MONITOR_MAX_WATCHES),
        events: retainEvents(changed.events),
      } });
      return changed.result;
    });
  }

  private async read(): Promise<MonitorState> {
    const stored = await this.area.get([CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY]);
    return readState(stored[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY]);
  }

  private withStorage<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function mergeDuplicateEvent(existing: CodexBridgeTerminalEvent, candidate: CodexBridgeTerminalEvent): CodexBridgeTerminalEvent {
  const preferred = notificationStatePriority(candidate.notificationState) > notificationStatePriority(existing.notificationState)
    ? candidate : existing;
  const { ownerTabId, ownerConversationId, ownerMuted, ownerMuteRevision } = existing;
  const acknowledgedAt = existing.acknowledgedAt ?? candidate.acknowledgedAt;
  const ownerDeliveryState = existing.ownerDeliveryState === undefined || candidate.ownerDeliveryState === undefined
    ? undefined : deliveryStatePriority(candidate.ownerDeliveryState) > deliveryStatePriority(existing.ownerDeliveryState)
      ? candidate.ownerDeliveryState : existing.ownerDeliveryState;
  return {
    ...preferred,
    ...(ownerTabId !== undefined && ownerConversationId !== undefined && ownerMuted !== undefined && ownerMuteRevision !== undefined
      ? { ownerTabId, ownerConversationId, ownerMuted, ownerMuteRevision }
      : {}),
    ...(acknowledgedAt !== undefined ? { acknowledgedAt } : {}),
    ...(ownerDeliveryState !== undefined ? { ownerDeliveryState } : {}),
  };
}

function deliveryStatePriority(state: NonNullable<CodexBridgeTerminalEvent['ownerDeliveryState']>): number {
  return { pending: 0, skipped: 1, requested: 2, delivered: 3 }[state];
}

function retainEvents(events: readonly CodexBridgeTerminalEvent[]): CodexBridgeTerminalEvent[] {
  const unacknowledged = events.filter((event) => !event.acknowledgedAt);
  const confirmed = events.filter((event) => Boolean(event.acknowledgedAt));
  const retainedConfirmed = confirmed.slice(-CODEX_BRIDGE_THREAD_MONITOR_MAX_EVENTS);
  return [...unacknowledged, ...retainedConfirmed];
}

export type { LocalStorageLike, Mutation as CodexBridgeThreadMonitorMutation, MonitorState };
