import {
  CODEX_BRIDGE_AUTO_WATCH_COMPLETED,
  CODEX_BRIDGE_AUTO_WATCH_THREAD_IDS_LIMIT,
  isCodexBridgeWatchIdentifier,
  type CodexBridgeAutoWatchCompletionMessage,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import { conversationIdFromPath, isConversationId } from '../shared/conversation-route.ts';
import type { AnswerCompletionEvent } from './answer-completion-sound.ts';
import { findUniqueTurnElement, readCompletedAssistantMessageText } from './conversation-statistics-dom.ts';

const MAX_ANSWER_TEXT_CODE_UNITS = 65_536;
const MAX_RECENT_COMPLETIONS = 256;
const BRIDGE_ID_TOKEN = /(?<![\p{L}\p{N}_-])(?:[A-Za-z0-9][A-Za-z0-9_.-]{0,95}::[A-Za-z0-9][A-Za-z0-9_.-]{0,410}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![\p{L}\p{N}_-])/giu;

export type CodexBridgeAutoWatchCompletionNotice = Readonly<{
  conversationId: string;
  turnKey: string;
  assistantMessageId: string;
  threadIds: readonly string[];
}>;

export type CodexBridgeAutoWatchCompletionResult = Readonly<{ status: 'ready'; threadIds: readonly string[] }>
  | Readonly<{ status: 'skipped'; reason: 'invalid-route' | 'dom-unavailable' | 'turn-not-unique'
    | 'answer-not-confirmed' | 'answer-too-large' | 'too-many-thread-ids' | 'no-thread-ids' | 'duplicate-event' }>;

type CompletionListener = (notice: CodexBridgeAutoWatchCompletionNotice) => void;
const listeners = new Set<CompletionListener>();
const recentCompletionKeys = new Set<string>();

export function extractCodexBridgeThreadIds(text: string):
  | Readonly<{ status: 'ok'; threadIds: readonly string[] }>
  | Readonly<{ status: 'skipped'; reason: 'answer-too-large' | 'too-many-thread-ids' }> {
  if (text.length > MAX_ANSWER_TEXT_CODE_UNITS) return { status: 'skipped', reason: 'answer-too-large' };
  const threadIds: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(BRIDGE_ID_TOKEN)) {
    const threadId = match[0].replace(/[.,;:!?]+$/u, '');
    if (!isCodexBridgeWatchIdentifier(threadId) || threadId.length > 512 || seen.has(threadId)) continue;
    seen.add(threadId);
    threadIds.push(threadId);
    if (threadIds.length > CODEX_BRIDGE_AUTO_WATCH_THREAD_IDS_LIMIT) {
      return { status: 'skipped', reason: 'too-many-thread-ids' };
    }
  }
  return { status: 'ok', threadIds };
}

export function prepareCodexBridgeAutoWatchCompletion(
  document: Document,
  pathname: string,
  event: AnswerCompletionEvent,
  conversationId: string | null,
): CodexBridgeAutoWatchCompletionResult {
  if (!conversationId || !isConversationId(conversationId) || conversationIdFromPath(pathname) !== conversationId
    || !event.turnKey || event.turnKey.length > 1_024 || event.turnKey.trim() !== event.turnKey
    || !event.assistantMessageId || event.assistantMessageId.length > 1_024
    || event.assistantMessageId.trim() !== event.assistantMessageId) return { status: 'skipped', reason: 'invalid-route' };
  const root = document.querySelector('main');
  if (!root) return { status: 'skipped', reason: 'dom-unavailable' };
  const turn = findUniqueTurnElement(root, event.turnKey);
  if (!turn) return { status: 'skipped', reason: 'turn-not-unique' };
  const text = readCompletedAssistantMessageText(turn, event.assistantMessageId);
  if (text === null) return { status: 'skipped', reason: 'answer-not-confirmed' };
  const extracted = extractCodexBridgeThreadIds(text);
  if (extracted.status === 'skipped') return extracted;
  if (!extracted.threadIds.length) return { status: 'skipped', reason: 'no-thread-ids' };
  return { status: 'ready', threadIds: extracted.threadIds };
}

export function publishCodexBridgeAutoWatchCompletion(
  document: Document,
  pathname: string,
  event: AnswerCompletionEvent,
  conversationId: string | null,
): CodexBridgeAutoWatchCompletionResult {
  const result = prepareCodexBridgeAutoWatchCompletion(document, pathname, event, conversationId);
  if (result.status !== 'ready' || !conversationId) return result;
  const key = `${conversationId}\u0000${event.assistantMessageId}`;
  if (recentCompletionKeys.has(key)) return { status: 'skipped', reason: 'duplicate-event' };
  recentCompletionKeys.add(key);
  while (recentCompletionKeys.size > MAX_RECENT_COMPLETIONS) {
    recentCompletionKeys.delete(recentCompletionKeys.values().next().value!);
  }
  const notice: CodexBridgeAutoWatchCompletionNotice = {
    conversationId, turnKey: event.turnKey, assistantMessageId: event.assistantMessageId, threadIds: result.threadIds,
  };
  for (const listener of listeners) {
    try { listener(notice); } catch { /* A completion listener must not affect answer completion or audio. */ }
  }
  return result;
}

export function subscribeCodexBridgeAutoWatchCompletion(listener: CompletionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createCodexBridgeAutoWatchCompletionMessage(
  targetId: string | null,
  conversationId: string | null,
  pathname: string,
  notice: CodexBridgeAutoWatchCompletionNotice,
): CodexBridgeAutoWatchCompletionMessage | null {
  if (!targetId || !isCodexBridgeWatchIdentifier(targetId) || targetId.length > 512
    || !conversationId || !isConversationId(conversationId) || conversationIdFromPath(pathname) !== conversationId
    || notice.conversationId !== conversationId || !notice.turnKey || notice.turnKey.length > 1_024
    || notice.turnKey.trim() !== notice.turnKey || !notice.assistantMessageId || notice.assistantMessageId.length > 1_024
    || notice.assistantMessageId.trim() !== notice.assistantMessageId || !Array.isArray(notice.threadIds)
    || notice.threadIds.length === 0 || notice.threadIds.length > CODEX_BRIDGE_AUTO_WATCH_THREAD_IDS_LIMIT
    || notice.threadIds.some((id) => !isCodexBridgeWatchIdentifier(id) || id.length > 512)
    || new Set(notice.threadIds).size !== notice.threadIds.length) return null;
  return {
    type: CODEX_BRIDGE_AUTO_WATCH_COMPLETED,
    targetId,
    conversationId,
    turnKey: notice.turnKey,
    assistantMessageId: notice.assistantMessageId,
    threadIds: [...notice.threadIds],
  };
}
