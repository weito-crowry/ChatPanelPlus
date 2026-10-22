import { codePointLength, type StatisticsObservation } from '../shared/conversation-statistics.ts';

const TURN_SELECTOR = '[data-turn-key]';
const USER_SELECTOR = '[data-user-message-bubble]';
const ASSISTANT_SELECTOR = '[data-chatgpt-selection-message-id]';
const DIL_SELECTOR = '[data-dil-message-id]';
const TURN_STATE_SELECTOR = '[data-talvt-turn-state]';
const HIDDEN_SELECTOR = '[hidden],[aria-hidden="true"],[style]';
const OMIT_SELECTOR = 'button,[role="button"],[role="toolbar"],[aria-hidden="true"],svg,img,video,audio,canvas,iframe,input,textarea,[contenteditable="true"],[data-testid*="attachment"],[data-message-attachment]';

export type AssistantTurnState = 'complete' | 'in_progress' | 'unknown';

export interface ConversationDomSnapshot {
  readonly turnKeys: readonly string[];
  readonly observations: readonly StatisticsObservation[];
  readonly partial: boolean;
}

export interface TurnIdentity {
  readonly turnKey: string;
  readonly assistantMessageId?: string;
  readonly assistantState: AssistantTurnState;
}

export interface ConversationIdentitySnapshot {
  readonly turnKeys: readonly string[];
  readonly identities: readonly StatisticsObservation[];
}

function readId(element: Element, attribute: string): string | null {
  const value = element.getAttribute(attribute);
  return value && value.length <= 1_024 && value.trim() === value ? value : null;
}

function isHiddenElement(element: Element): boolean {
  if (element.getAttribute('hidden') !== null || element.getAttribute('aria-hidden') === 'true') return true;
  const style = element.getAttribute('style') ?? '';
  return /(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden)/iu.test(style);
}

function isInHiddenSubtree(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (isHiddenElement(current)) return true;
    current = current.parentElement;
  }
  return false;
}

function visibleUserBubbles(turn: Element): Element[] {
  return Array.from(turn.querySelectorAll(USER_SELECTOR)).filter((bubble) => !isInHiddenSubtree(bubble));
}

function assistantState(turn: Element): AssistantTurnState {
  const states = Array.from(turn.querySelectorAll(TURN_STATE_SELECTOR)).filter((element) => !isInHiddenSubtree(element));
  const values = [...new Set(states.map((element) => element.getAttribute('data-talvt-turn-state')))].filter((value): value is string => value !== null);
  if (values.length !== 1) return 'unknown';
  return values[0] === 'complete' || values[0] === 'in_progress' ? values[0] : 'unknown';
}

function visibleText(element: Element): string | null {
  try {
    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(OMIT_SELECTOR).forEach((child) => child.remove());
    clone.querySelectorAll(HIDDEN_SELECTOR).forEach((child) => {
      if (isHiddenElement(child)) child.remove();
    });
    if (typeof clone.innerText === 'string') return clone.innerText;
    return typeof clone.textContent === 'string' ? clone.textContent : null;
  } catch {
    return null;
  }
}

function outermost(elements: readonly Element[]): Element[] {
  return elements.filter((element) => !elements.some((other) => other !== element && other.contains(element)));
}

function readUserInput(turn: Element): number | undefined {
  const bubbles = outermost(visibleUserBubbles(turn));
  if (!bubbles.length) return undefined;
  const texts = bubbles.map(visibleText);
  if (texts.some((text) => text === null)) return undefined;
  const distinctTexts = [...new Set(texts)];
  return distinctTexts.length === 1 ? codePointLength(distinctTexts[0]!) : undefined;
}

function readAssistant(turn: Element, state: AssistantTurnState): Pick<StatisticsObservation, 'assistantMessageId' | 'outputChars'> {
  const candidates = Array.from(turn.querySelectorAll(ASSISTANT_SELECTOR)).filter((element) => !isInHiddenSubtree(element));
  const ids = [...new Set(candidates.map((element) => readId(element, 'data-chatgpt-selection-message-id')).filter((id): id is string => id !== null))];
  if (ids.length !== 1) return {};
  const assistantMessageId = ids[0]!;
  if (state !== 'complete') return { assistantMessageId };

  const selected = candidates.filter((element) => readId(element, 'data-chatgpt-selection-message-id') === assistantMessageId);
  const outputCounts = selected.map((assistant) => {
    const dil = Array.from(assistant.querySelectorAll(DIL_SELECTOR)).filter((element) => !isInHiddenSubtree(element));
    const dilIds = [...new Set(dil.map((element) => readId(element, 'data-dil-message-id')).filter((id): id is string => id !== null))];
    if (dilIds.some((id) => id !== assistantMessageId) || dilIds.length > 1) return undefined;
    const body = dilIds.length === 1
      ? dil.find((element) => readId(element, 'data-dil-message-id') === assistantMessageId)
      : assistant;
    const text = body ? visibleText(body) : null;
    return text === null || text.length === 0 ? undefined : codePointLength(text);
  });
  if (outputCounts.some((count) => count === undefined) || new Set(outputCounts).size !== 1) return { assistantMessageId };
  return { assistantMessageId, outputChars: outputCounts[0]! };
}

