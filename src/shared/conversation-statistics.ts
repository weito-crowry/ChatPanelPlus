export const STATISTICS_SCHEMA_VERSION = 1;
export const STATISTICS_STORAGE_KEY = 'chatPanelPlus.statistics';
const MAX_ID_LENGTH = 1_024;
const MAX_CHARACTER_COUNT = 100_000_000;

export interface StoredTurnStatistics {
  readonly inputChars?: number;
  readonly assistantMessageId?: string;
  readonly outputChars?: number;
}

export interface StoredConversationStatistics {
  readonly turnOrder: readonly string[];
  readonly turns: Readonly<Record<string, StoredTurnStatistics>>;
}

export interface StatisticsStore {
  readonly schemaVersion: 1;
  readonly conversations: Readonly<Record<string, StoredConversationStatistics>>;
}

export interface StatisticsObservation extends StoredTurnStatistics {
  readonly turnKey: string;
  readonly assistantState?: 'complete' | 'in_progress' | 'unknown';
}

export interface ConversationStatisticsAggregate {
  readonly turns: number;
  readonly inputChars: number;
  readonly outputChars: number;
  readonly totalChars: number;
  readonly partial: boolean;
}

export type StatisticsMergeMode = 'initial' | 'automatic' | 'manual' | 'manual-recount';

export type StatisticsValidation =
  | { readonly ok: true; readonly store: StatisticsStore }
  | { readonly ok: false; readonly reason: 'corrupt-data' | 'unsupported-version' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
    && value.trim() === value && !hasControlCharacters(value);
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_CHARACTER_COUNT;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function cloneTurns(turns: Readonly<Record<string, StoredTurnStatistics>>): Record<string, StoredTurnStatistics> {
  return Object.assign(Object.create(null) as Record<string, StoredTurnStatistics>, turns);
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(isId))];
}

function mergeVisibleOrder(
  existing: readonly string[],
  visibleIds: readonly string[],
  hasStoredRows: boolean,
): string[] {
  const visible = uniqueIds(visibleIds);
  return existing.length ? [...existing] : hasStoredRows ? [] : visible;
}

function mergeManualVisibleOrder(
  existing: readonly string[],
  visibleIds: readonly string[],
  storedTurnIds: ReadonlySet<string>,
): string[] {
  const order = [...existing];
  const visible = uniqueIds(visibleIds);
  if (!visible.length) return order;
  if (!order.length) return storedTurnIds.size ? visible.filter((id) => storedTurnIds.has(id)) : visible;

  const positions = new Map(order.map((id, index) => [id, index]));
  const anchors = visible.flatMap((id, visibleIndex) => {
    const orderIndex = positions.get(id);
    return orderIndex === undefined ? [] : [{ visibleIndex, orderIndex }];
  });
  if (!anchors.length || anchors.some((anchor, index) => index > 0 && anchor.orderIndex <= anchors[index - 1]!.orderIndex)) {
    return order;
  }

  const additionsByPosition = new Map<number, string[]>();
  let anchorIndex = 0;
  let previousAnchor: (typeof anchors)[number] | undefined;
  for (let visibleIndex = 0; visibleIndex < visible.length; visibleIndex += 1) {
    const id = visible[visibleIndex]!;
    const orderIndex = positions.get(id);
    if (orderIndex !== undefined) {
      previousAnchor = anchors[anchorIndex++];
      continue;
    }
    const nextAnchor = anchors[anchorIndex];
    let insertionIndex: number | undefined;
    if (previousAnchor && nextAnchor && nextAnchor.orderIndex === previousAnchor.orderIndex + 1) {
      insertionIndex = nextAnchor.orderIndex;
    } else if (!previousAnchor && nextAnchor && nextAnchor.orderIndex === 0) {
      insertionIndex = 0;
    } else if (previousAnchor && !nextAnchor && previousAnchor.orderIndex === order.length - 1) {
      insertionIndex = order.length;
    }
    if (insertionIndex === undefined) continue;
    const additions = additionsByPosition.get(insertionIndex) ?? [];
    additions.push(id);
    additionsByPosition.set(insertionIndex, additions);
  }

  return [
    ...order.flatMap((id, index) => [...(additionsByPosition.get(index) ?? []), id]),
    ...(additionsByPosition.get(order.length) ?? []),
  ];
}

