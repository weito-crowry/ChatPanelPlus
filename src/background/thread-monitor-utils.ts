import type {
  CodexBridgeWatchFetchOutcome,
  CodexBridgeWatchSnapshot,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeThreadStatus } from '../shared/codexbridge-mcp-protocol.ts';

export function mapMonitorError(error: unknown): CodexBridgeWatchFetchOutcome {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    switch (error.code) {
      case 'authentication-required': return '401';
      case 'forbidden': return '403';
      case 'timeout': return 'timeout';
      case 'disconnected': return 'disconnected';
      case 'endpoint-not-found': return 'endpoint-not-found';
      case 'session-expired': return 'session-expired';
      case 'http-error': return 'http-error';
      case 'protocol-version-unsupported': return 'protocol-version-unsupported';
      case 'readonly-tool-unavailable': return 'readonly-tool-unavailable';
      case 'readonly-probe-failed': return 'readonly-probe-failed';
      case 'running-only-unsupported': return 'running-only-unsupported';
      case 'protocol-error': return 'protocol-error';
    }
  }
  return 'unknown';
}

export function monitorTimestamp(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function statusEvidence(status: CodexBridgeThreadStatus): Omit<CodexBridgeWatchSnapshot,
  'watchId' | 'connectionId' | 'targetId' | 'threadId' | 'enabled' | 'baselineCaptured' | 'baselineTurnKind' | 'baselineTurnId'
  | 'baselineTurnStatus' | 'lastObservedTurnId' | 'turnChange' | 'observedAt' | 'lastSuccessAt' | 'fetchOutcome' | 'nextPollAt' | 'failureCount'> {
  return {
    statusState: status.state,
    lastTurnStatus: status.lastTurn?.status ?? null,
    lastTurnEvidence: status.lastTurn?.evidence ?? null,
    currentExecutionState: status.currentExecution?.state ?? null,
    currentExecutionEvidence: status.currentExecution?.evidence ?? null,
    currentExecutionReason: status.currentExecution?.reason ?? null,
    currentExecutionTurnId: status.currentExecution?.turnId ?? null,
    needsAttention: status.needsAttention,
  };
}