export function collectConversationTurnKeys(root: ParentNode): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const turn of Array.from(root.querySelectorAll(TURN_SELECTOR))) {
    const key = readId(turn, 'data-turn-key');
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

export function collectTurnKeysInSubtree(root: Element): string[] {
  const turns = root.matches(TURN_SELECTOR) ? [root] : [];
  turns.push(...Array.from(root.querySelectorAll(TURN_SELECTOR)));
  const seen = new Set<string>();
  return turns.flatMap((turn) => {
    const key = readId(turn, 'data-turn-key');
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [key];
  });
}

export function collectConversationIdentities(root: ParentNode): ConversationIdentitySnapshot {
  const turnKeys: string[] = [];
  const identities: StatisticsObservation[] = [];
  const seen = new Set<string>();
  for (const turn of Array.from(root.querySelectorAll(TURN_SELECTOR))) {
    const identity = collectTurnIdentity(turn);
    if (!identity || seen.has(identity.turnKey)) continue;
    seen.add(identity.turnKey);
    turnKeys.push(identity.turnKey);
    identities.push({
      turnKey: identity.turnKey,
      ...(identity.assistantMessageId ? { assistantMessageId: identity.assistantMessageId } : {}),
      assistantState: identity.assistantState,
    });
  }
  return { turnKeys, identities };
}

export function collectTurnIdentity(turn: Element): TurnIdentity | null {
  const turnKey = readId(turn, 'data-turn-key');
  if (!turnKey) return null;
  const ids = [...new Set(Array.from(turn.querySelectorAll(ASSISTANT_SELECTOR))
    .filter((element) => !isInHiddenSubtree(element))
    .map((element) => readId(element, 'data-chatgpt-selection-message-id'))
    .filter((id): id is string => id !== null))];
  return {
    turnKey,
    ...(ids.length === 1 ? { assistantMessageId: ids[0]! } : {}),
    assistantState: assistantState(turn),
  };
}

export function hasUserBubble(turn: Element): boolean {
  return visibleUserBubbles(turn).length > 0;
}

export function collectTurnAssistantObservation(turn: Element): StatisticsObservation | null {
  const identity = collectTurnIdentity(turn);
  if (!identity) return null;
  return {
    turnKey: identity.turnKey,
    ...readAssistant(turn, identity.assistantState),
    assistantState: identity.assistantState,
  };
}

export function collectTurnObservation(turn: Element): StatisticsObservation | null {
  const identity = collectTurnIdentity(turn);
  if (!identity) return null;
  const inputChars = readUserInput(turn);
  const assistant = readAssistant(turn, identity.assistantState);
  return {
    turnKey: identity.turnKey,
    ...(inputChars === undefined ? {} : { inputChars }),
    ...assistant,
    assistantState: identity.assistantState,
  };
}

export function findTurnElement(root: ParentNode, turnKey: string): Element | null {
  for (const turn of Array.from(root.querySelectorAll(TURN_SELECTOR))) {
    if (readId(turn, 'data-turn-key') === turnKey) return turn;
  }
  return null;
}

export function collectConversationSnapshot(root: ParentNode): ConversationDomSnapshot {
  const turnKeys: string[] = [];
  const observations: StatisticsObservation[] = [];
  let partial = false;
  const scope = root.querySelector?.('main') ?? root;
  const groups = new Map<string, Element[]>();
  for (const turn of Array.from(scope.querySelectorAll(TURN_SELECTOR))) {
    if (isInHiddenSubtree(turn)) continue;
    const key = readId(turn, 'data-turn-key');
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(turn);
    groups.set(key, group);
  }

  for (const [key, turns] of groups) {
    const candidates: StatisticsObservation[] = [];
    for (const turn of turns) {
      if (!hasUserBubble(turn)) {
        partial = true;
        continue;
      }
      const observation = collectTurnObservation(turn);
      if (observation) candidates.push(observation);
    }
    if (!candidates.length) continue;
    const distinct = new Set(candidates.map((observation) => JSON.stringify(observation)));
    if (distinct.size > 1) {
      partial = true;
      continue;
    }
    turnKeys.push(key);
    observations.push(candidates[0]!);
  }
  return { turnKeys, observations, partial };
}

export { conversationIdFromPath } from '../shared/conversation-route.ts';