function recountVisibleOrder(existing: readonly string[], visibleIds: readonly string[]): string[] {
  const visible = uniqueIds(visibleIds);
  return visible.length ? visible : [...existing];
}

function automaticOrder(
  existing: readonly string[],
  visibleIds: readonly string[],
  newTurnKey: string | undefined,
  branchTurnKey: string | undefined,
  branchStartTurnKey: string | undefined,
  hasStoredRows: boolean,
): string[] {
  const order = [...existing];
  const visible = uniqueIds(visibleIds);
  if (branchTurnKey && order.includes(branchTurnKey)) {
    return order.slice(0, order.indexOf(branchTurnKey) + 1);
  }
  if (newTurnKey && branchStartTurnKey && order.includes(branchStartTurnKey)) {
    const targetIndex = visible.indexOf(newTurnKey);
    if (targetIndex >= 0) {
      const prefix = order.slice(0, order.indexOf(branchStartTurnKey));
      return [...prefix, ...visible.slice(targetIndex).filter((id) => !prefix.includes(id))];
    }
  }
  if (!newTurnKey || order.includes(newTurnKey)) return mergeVisibleOrder(order, visible, hasStoredRows);
  const targetIndex = visible.indexOf(newTurnKey);
  if (targetIndex < 0) return order;
  if (!order.length) return hasStoredRows ? order : visible;
  let predecessor: string | undefined;
  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    if (order.includes(visible[index]!)) {
      predecessor = visible[index];
      break;
    }
  }
  if (!predecessor) return order;
  const predecessorIndex = order.indexOf(predecessor);
  if (predecessorIndex < order.length - 1 && branchTurnKey !== newTurnKey) return order;
  return [
    ...order.slice(0, predecessorIndex + 1),
    ...visible.slice(targetIndex).filter((id) => !order.slice(0, predecessorIndex + 1).includes(id)),
  ];
}

function mergeObservation(
  previous: StoredTurnStatistics | undefined,
  observation: StatisticsObservation,
): StoredTurnStatistics {
  const next: { inputChars?: number; assistantMessageId?: string; outputChars?: number } = { ...previous };
  if (isCount(observation.inputChars)) next.inputChars = observation.inputChars;
  if (observation.assistantState === 'in_progress') {
    delete next.outputChars;
    if (isId(observation.assistantMessageId)) next.assistantMessageId = observation.assistantMessageId;
    else delete next.assistantMessageId;
  }
  if (isId(observation.assistantMessageId)) {
    if (previous?.assistantMessageId !== observation.assistantMessageId) delete next.outputChars;
    next.assistantMessageId = observation.assistantMessageId;
    if (isCount(observation.outputChars) && observation.assistantState !== 'in_progress') next.outputChars = observation.outputChars;
  }
  return next;
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((turnKey, index) => turnKey === right[index]);
}

function mergeStoredValue<T>(base: T | undefined, incoming: T | undefined, latest: T | undefined): T | undefined {
  if (incoming === base) return latest;
  if (latest === base || incoming === latest) return incoming;
  return latest;
}

function sameAssistantMeasurement(left: StoredTurnStatistics | undefined, right: StoredTurnStatistics | undefined): boolean {
  return left?.assistantMessageId === right?.assistantMessageId && left?.outputChars === right?.outputChars;
}

