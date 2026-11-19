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

export type CodexBridgeWatchSnapshot = Readonly<{
  watchId: string;
  connectionId: string;
  targetId: string;
  threadId: string;
  enabled: boolean;
  baselineCaptured: boolean;
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
  | Readonly<{ type: typeof CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH }>;

export type CodexBridgeWatchListData = Readonly<{
  items: readonly CodexBridgeWatchSnapshot[];
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
  if (!snapshot.baselineCaptured || snapshot.baselineTurnId === null
    || snapshot.lastObservedTurnId === null || snapshot.lastTurnStatus === null) return 'unknown';
  if (snapshot.statusState === 'not_loaded' || snapshot.statusState === 'unknown') return 'unknown';
  if (snapshot.turnChange === 'gap') return 'gap';
  if (snapshot.currentExecutionState === 'estimated_running') return 'unknown';

  const executionState = snapshot.currentExecutionState;
  const executionEvidence = snapshot.currentExecutionEvidence ?? '';
  if ((executionState === 'running' || executionState === 'in_progress')
    && /estimated|inferred|heuristic/i.test(executionEvidence)) return 'unknown';
  const exactRunning = executionState === 'running' || executionState === 'in_progress';
  if (exactRunning && snapshot.currentExecutionTurnId
    && snapshot.currentExecutionTurnId !== snapshot.lastObservedTurnId) return 'running';
  if (exactRunning && snapshot.currentExecutionTurnId === snapshot.lastObservedTurnId) return 'in_progress';

  if (snapshot.lastTurnStatus === 'in_progress') return 'in_progress';
  if (!['completed', 'failed', 'interrupted'].includes(snapshot.lastTurnStatus)) return 'unknown';
  if (snapshot.lastObservedTurnId !== snapshot.baselineTurnId) return snapshot.lastTurnStatus;
  if (snapshot.baselineTurnStatus === 'completed' || snapshot.baselineTurnStatus === 'failed'
    || snapshot.baselineTurnStatus === 'interrupted') return 'baseline';
  return snapshot.lastTurnStatus;
}
