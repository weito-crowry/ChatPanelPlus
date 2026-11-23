import {
  CODEX_BRIDGE_AUTO_WATCH_BRIDGE_CANDIDATE_CHARS_LIMIT,
  CODEX_BRIDGE_AUTO_WATCH_BRIDGE_CANDIDATE_IDS_LIMIT,
  CODEX_BRIDGE_AUTO_WATCH_COMPLETED,
  CODEX_BRIDGE_AUTO_WATCH_GET_RUNNING_CANDIDATES,
  CODEX_BRIDGE_AUTO_WATCH_THREAD_IDS_LIMIT,
  isCodexBridgeAutoWatchIdentity,
  isCodexBridgeWatchIdentifier,
  type CodexBridgeAutoWatchCandidateRequest,
  type CodexBridgeAutoWatchCompletionMessage,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import { conversationIdFromPath, isConversationId } from '../shared/conversation-route.ts';
import type { AnswerCompletionEvent } from './answer-completion-sound.ts';
import { findUniqueTurnElement, readCompletedAssistantMessageText } from './conversation-statistics-dom.ts';

const MAX_ANSWER_TEXT_CODE_UNITS = 65_536;
const MAX_RECENT_COMPLETIONS = 256;
const TOKEN_CONTINUATION = /[\p{L}\p{N}\p{M}\p{Pc}\p{Cf}\p{Dash_Punctuation}._~%/\\?&#=+@:]/u;
const URL_TOKEN = /(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|www\.)[^\s<>"'`]+/giu;

export type CodexBridgeAutoWatchCompletionNotice = Readonly<{
  conversationId: string;
  turnKey: string;
  assistantMessageId: string;
}>;

export type CodexBridgeAutoWatchCompletionPublishResult = Readonly<{ status: 'ready' }>
  | Readonly<{ status: 'skipped'; reason: 'invalid-route' | 'duplicate-event' }>;

export type CodexBridgeAutoWatchMatchResult = Readonly<{ status: 'ready'; connectionId: string; threadIds: readonly string[] }>
  | Readonly<{ status: 'skipped'; reason: 'invalid-route' | 'candidate-response-invalid' | 'no-running-candidates'
    | 'dom-unavailable' | 'turn-not-unique' | 'dom-changed' | 'answer-not-confirmed' | 'answer-too-large' | 'no-matching-ids'
    | 'ambiguous-match'
    | 'too-many-matches' }>
  | Readonly<{ status: 'failed'; reason: string }>;

export type CodexBridgeAutoWatchDomContext = Readonly<{
  document: Document;
  pathname: string;
  targetId: string | null;
  conversationId: string | null;
}>;

type CompletionListener = (notice: CodexBridgeAutoWatchCompletionNotice) => void;
type CandidateSet = Readonly<{ connectionId: string | null; threadIds: readonly string[] }>;
type CompletedTurnDomGuard = Readonly<{ root: Element; turn: Element; changed: () => boolean; dispose: () => void }>;
const listeners = new Set<CompletionListener>();
const recentCompletionKeys = new Set<string>();

function validCompletionIdentity(event: AnswerCompletionEvent, conversationId: string | null): boolean {
  return Boolean(conversationId && isConversationId(conversationId)
    && isCodexBridgeAutoWatchIdentity(event.turnKey) && isCodexBridgeAutoWatchIdentity(event.assistantMessageId));
}

export function publishCodexBridgeAutoWatchCompletion(
  pathname: string,
  event: AnswerCompletionEvent,
  conversationId: string | null,
): CodexBridgeAutoWatchCompletionPublishResult {
  if (!validCompletionIdentity(event, conversationId) || conversationIdFromPath(pathname) !== conversationId) {
    return { status: 'skipped', reason: 'invalid-route' };
  }
  const key = `${conversationId}\u0000${event.turnKey}\u0000${event.assistantMessageId}`;
  if (recentCompletionKeys.has(key)) return { status: 'skipped', reason: 'duplicate-event' };
  recentCompletionKeys.add(key);
  while (recentCompletionKeys.size > MAX_RECENT_COMPLETIONS) {
    recentCompletionKeys.delete(recentCompletionKeys.values().next().value!);
  }
  const notice: CodexBridgeAutoWatchCompletionNotice = {
    conversationId: conversationId!, turnKey: event.turnKey, assistantMessageId: event.assistantMessageId,
  };
  for (const listener of listeners) {
    try { listener(notice); } catch { /* A completion listener must not affect answer completion or audio. */ }
  }
  return { status: 'ready' };
}

export function subscribeCodexBridgeAutoWatchCompletion(listener: CompletionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createCodexBridgeAutoWatchCandidatesMessage(
  targetId: string | null,
  conversationId: string | null,
  pathname: string,
  notice: CodexBridgeAutoWatchCompletionNotice,
): CodexBridgeAutoWatchCandidateRequest | null {
  if (!targetId || !isCodexBridgeWatchIdentifier(targetId) || targetId.length > 512
    || !conversationId || !isConversationId(conversationId) || conversationIdFromPath(pathname) !== conversationId
    || notice.conversationId !== conversationId || !isCodexBridgeAutoWatchIdentity(notice.turnKey)
    || !isCodexBridgeAutoWatchIdentity(notice.assistantMessageId)) return null;
  return {
    type: CODEX_BRIDGE_AUTO_WATCH_GET_RUNNING_CANDIDATES,
    targetId, conversationId, turnKey: notice.turnKey, assistantMessageId: notice.assistantMessageId,
  };
}

export function createCodexBridgeAutoWatchCompletionMessage(
  targetId: string | null,
  candidateConnectionId: string | null,
  conversationId: string | null,
  pathname: string,
  notice: CodexBridgeAutoWatchCompletionNotice,
  threadIds: readonly string[],
): CodexBridgeAutoWatchCompletionMessage | null {
  if (!targetId || !isCodexBridgeWatchIdentifier(targetId) || targetId.length > 512
    || !candidateConnectionId || !isCodexBridgeWatchIdentifier(candidateConnectionId) || candidateConnectionId.length > 96
    || !conversationId || !isConversationId(conversationId) || conversationIdFromPath(pathname) !== conversationId
    || notice.conversationId !== conversationId || !isCodexBridgeAutoWatchIdentity(notice.turnKey)
    || !isCodexBridgeAutoWatchIdentity(notice.assistantMessageId) || !Array.isArray(threadIds) || threadIds.length === 0
    || threadIds.length > CODEX_BRIDGE_AUTO_WATCH_THREAD_IDS_LIMIT
    || Array.from(threadIds).some((id) => !isCodexBridgeWatchIdentifier(id) || id.length > 512)
    || new Set(threadIds).size !== threadIds.length) return null;
  return { type: CODEX_BRIDGE_AUTO_WATCH_COMPLETED, targetId, candidateConnectionId, conversationId,
    turnKey: notice.turnKey, assistantMessageId: notice.assistantMessageId, threadIds: [...threadIds] };
}

function parseCandidateResponse(value: unknown): CandidateSet | null | Readonly<{ failed: string }> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { failed: 'runtime-unavailable' };
  const response = value as Record<string, unknown>;
  if (response.ok !== true) {
    return Object.keys(response).length === 2 && typeof response.reason === 'string' && response.reason.length <= 96
      ? { failed: response.reason } : { failed: 'runtime-unavailable' };
  }
  if (Object.keys(response).length !== 2 || typeof response.data !== 'object' || response.data === null
    || Array.isArray(response.data)) return null;
  const data = response.data as Record<string, unknown>;
  if (Object.keys(data).length !== 2 || !(data.connectionId === null
    || (isCodexBridgeWatchIdentifier(data.connectionId) && data.connectionId.length <= 96))
    || !Array.isArray(data.threadIds) || data.threadIds.length > CODEX_BRIDGE_AUTO_WATCH_BRIDGE_CANDIDATE_IDS_LIMIT
    || Array.from(data.threadIds).some((id) => !isCodexBridgeWatchIdentifier(id) || id.length > 512)
    || new Set(data.threadIds).size !== data.threadIds.length) return null;
  const ids = Array.from(data.threadIds) as string[];
  const totalCharacters = ids.reduce((total, id) => total + id.length + 1, 0);
  if (totalCharacters > CODEX_BRIDGE_AUTO_WATCH_BRIDGE_CANDIDATE_CHARS_LIMIT
    || (data.connectionId === null && ids.length > 0)) return null;
  return { connectionId: data.connectionId, threadIds: ids };
}

function createCompletedTurnDomGuard(page: CodexBridgeAutoWatchDomContext, turnKey: string): CompletedTurnDomGuard | null {
  const root = page.document.querySelector('main');
  if (!root) return null;
  const turn = findUniqueTurnElement(root, turnKey);
  if (!turn) return null;
  const Observer = page.document.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  if (typeof Observer !== 'function') return null;
  let didChange = false;
  const observer = new Observer((records) => {
    if (records.some((record) => turn.contains(record.target)
      || [...record.addedNodes, ...record.removedNodes].some((node) => node === turn
        || turn.contains(node) || node.contains(turn)))) didChange = true;
  });
  observer.observe(root, { attributes: true, childList: true, characterData: true, subtree: true });
  return {
    root, turn,
    changed: () => {
      if (observer.takeRecords?.().length) didChange = true;
      return didChange;
    },
    dispose: () => observer.disconnect(),
  };
}

function charBefore(text: string, index: number): string {
  if (index <= 0) return '';
  const last = text.charCodeAt(index - 1);
  const start = last >= 0xdc00 && last <= 0xdfff && index > 1 ? index - 2 : index - 1;
  return text.slice(start, index);
}

function charAfter(text: string, index: number): string {
  if (index >= text.length) return '';
  return String.fromCodePoint(text.codePointAt(index)!);
}

function urlRanges(text: string): readonly (readonly [number, number])[] {
  return [...text.matchAll(URL_TOKEN)].map((match) => [match.index!, match.index! + match[0].length] as const);
}

function withinUrl(ranges: readonly (readonly [number, number])[], start: number, end: number): boolean {
  return ranges.some(([from, to]) => start >= from && end <= to);
}

function isIndependentToken(text: string, start: number, end: number,
  ranges: readonly (readonly [number, number])[]): boolean {
  if (withinUrl(ranges, start, end)) return false;
  return !TOKEN_CONTINUATION.test(charBefore(text, start)) && !TOKEN_CONTINUATION.test(charAfter(text, end));
}

function aliasesForBridgeId(targetId: string, bridgeId: string): readonly string[] {
  const separator = bridgeId.indexOf('::');
  if (separator >= 0) {
    if (bridgeId.slice(0, separator) !== targetId) return [];
    const nativeId = bridgeId.slice(separator + 2);
    return nativeId ? [bridgeId, nativeId] : [];
  }
  const publicId = `${targetId}::${bridgeId}`;
  return publicId.length <= 512 ? [bridgeId, publicId] : [bridgeId];
}

export function matchKnownBridgeRunningThreadIds(
  text: string,
  targetId: string,
  bridgeThreadIds: readonly string[],
): Readonly<{ status: 'ok'; threadIds: readonly string[] }>
  | Readonly<{ status: 'skipped'; reason: 'answer-too-large' | 'too-many-matches' | 'ambiguous-match' }> {
  if (text.length > MAX_ANSWER_TEXT_CODE_UNITS) return { status: 'skipped', reason: 'answer-too-large' };
  const aliases = new Map<string, Set<string>>();
  for (const bridgeId of bridgeThreadIds) {
    if (!isCodexBridgeWatchIdentifier(bridgeId) || bridgeId.length > 512) continue;
    for (const alias of aliasesForBridgeId(targetId, bridgeId)) {
      const ids = aliases.get(alias) ?? new Set<string>();
      ids.add(bridgeId);
      aliases.set(alias, ids);
    }
  }
  const ranges = urlRanges(text);
  const matched = new Set<string>();
  const occurrences: { start: number; end: number; id: string }[] = [];
  for (const [alias, canonicalIds] of aliases) {
    if (canonicalIds.size !== 1) continue;
    let offset = 0;
    while (offset < text.length) {
      const start = text.indexOf(alias, offset);
      if (start < 0) break;
      const end = start + alias.length;
      offset = start + 1;
      if (!isIndependentToken(text, start, end, ranges)) continue;
      const id = canonicalIds.values().next().value!;
      matched.add(id);
      occurrences.push({ start, end, id });
      if (matched.size > CODEX_BRIDGE_AUTO_WATCH_THREAD_IDS_LIMIT) {
        return { status: 'skipped', reason: 'too-many-matches' };
      }
      break;
    }
  }
  occurrences.sort((left, right) => left.start - right.start || right.end - left.end);
  for (let index = 0; index < occurrences.length; index += 1) {
    const current = occurrences[index]!;
    for (let otherIndex = index + 1; otherIndex < occurrences.length
      && occurrences[otherIndex]!.start < current.end; otherIndex += 1) {
      if (occurrences[otherIndex]!.id !== current.id) return { status: 'skipped', reason: 'ambiguous-match' };
    }
  }
  return { status: 'ok', threadIds: [...matched] };
}

export async function matchCompletedAnswerAfterBridgeCandidates(
  requestCandidates: () => Promise<unknown>,
  getCurrentPage: () => CodexBridgeAutoWatchDomContext | null,
  targetId: string,
  conversationId: string,
  event: AnswerCompletionEvent,
): Promise<CodexBridgeAutoWatchMatchResult> {
  if (!isCodexBridgeWatchIdentifier(targetId) || targetId.length > 512 || !isConversationId(conversationId)
    || !validCompletionIdentity(event, conversationId)) return { status: 'skipped', reason: 'invalid-route' };
  const initialPage = getCurrentPage();
  if (!initialPage || initialPage.targetId !== targetId || initialPage.conversationId !== conversationId
    || conversationIdFromPath(initialPage.pathname) !== conversationId) return { status: 'skipped', reason: 'invalid-route' };
  const guard = createCompletedTurnDomGuard(initialPage, event.turnKey);
  try {
    let response: unknown;
    try { response = await requestCandidates(); } catch { return { status: 'failed', reason: 'runtime-unavailable' }; }
    const candidates = parseCandidateResponse(response);
    if (typeof candidates === 'object' && candidates !== null && 'failed' in candidates) {
      return { status: 'failed', reason: candidates.failed };
    }
    if (!candidates) return { status: 'skipped', reason: 'candidate-response-invalid' };
    if (!candidates.connectionId || !candidates.threadIds.length) return { status: 'skipped', reason: 'no-running-candidates' };
    const page = getCurrentPage();
    if (!page || page.targetId !== targetId || page.conversationId !== conversationId
      || conversationIdFromPath(page.pathname) !== conversationId) return { status: 'skipped', reason: 'invalid-route' };
    if (!guard) return { status: 'skipped', reason: 'dom-unavailable' };
    const root = page.document.querySelector('main');
    if (!root) return { status: 'skipped', reason: 'dom-unavailable' };
    if (guard.changed() || root !== guard.root || !guard.turn.isConnected
      || findUniqueTurnElement(root, event.turnKey) !== guard.turn) return { status: 'skipped', reason: 'dom-changed' };
    const text = readCompletedAssistantMessageText(guard.turn, event.assistantMessageId);
    if (text === null) return { status: 'skipped', reason: 'answer-not-confirmed' };
    if (text.length > MAX_ANSWER_TEXT_CODE_UNITS) return { status: 'skipped', reason: 'answer-too-large' };
    const matched = matchKnownBridgeRunningThreadIds(text, targetId, candidates.threadIds);
    if (matched.status === 'skipped') return matched;
    if (!matched.threadIds.length) return { status: 'skipped', reason: 'no-matching-ids' };
    if (guard.changed()) return { status: 'skipped', reason: 'dom-changed' };
    return { status: 'ready', connectionId: candidates.connectionId, threadIds: matched.threadIds };
  } finally {
    guard?.dispose();
  }
}
