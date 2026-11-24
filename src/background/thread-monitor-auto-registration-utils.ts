import {
  linkLiveCodexBridgeExecutionTurn,
  isCodexBridgeWatchIdentifier,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeThread, CodexBridgeThreadStatus } from '../shared/codexbridge-mcp-protocol.ts';
import type { CodexBridgeAutoWatchFailure } from '../shared/codexbridge-thread-monitor-protocol.ts';
import { isAutoWatchFailure } from './thread-monitor-auto-registration-state.ts';

const MAX_THREAD_ID_LENGTH = 512;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function failureFor(error: unknown): CodexBridgeAutoWatchFailure {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : null;
  return code && isAutoWatchFailure(code) ? code : 'unknown';
}

export function currentExecution(thread: CodexBridgeThread) {
  return linkLiveCodexBridgeExecutionTurn(thread.currentExecution, thread.lastTurn);
}

export function isLiveCandidate(thread: CodexBridgeThread, targetId: string): boolean {
  const execution = currentExecution(thread);
  return thread.targetId === targetId && isCodexBridgeWatchIdentifier(thread.id) && execution !== null
    && (execution.state === 'in_progress' || execution.state === 'running') && execution.evidence === 'live'
    && isCodexBridgeWatchIdentifier(execution.turnId);
}

export function statusFromThread(thread: CodexBridgeThread): CodexBridgeThreadStatus {
  const execution = currentExecution(thread)!;
  const confirmedLastTurn = thread.lastTurn?.turnId === execution.turnId && thread.lastTurn.status === 'in_progress'
    && thread.lastTurn.evidence === 'live' ? thread.lastTurn : null;
  const lastTurn = confirmedLastTurn ?? {
    turnId: execution.turnId, status: 'in_progress' as const, category: null, evidence: execution.evidence,
    reason: execution.reason, observedAt: execution.observedAt, needsAttention: execution.needsAttention,
  };
  return {
    targetId: thread.targetId, threadId: thread.id, state: execution.state, currentExecution: execution,
    lastTurn, needsAttention: thread.needsAttention,
  };
}

function targetThreadSuffix(targetId: string, threadId: string): string | null {
  if (!isCodexBridgeWatchIdentifier(threadId) || threadId.length > MAX_THREAD_ID_LENGTH) return null;
  const separator = threadId.indexOf('::');
  if (separator < 0) return threadId;
  if (threadId.slice(0, separator) !== targetId) return null;
  const suffix = threadId.slice(separator + 2);
  return suffix.length > 0 ? suffix : null;
}

export function threadIdsMatch(targetId: string, candidateId: string, bridgeId: string): boolean {
  const candidate = targetThreadSuffix(targetId, candidateId);
  const returned = targetThreadSuffix(targetId, bridgeId);
  return candidate !== null && returned !== null && candidate === returned;
}
