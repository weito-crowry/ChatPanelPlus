import {
  type CodexBridgeTerminalStatus,
  type CodexBridgeTerminalHoldReason,
  type CodexBridgeWatchSnapshot,
} from '../shared/codexbridge-thread-monitor-protocol.ts';

const TERMINAL_STATUSES = ['completed', 'failed', 'interrupted'] as const;

function isTerminalStatus(value: string | null): value is CodexBridgeTerminalStatus {
  return value !== null && TERMINAL_STATUSES.includes(value as CodexBridgeTerminalStatus);
}

function isSameWatch(previous: CodexBridgeWatchSnapshot, current: CodexBridgeWatchSnapshot): boolean {
  return previous.enabled && current.enabled && previous.watchId === current.watchId
    && previous.connectionId === current.connectionId && previous.targetId === current.targetId
    && previous.threadId === current.threadId && previous.baselineCaptured && current.baselineCaptured
    && previous.baselineTurnKind === current.baselineTurnKind
    && previous.baselineTurnId === current.baselineTurnId
    && previous.baselineTurnStatus === current.baselineTurnStatus;
}

function hasConfirmedPostRegistrationTurn(snapshot: CodexBridgeWatchSnapshot): boolean {
  if (!snapshot.baselineCaptured || snapshot.lastObservedTurnId === null) return false;
  if (snapshot.baselineTurnKind === 'none') return true;
  if (snapshot.baselineTurnKind !== 'turn' || snapshot.baselineTurnId === null) return false;
  if (snapshot.lastObservedTurnId !== snapshot.baselineTurnId) return true;
  return snapshot.baselineTurnStatus === 'in_progress';
}

function executionHoldReason(snapshot: CodexBridgeWatchSnapshot): CodexBridgeTerminalHoldReason | null {
  const executionState = snapshot.currentExecutionState?.toLowerCase() ?? null;
  const executionEvidence = snapshot.currentExecutionEvidence?.toLowerCase() ?? null;
  const unconfirmedExecution = executionState === 'unknown'
    && executionEvidence === 'inferred'
    && snapshot.currentExecutionReason?.toLowerCase() === 'execution_unconfirmed';

  if (executionState === 'running' || executionState === 'in_progress') return 'thread-still-active';
  if (executionState === 'not_loaded' || executionState === 'estimated_running') return 'execution-evidence-unconfirmed';
  if (executionState === 'unknown' && !unconfirmedExecution) return 'execution-evidence-unconfirmed';
  if (snapshot.currentExecutionTurnId !== null && snapshot.currentExecutionTurnId !== snapshot.lastObservedTurnId) {
    return 'execution-evidence-unconfirmed';
  }
  if (!unconfirmedExecution) {
    if (snapshot.currentExecutionTurnId !== null && executionState === null) return 'execution-evidence-unconfirmed';
    if (snapshot.currentExecutionState !== null && executionEvidence !== 'live') return 'execution-evidence-unconfirmed';
    if (snapshot.currentExecutionState === null && snapshot.currentExecutionEvidence !== null && executionEvidence !== 'live') {
      return 'execution-evidence-unconfirmed';
    }
  }
  return null;
}

function hasObservationGap(
  previous: CodexBridgeWatchSnapshot,
  current: CodexBridgeWatchSnapshot,
  gapThresholdMs: number,
): boolean {
  const previousSuccess = previous.lastSuccessAt === null ? NaN : Date.parse(previous.lastSuccessAt);
  const currentSuccess = current.lastSuccessAt === null ? NaN : Date.parse(current.lastSuccessAt);
  return !Number.isFinite(previousSuccess) || !Number.isFinite(currentSuccess)
    || currentSuccess < previousSuccess || currentSuccess - previousSuccess >= gapThresholdMs;
}

export function detectCodexBridgeTerminalStatus(
  previous: CodexBridgeWatchSnapshot,
  current: CodexBridgeWatchSnapshot,
): CodexBridgeTerminalStatus | null {
  if (!isSameWatch(previous, current) || current.fetchOutcome !== 'ok'
    || current.statusState === 'unknown' || current.statusState === 'not_loaded'
    || current.statusState === 'estimated_running' || current.statusState === 'running' || current.statusState === 'in_progress'
    || current.lastObservedTurnId === null || !isTerminalStatus(current.lastTurnStatus)
    || current.lastTurnEvidence?.toLowerCase() !== 'live'
    || !hasConfirmedPostRegistrationTurn(current) || executionHoldReason(current) !== null) return null;

  return current.lastTurnStatus;
}

export function codexBridgeTerminalHoldReason(
  previous: CodexBridgeWatchSnapshot,
  current: CodexBridgeWatchSnapshot,
  gapThresholdMs = 90_000,
): CodexBridgeTerminalHoldReason | null {
  if (!current.enabled || current.fetchOutcome !== 'ok' || !current.baselineCaptured
    || current.lastObservedTurnId === null || !isTerminalStatus(current.lastTurnStatus)
    || current.statusState === 'unknown' || current.statusState === 'not_loaded') return null;

  if (current.statusState === 'estimated_running' || current.statusState === 'running' || current.statusState === 'in_progress') {
    return 'thread-still-active';
  }
  if (current.lastTurnEvidence?.toLowerCase() !== 'live') return 'terminal-evidence-unconfirmed';

  const executionReason = executionHoldReason(current);
  if (executionReason) return executionReason;

  if (!isSameWatch(previous, current) || !hasConfirmedPostRegistrationTurn(current)) {
    if (previous.fetchOutcome !== 'ok') return 'previous-fetch-failed';
    if (hasObservationGap(previous, current, gapThresholdMs)) return 'observation-gap';
    return 'terminal-transition-not-confirmed';
  }
  return null;
}
