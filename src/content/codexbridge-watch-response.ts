import {
  isCodexBridgeTerminalEvent,
  type CodexBridgeFinalAnswerResult,
  type CodexBridgeWatchListData,
  type CodexBridgeWatchSnapshot,
} from '../shared/codexbridge-thread-monitor-protocol.ts';

export type CodexBridgeWatchListFailureReason = 'sender-unverified' | 'storage-error' | 'invalid-response';
export type CodexBridgeWatchListParseResult = Readonly<{ ok: true; data: CodexBridgeWatchListData }> |
  Readonly<{ ok: false; reason: CodexBridgeWatchListFailureReason }>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWatchSnapshot(value: unknown): value is CodexBridgeWatchSnapshot {
  return isRecord(value) && typeof value.watchId === 'string' && typeof value.connectionId === 'string'
    && typeof value.targetId === 'string' && typeof value.threadId === 'string' && value.enabled === true
    && typeof value.baselineCaptured === 'boolean' && typeof value.fetchOutcome === 'string';
}

export function parseCodexBridgeWatchListResponse(value: unknown): CodexBridgeWatchListParseResult {
  if (isRecord(value) && value.ok === false) {
    if (value.reason === 'invalid-request') return { ok: false, reason: 'sender-unverified' };
    if (value.reason === 'storage-error') return { ok: false, reason: 'storage-error' };
    return { ok: false, reason: 'invalid-response' };
  }
  if (!isRecord(value) || value.ok !== true || !isRecord(value.data) || !Array.isArray(value.data.items)
    || !(typeof value.data.currentConnectionId === 'string' || value.data.currentConnectionId === null)
    || !isRecord(value.data.summary) || !Number.isSafeInteger(value.data.summary.watchingCount)
    || !Number.isSafeInteger(value.data.summary.unacknowledgedThreadCount)) {
    return { ok: false, reason: 'invalid-response' };
  }
  return {
    ok: true,
    data: {
      items: value.data.items.filter(isWatchSnapshot),
      events: Array.isArray(value.data.events) ? value.data.events.filter(isCodexBridgeTerminalEvent) : [],
      currentConnectionId: value.data.currentConnectionId,
      summary: {
        watchingCount: value.data.summary.watchingCount as number,
        unacknowledgedThreadCount: value.data.summary.unacknowledgedThreadCount as number,
      },
    },
  };
}

export function parseCodexBridgeFinalAnswer(value: unknown): CodexBridgeFinalAnswerResult | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.data)) return null;
  const data = value.data;
  if (data.status === 'retrieved' && typeof data.text === 'string' && data.text.length <= 256 * 1024
    && data.completeness === 'unconfirmed') {
    return { status: 'retrieved', text: data.text, completeness: 'unconfirmed' };
  }
  if (data.status === 'no-final-answer' && data.completeness === 'unconfirmed') {
    return { status: 'no-final-answer', completeness: 'unconfirmed' };
  }
  if (data.status === 'pending') return { status: 'pending' };
  if (data.status === 'incomplete' && ['history-too-large', 'text-too-large', 'malformed-history', 'turn-not-found',
    'multiple-matching-turns', 'multiple-final-answers'].includes(String(data.reason))
    && data.completeness === 'unconfirmed') {
    return { status: 'incomplete', reason: data.reason as Extract<CodexBridgeFinalAnswerResult, { status: 'incomplete' }>['reason'], completeness: 'unconfirmed' };
  }
  if (data.status === 'failed' && ['connection-changed', 'event-not-found', 'authentication-required', 'forbidden',
    'endpoint-not-found', 'session-expired', 'http-error', 'disconnected', 'timeout', 'protocol-error',
    'protocol-version-unsupported', 'readonly-tool-unavailable', 'readonly-probe-failed', 'permission-required',
    'settings-unavailable', 'unknown-error'].includes(String(data.reason))) {
    return { status: 'failed', reason: data.reason as Extract<CodexBridgeFinalAnswerResult, { status: 'failed' }>['reason'] };
  }
  return null;
}
