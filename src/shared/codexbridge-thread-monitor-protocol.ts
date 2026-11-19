import type { CodexBridgeLastTurn } from './codexbridge-mcp-protocol.ts';
import { parseCodexBridgeMcpEndpoint } from './codexbridge-mcp-protocol.ts';

export const CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY = 'chatPanelPlus.codexBridgeThreadMonitor.v1';
export const CODEX_BRIDGE_THREAD_MONITOR_ALARM = 'chatPanelPlus.codexBridgeThreadMonitor.poll';
export const CODEX_BRIDGE_THREAD_MONITOR_MINUTES = 0.5;
export const CODEX_BRIDGE_THREAD_MONITOR_MAX_WATCHES = 32;
export const CODEX_BRIDGE_THREAD_MONITOR_FOREGROUND_MS = 15_000;

export const CODEX_BRIDGE_WATCH_START = 'CODEX_BRIDGE_WATCH_START' as const;
export const CODEX_BRIDGE_WATCH_STOP = 'CODEX_BRIDGE_WATCH_STOP' as const;
export const CODEX_BRIDGE_WATCH_LIST = 'CODEX_BRIDGE_WATCH_LIST' as const;
export const CODEX_BRIDGE_WATCH_READ = 'CODEX_BRIDGE_WATCH_READ' as const;
export const CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH = 'CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH' as const;
export const CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER = 'CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER' as const;

export type CodexBridgeTerminalStatus = 'completed' | 'failed' | 'interrupted';
export type CodexBridgeNotificationState = 'pending' | 'requested' | 'played' | 'skipped' | 'failed';
export type CodexBridgeNotificationReason = 'disabled' | 'volume-zero' | 'settings-unavailable'
  | 'output-device-unavailable' | 'device-unavailable' | 'permission-denied' | 'sink-failed' | 'playback-failed';

export type CodexBridgeTerminalEvent = Readonly<{
  eventId: string;
  watchId: string;
  connectionId: string;
  targetId: string;
  threadId: string;
  turnId: string;
  status: CodexBridgeTerminalStatus;
  detectedAt: string;
  notificationState: CodexBridgeNotificationState;
  notificationReason: CodexBridgeNotificationReason | null;
}>;

export type CodexBridgeFinalAnswerResult =
  | Readonly<{ status: 'retrieved'; text: string; completeness: 'unconfirmed' }>
  | Readonly<{ status: 'no-final-answer'; completeness: 'unconfirmed' }>
  | Readonly<{ status: 'incomplete'; reason: 'history-too-large' | 'text-too-large' | 'malformed-history'
    | 'turn-not-found' | 'multiple-matching-turns' | 'multiple-final-answers'; completeness: 'unconfirmed' }>
  | Readonly<{ status: 'failed'; reason: 'connection-changed' | 'event-not-found' | 'authentication-required'
    | 'forbidden' | 'endpoint-not-found' | 'session-expired' | 'http-error' | 'disconnected' | 'timeout'
    | 'protocol-error' | 'protocol-version-unsupported' | 'readonly-tool-unavailable' | 'readonly-probe-failed'
    | 'permission-required' | 'settings-unavailable' | 'unknown-error' }>
  | Readonly<{ status: 'pending' }>;

export type CodexBridgeWatchFetchOutcome =
  | 'ok'
  | '401'
  | '403'
  | 'timeout'
  | 'disconnected'
  | 'unknown'
  | 'permission-required'
  | 'settings-unavailable'
  | 'endpoint-not-found'
  | 'session-expired'
  | 'http-error'
  | 'protocol-error'
  | 'protocol-version-unsupported'
  | 'readonly-tool-unavailable'
  | 'readonly-probe-failed'
  | 'connection-changed';

export type CodexBridgeWatchTurnChange = 'baseline' | 'same' | 'advanced' | 'gap' | 'unknown';
export type CodexBridgeWatchBaselineKind = 'turn' | 'none' | 'unknown';

export type CodexBridgeWatchSnapshot = Readonly<{
  watchId: string;
  connectionId: string;
  targetId: string;
  threadId: string;
  enabled: boolean;
  baselineCaptured: boolean;
  baselineTurnKind: CodexBridgeWatchBaselineKind;
  baselineTurnId: string | null;
  baselineTurnStatus: CodexBridgeLastTurn['status'];
  lastObservedTurnId: string | null;
  statusState: string | null;
  lastTurnStatus: CodexBridgeLastTurn['status'];
  lastTurnEvidence: string | null;
  currentExecutionState: string | null;
  currentExecutionEvidence: string | null;
  currentExecutionTurnId: string | null;
  needsAttention: boolean | null;
  turnChange: CodexBridgeWatchTurnChange;
  observedAt: string | null;
  lastSuccessAt: string | null;
  fetchOutcome: CodexBridgeWatchFetchOutcome;
  nextPollAt: number;
  failureCount: number;
}>;

export type CodexBridgeWatchMessage =
  | Readonly<{ type: typeof CODEX_BRIDGE_WATCH_START; targetId: string; threadId: string }>
  | Readonly<{ type: typeof CODEX_BRIDGE_WATCH_STOP; connectionId: string; targetId: string; threadId: string }>
  | Readonly<{ type: typeof CODEX_BRIDGE_WATCH_LIST }>
  | Readonly<{ type: typeof CODEX_BRIDGE_WATCH_READ; connectionId: string; targetId: string; threadId: string }>
  | Readonly<{ type: typeof CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH }>
  | Readonly<{ type: typeof CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER; eventId: string }>;

