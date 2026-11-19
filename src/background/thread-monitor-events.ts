import {
  deriveCodexBridgeWatchTurnState,
  type CodexBridgeTerminalStatus,
  type CodexBridgeWatchSnapshot,
} from '../shared/codexbridge-thread-monitor-protocol.ts';

const TERMINAL_STATUSES = ['completed', 'failed', 'interrupted'] as const;

function isTerminalStatus(value: string | null): value is CodexBridgeTerminalStatus {
  return value !== null && TERMINAL_STATUSES.includes(value as CodexBridgeTerminalStatus);
}

export function detectCodexBridgeTerminalStatus(
  previous: CodexBridgeWatchSnapshot,
  current: CodexBridgeWatchSnapshot,
  gapThresholdMs = 90_000,
): CodexBridgeTerminalStatus | null {
  if (!current.enabled || previous.fetchOutcome !== 'ok' || current.fetchOutcome !== 'ok' || !current.baselineCaptured
    || current.statusState === 'unknown' || current.statusState === 'not_loaded'
    || current.statusState === 'estimated_running' || current.statusState === 'running' || current.statusState === 'in_progress'
    || current.turnChange === 'gap' || current.lastObservedTurnId === null
    || !isTerminalStatus(current.lastTurnStatus) || current.lastTurnEvidence?.toLowerCase() !== 'live') return null;

  const previousSuccess = previous.lastSuccessAt === null ? NaN : Date.parse(previous.lastSuccessAt);
  const currentSuccess = current.lastSuccessAt === null ? NaN : Date.parse(current.lastSuccessAt);
  if (!Number.isFinite(previousSuccess) || !Number.isFinite(currentSuccess)
    || currentSuccess < previousSuccess || currentSuccess - previousSuccess >= gapThresholdMs) return null;

  const executionState = current.currentExecutionState?.toLowerCase() ?? null;
  if (executionState === 'unknown' || executionState === 'not_loaded' || executionState === 'estimated_running') return null;
  if (executionState === 'running' || executionState === 'in_progress') return null;
  if (current.currentExecutionTurnId !== null && executionState === null) return null;
  if (current.currentExecutionState !== null && current.currentExecutionEvidence?.toLowerCase() !== 'live') return null;
  if (current.currentExecutionState === null && current.currentExecutionEvidence !== null
    && current.currentExecutionEvidence.toLowerCase() !== 'live') return null;

  if (deriveCodexBridgeWatchTurnState(current) !== current.lastTurnStatus) return null;
  if (current.baselineTurnKind === 'unknown') return null;

  const observedTransition = previous.lastObservedTurnId === current.lastObservedTurnId
    && previous.lastTurnStatus === 'in_progress'
    && previous.lastTurnEvidence?.toLowerCase() === 'live'
    && previous.turnChange !== 'gap'
    && current.turnChange === 'same';
  if (current.baselineTurnKind === 'none') {
    return current.turnChange === 'advanced' || observedTransition ? current.lastTurnStatus : null;
  }

  if (current.baselineTurnId === null || !isTerminalStatus(current.baselineTurnStatus)
    && current.baselineTurnStatus !== 'in_progress') return null;
  if (current.lastObservedTurnId === current.baselineTurnId) {
    return current.baselineTurnStatus === 'in_progress' && observedTransition ? current.lastTurnStatus : null;
  }
  return current.turnChange === 'advanced' || observedTransition ? current.lastTurnStatus : null;
}