function mergeStoredTurn(
  base: StoredTurnStatistics | undefined,
  incoming: StoredTurnStatistics | undefined,
  latest: StoredTurnStatistics | undefined,
): StoredTurnStatistics {
  const inputChars = mergeStoredValue(base?.inputChars, incoming?.inputChars, latest?.inputChars) ?? base?.inputChars;
  let assistantMeasurement: StoredTurnStatistics | undefined;
  if (!incoming || sameAssistantMeasurement(incoming, base)) {
    assistantMeasurement = latest ?? base;
  } else if (sameAssistantMeasurement(latest, base) || sameAssistantMeasurement(incoming, latest)) {
    assistantMeasurement = incoming;
  } else {
    assistantMeasurement = latest ?? base;
  }
  return {
    ...(inputChars === undefined ? {} : { inputChars }),
    ...(assistantMeasurement?.assistantMessageId === undefined ? {} : { assistantMessageId: assistantMeasurement.assistantMessageId }),
    ...(assistantMeasurement?.outputChars === undefined ? {} : { outputChars: assistantMeasurement.outputChars }),
  };
}

export function mergeStoredConversationStatistics(
  baseline: StoredConversationStatistics | undefined,
  incoming: StoredConversationStatistics,
  latest: StoredConversationStatistics | undefined,
): StoredConversationStatistics {
  const baselineOrder = baseline?.turnOrder ?? [];
  const latestOrder = latest?.turnOrder ?? baselineOrder;
  const turnOrder = sameOrder(incoming.turnOrder, baselineOrder)
    ? latestOrder
    : sameOrder(latestOrder, baselineOrder) || sameOrder(incoming.turnOrder, latestOrder)
      ? incoming.turnOrder
      : latestOrder;
  const turnKeys = new Set([
    ...Object.keys(baseline?.turns ?? {}),
    ...Object.keys(latest?.turns ?? {}),
    ...Object.keys(incoming.turns),
  ]);
  const turns = Object.create(null) as Record<string, StoredTurnStatistics>;
  for (const turnKey of turnKeys) {
    const baselineTurn = baseline?.turns[turnKey];
    const latestTurn = latest?.turns[turnKey] ?? baselineTurn;
    turns[turnKey] = mergeStoredTurn(baselineTurn, incoming.turns[turnKey], latestTurn);
  }
  return { turnOrder: [...turnOrder], turns };
}

export function createStatisticsStore(): StatisticsStore {
  return { schemaVersion: STATISTICS_SCHEMA_VERSION, conversations: Object.create(null) as Record<string, StoredConversationStatistics> };
}

export function codePointLength(text: string): number {
  return Array.from(text).length;
}

export function aggregateConversationStatistics(
  conversation: StoredConversationStatistics | undefined,
  historyScopeConfirmed = false,
): ConversationStatisticsAggregate {
  if (!conversation) return { turns: 0, inputChars: 0, outputChars: 0, totalChars: 0, partial: true };
  const storedTurns = Object.values(conversation.turns);
  const inputChars = storedTurns.reduce((sum, turn) => sum + (turn.inputChars ?? 0), 0);
  const outputChars = storedTurns.reduce((sum, turn) => sum + (turn.outputChars ?? 0), 0);
  const turns = storedTurns.filter((turn) => turn.inputChars !== undefined).length;
  const hasIncompleteMeasurement = storedTurns.length === 0 || storedTurns.some((turn) => turn.inputChars === undefined
    || turn.assistantMessageId === undefined || turn.outputChars === undefined);
  return {
    turns,
    inputChars,
    outputChars,
    totalChars: inputChars + outputChars,
    partial: !historyScopeConfirmed || hasIncompleteMeasurement,
  };
}

