import type { CodexBridgeFinalAnswerResult } from '../shared/codexbridge-thread-monitor-protocol.ts';

export const CODEX_BRIDGE_FINAL_ANSWER_MAX_CHARS = 256 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function incomplete(reason: Extract<CodexBridgeFinalAnswerResult, { status: 'incomplete' }>['reason']): CodexBridgeFinalAnswerResult {
  return { status: 'incomplete', reason, completeness: 'unconfirmed' };
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
