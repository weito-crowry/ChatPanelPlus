import {
  isCodexBridgeFinalAnswerReason,
  type CodexBridgeFinalAnswerResult,
} from '../shared/codexbridge-thread-monitor-protocol.ts';

export const CODEX_BRIDGE_FINAL_ANSWER_MAX_CHARS = 256 * 1024;
const CODEX_BRIDGE_FINAL_ANSWER_SOURCE = 'app_server.item/completed.agentMessage.phase=final_answer';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function incomplete(reason: Extract<CodexBridgeFinalAnswerResult, { status: 'incomplete' }>['reason']): CodexBridgeFinalAnswerResult {
  return { status: 'incomplete', reason, completeness: 'unconfirmed' };
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function validFinalAnswerItemId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value
    && value !== '.' && value !== '..' && !/[/\\\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value);
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function malformedDedicatedResponse(): CodexBridgeFinalAnswerResult {
  return { status: 'failed', reason: 'protocol-error' };
}

export function parseCodexBridgeFinalAnswerResponse(
  payload: Record<string, unknown>,
  expectedTargetId: string,
  expectedThreadId: string,
  expectedTurnId: string,
): CodexBridgeFinalAnswerResult {
  if (!isRecord(payload) || payload.target_id !== expectedTargetId || payload.thread_id !== expectedThreadId
    || payload.turn_id !== expectedTurnId || typeof payload.status !== 'string') {
    return malformedDedicatedResponse();
  }

  if (payload.status === 'retrieved') {
    if (!hasExactKeys(payload, ['target_id', 'thread_id', 'turn_id', 'status', 'source', 'item_id', 'text'])
      || payload.source !== CODEX_BRIDGE_FINAL_ANSWER_SOURCE || !validFinalAnswerItemId(payload.item_id)
      || typeof payload.text !== 'string' || payload.text.trim().length === 0 || hasUnpairedSurrogate(payload.text)) {
      return malformedDedicatedResponse();
    }
    if (payload.text.length > CODEX_BRIDGE_FINAL_ANSWER_MAX_CHARS) return incomplete('text-too-large');
    return { status: 'retrieved', text: payload.text, completeness: 'confirmed' };
  }

  if (!['pending', 'incomplete', 'unavailable'].includes(payload.status)
    || !hasExactKeys(payload, ['target_id', 'thread_id', 'turn_id', 'status', 'reason'])
    || !isCodexBridgeFinalAnswerReason(payload.reason)) {
    return malformedDedicatedResponse();
  }
  if (payload.status === 'pending') return { status: 'pending', reason: payload.reason };
  if (payload.status === 'incomplete') return incomplete(payload.reason);
  return { status: 'unavailable', reason: payload.reason };
}

export function parseCodexBridgeFinalAnswer(
  payload: Record<string, unknown>,
  expectedThreadId: string,
  expectedTurnId: string,
): CodexBridgeFinalAnswerResult {
  if (!isRecord(payload.thread) || payload.thread.id !== expectedThreadId || !Array.isArray(payload.thread.turns)) {
    return incomplete('malformed-history');
  }
  if (payload.thread.turns.length > 100) return incomplete('history-too-large');
  const matches = payload.thread.turns.filter((turn) => isRecord(turn) && turn.id === expectedTurnId);
  if (matches.length === 0) return incomplete('turn-not-found');
  if (matches.length !== 1) return incomplete('multiple-matching-turns');
  const turn = matches[0];
  if (!isRecord(turn) || !['completed', 'failed', 'interrupted'].includes(String(turn.status))) {
    return turn && isRecord(turn) && ['inProgress', 'in_progress'].includes(String(turn.status))
      ? { status: 'pending' } : incomplete('malformed-history');
  }
  if (!Array.isArray(turn.items)) return incomplete('malformed-history');
  if (turn.items.length > 100) return incomplete('history-too-large');

  const candidates: string[] = [];
  for (const item of turn.items) {
    if (!isRecord(item) || item.type !== 'agentMessage' || item.phase !== 'final_answer') continue;
    if (typeof item.text !== 'string') return incomplete('malformed-history');
    candidates.push(item.text);
  }
  if (candidates.length === 0) return { status: 'no-final-answer', completeness: 'unconfirmed' };
  if (candidates.length !== 1) return incomplete('multiple-final-answers');
  const text = candidates[0]!;
  if (text.length > CODEX_BRIDGE_FINAL_ANSWER_MAX_CHARS) return incomplete('text-too-large');
  return { status: 'retrieved', text, completeness: 'unconfirmed' };
}