export function mergeConversationStatistics(
  store: StatisticsStore,
  conversationId: string,
  visibleTurnKeys: readonly string[],
  observations: readonly StatisticsObservation[],
  mode: StatisticsMergeMode,
  newTurnKey?: string,
  branchTurnKey?: string,
  branchStartTurnKey?: string,
): StatisticsStore {
  if (!isId(conversationId)) return store;
  const previous = Object.hasOwn(store.conversations, conversationId)
    ? store.conversations[conversationId]!
    : { turnOrder: [], turns: Object.create(null) as Record<string, StoredTurnStatistics> };
  const hasStoredRows = Object.keys(previous.turns).length > 0;
  const turnOrder = mode === 'initial'
    ? mergeVisibleOrder(previous.turnOrder, visibleTurnKeys, hasStoredRows)
    : mode === 'automatic'
      ? automaticOrder(previous.turnOrder, visibleTurnKeys, newTurnKey, branchTurnKey, branchStartTurnKey, hasStoredRows)
      : mode === 'manual-recount'
        ? recountVisibleOrder(previous.turnOrder, visibleTurnKeys)
        : mergeManualVisibleOrder(previous.turnOrder, visibleTurnKeys, new Set(Object.keys(previous.turns)));
  const turns = cloneTurns(previous.turns);
  for (const turnKey of turnOrder) {
    if (!turns[turnKey]) turns[turnKey] = {};
  }
  for (const observation of observations) {
    if (!isId(observation.turnKey)) continue;
    const safeObservation = mode === 'initial' ? {
      turnKey: observation.turnKey,
      ...(isId(observation.assistantMessageId) ? { assistantMessageId: observation.assistantMessageId } : {}),
      ...(observation.assistantState ? { assistantState: observation.assistantState } : {}),
    } : observation;
    turns[observation.turnKey] = mergeObservation(turns[observation.turnKey], safeObservation);
  }
  const conversation = { turnOrder, turns };
  const conversations = Object.assign(
    Object.create(null) as Record<string, StoredConversationStatistics>,
    store.conversations,
  );
  conversations[conversationId] = conversation;
  return {
    schemaVersion: STATISTICS_SCHEMA_VERSION,
    conversations,
  };
}

export function validateStatisticsStore(value: unknown): StatisticsValidation {
  if (!isRecord(value) || !hasOnlyKeys(value, ['schemaVersion', 'conversations'])) return { ok: false, reason: 'corrupt-data' };
  if (value.schemaVersion !== STATISTICS_SCHEMA_VERSION) return { ok: false, reason: 'unsupported-version' };
  if (!isRecord(value.conversations)) return { ok: false, reason: 'corrupt-data' };
  const conversations: Record<string, StoredConversationStatistics> = Object.create(null) as Record<string, StoredConversationStatistics>;
  for (const [conversationId, rawConversation] of Object.entries(value.conversations)) {
    if (!isId(conversationId) || !isRecord(rawConversation)
      || !hasOnlyKeys(rawConversation, ['turnOrder', 'turns'])
      || !Array.isArray(rawConversation.turnOrder) || !isRecord(rawConversation.turns)) {
      return { ok: false, reason: 'corrupt-data' };
    }
    if (!rawConversation.turnOrder.every(isId)
      || new Set(rawConversation.turnOrder).size !== rawConversation.turnOrder.length) {
      return { ok: false, reason: 'corrupt-data' };
    }
    const turns: Record<string, StoredTurnStatistics> = Object.create(null) as Record<string, StoredTurnStatistics>;
    for (const [turnKey, rawTurn] of Object.entries(rawConversation.turns)) {
      if (!isId(turnKey) || !isRecord(rawTurn)
        || !hasOnlyKeys(rawTurn, ['inputChars', 'assistantMessageId', 'outputChars'])
        || !(rawTurn.inputChars === undefined || isCount(rawTurn.inputChars))
        || !(rawTurn.assistantMessageId === undefined || isId(rawTurn.assistantMessageId))
        || !(rawTurn.outputChars === undefined || isCount(rawTurn.outputChars))
        || (rawTurn.outputChars !== undefined && rawTurn.assistantMessageId === undefined)) {
        return { ok: false, reason: 'corrupt-data' };
      }
      turns[turnKey] = {
        ...(rawTurn.inputChars === undefined ? {} : { inputChars: rawTurn.inputChars }),
        ...(rawTurn.assistantMessageId === undefined ? {} : { assistantMessageId: rawTurn.assistantMessageId }),
        ...(rawTurn.outputChars === undefined ? {} : { outputChars: rawTurn.outputChars }),
      };
    }
    if (rawConversation.turnOrder.some((id) => !(id in turns))) return { ok: false, reason: 'corrupt-data' };
    conversations[conversationId] = { turnOrder: [...rawConversation.turnOrder], turns };
  }
  return { ok: true, store: { schemaVersion: STATISTICS_SCHEMA_VERSION, conversations } };
}