export type CodexBridgeWatchListData = Readonly<{
  items: readonly CodexBridgeWatchSnapshot[];
  events: readonly CodexBridgeTerminalEvent[];
  currentConnectionId: string | null;
}>;

export type CodexBridgeWatchResponse<T = undefined> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; reason: 'invalid-request' | 'watch-limit' | 'connection-unavailable' | 'storage-error' }>;

export function isCodexBridgeWatchFetchOutcome(value: unknown): value is CodexBridgeWatchFetchOutcome {
  return typeof value === 'string' && [
    'ok', '401', '403', 'timeout', 'disconnected', 'unknown', 'permission-required',
    'settings-unavailable', 'endpoint-not-found', 'session-expired', 'http-error',
    'protocol-error', 'protocol-version-unsupported', 'readonly-tool-unavailable',
    'readonly-probe-failed', 'connection-changed',
  ].includes(value);
}

export function codexBridgeWatchKey(connectionId: string, targetId: string, threadId: string): string {
  return `${connectionId}\u0000${targetId}\u0000${threadId}`;
}

export function codexBridgeTerminalEventKey(
  connectionId: string,
  targetId: string,
  threadId: string,
  turnId: string,
  status: CodexBridgeTerminalStatus,
): string {
  return `${codexBridgeWatchKey(connectionId, targetId, threadId)}\u0000${turnId}\u0000${status}`;
}

export function isCodexBridgeTerminalEvent(value: unknown): value is CodexBridgeTerminalEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return typeof event.eventId === 'string' && event.eventId.length > 0 && event.eventId.length <= 96
    && typeof event.watchId === 'string' && event.watchId.length > 0 && event.watchId.length <= 96
    && isCodexBridgeWatchIdentifier(event.connectionId) && event.connectionId.length <= 96
    && isCodexBridgeWatchIdentifier(event.targetId) && isCodexBridgeWatchIdentifier(event.threadId)
    && isCodexBridgeWatchIdentifier(event.turnId) && event.status !== null
    && ['completed', 'failed', 'interrupted'].includes(String(event.status))
    && typeof event.detectedAt === 'string' && event.detectedAt.length <= 40
    && ['pending', 'requested', 'played', 'skipped', 'failed'].includes(String(event.notificationState))
    && (event.notificationReason === null || ['disabled', 'volume-zero', 'settings-unavailable',
      'output-device-unavailable', 'device-unavailable', 'permission-denied', 'sink-failed', 'playback-failed']
      .includes(String(event.notificationReason)));
}

export function isCodexBridgeWatchIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    && value.trim() === value
    && !Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    });
}

export async function createCodexBridgeConnectionId(endpointValue: string): Promise<string | null> {
  const endpoint = parseCodexBridgeMcpEndpoint(endpointValue);
  if (!endpoint || !globalThis.crypto?.subtle) return null;
  const normalized = new URL(endpoint.url);
  normalized.searchParams.sort();
  const credentialName = /token|secret|password|credential|authorization|api[_-]?key|access[_-]?key|^key$|^auth$/i;
  for (const key of [...normalized.searchParams.keys()]) {
    if (credentialName.test(key)) normalized.searchParams.delete(key);
  }
  const canonical = `${normalized.origin}${normalized.pathname}${normalized.search}`;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

export function deriveCodexBridgeWatchTurnState(snapshot: CodexBridgeWatchSnapshot):
  | 'unknown' | 'baseline' | 'running' | 'in_progress' | 'completed' | 'failed' | 'interrupted' | 'gap' {
  if (snapshot.fetchOutcome !== 'ok') return 'unknown';
  if (!snapshot.baselineCaptured) return 'unknown';
  if (snapshot.statusState === 'not_loaded' || snapshot.statusState === 'unknown') return 'unknown';
  if (snapshot.currentExecutionState === 'estimated_running') return 'unknown';

  const executionState = snapshot.currentExecutionState;
  const executionActive = executionState === 'running' || executionState === 'in_progress';
  const executionEvidence = snapshot.currentExecutionEvidence?.toLowerCase() ?? '';
  if (executionActive) {
    if (executionEvidence !== 'live' || !snapshot.currentExecutionTurnId) return 'unknown';
    if (snapshot.currentExecutionTurnId !== snapshot.lastObservedTurnId) return 'running';
    if (snapshot.turnChange === 'gap') return 'gap';
    return 'in_progress';
  }
  if (snapshot.currentExecutionTurnId
    && snapshot.currentExecutionTurnId !== snapshot.lastObservedTurnId) return 'unknown';
  if (snapshot.turnChange === 'gap') return 'gap';

  if (snapshot.baselineTurnKind === 'none' && snapshot.turnChange === 'baseline'
    && snapshot.lastObservedTurnId === null && snapshot.lastTurnStatus === null) return 'baseline';
  if (snapshot.lastTurnStatus === null) return 'unknown';
  if (snapshot.lastTurnStatus === 'in_progress') return 'in_progress';
  if (!['completed', 'failed', 'interrupted'].includes(snapshot.lastTurnStatus)) return 'unknown';
  if (snapshot.baselineTurnKind === 'unknown' || snapshot.lastObservedTurnId === null) return 'unknown';
  if (snapshot.baselineTurnKind === 'none') {
    return snapshot.turnChange === 'advanced' || snapshot.turnChange === 'same'
      ? snapshot.lastTurnStatus : 'unknown';
  }
  if (snapshot.lastObservedTurnId !== snapshot.baselineTurnId) return snapshot.lastTurnStatus;
  if (snapshot.baselineTurnStatus === 'completed' || snapshot.baselineTurnStatus === 'failed'
    || snapshot.baselineTurnStatus === 'interrupted') return 'baseline';
  return snapshot.lastTurnStatus;
}
