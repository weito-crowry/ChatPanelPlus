import type { CodexBridgeLastTurn, CodexBridgeObservation } from './codexbridge-mcp-protocol.ts';
import { parseCodexBridgeMcpEndpoint } from './codexbridge-mcp-protocol.ts';
import { isConversationId } from './conversation-route.ts';

export const CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY = 'chatPanelPlus.codexBridgeThreadMonitor.v1';
export const CODEX_BRIDGE_THREAD_MONITOR_ALARM = 'chatPanelPlus.codexBridgeThreadMonitor.poll';
export const CODEX_BRIDGE_THREAD_MONITOR_MINUTES = 0.5;
export const CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY = 'chatPanelPlus.codexBridgeAutoWatch.v1';
export const CODEX_BRIDGE_AUTO_WATCH_ALARM = 'chatPanelPlus.codexBridgeAutoWatch.poll';
export const CODEX_BRIDGE_AUTO_WATCH_THREAD_IDS_LIMIT = 32;
export const CODEX_BRIDGE_AUTO_WATCH_BRIDGE_CANDIDATE_IDS_LIMIT = 1_000;
export const CODEX_BRIDGE_AUTO_WATCH_BRIDGE_CANDIDATE_CHARS_LIMIT = 65_536;
export const CODEX_BRIDGE_THREAD_MONITOR_MAX_WATCHES = 32;
export const CODEX_BRIDGE_THREAD_MONITOR_FOREGROUND_MS = 5_000;
export const CODEX_BRIDGE_WATCH_ACK_EVENT_IDS_LIMIT = 128;
export const CODEX_BRIDGE_FINAL_ANSWER_REASON_MAX_LENGTH = 128;

export const CODEX_BRIDGE_WATCH_START = 'CODEX_BRIDGE_WATCH_START' as const;
export const CODEX_BRIDGE_WATCH_STOP = 'CODEX_BRIDGE_WATCH_STOP' as const;
export const CODEX_BRIDGE_WATCH_LIST = 'CODEX_BRIDGE_WATCH_LIST' as const;
export const CODEX_BRIDGE_WATCH_READ = 'CODEX_BRIDGE_WATCH_READ' as const;
export const CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH = 'CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH' as const;
export const CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER = 'CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER' as const;
export const CODEX_BRIDGE_TERMINAL_EVENT_SAVED = 'CODEX_BRIDGE_TERMINAL_EVENT_SAVED' as const;
export const CODEX_BRIDGE_WATCH_ACK_EVENTS = 'CODEX_BRIDGE_WATCH_ACK_EVENTS' as const;
export const CODEX_BRIDGE_WATCH_CLEAR_EVENTS = 'CODEX_BRIDGE_WATCH_CLEAR_EVENTS' as const;
export const CODEX_BRIDGE_AUTO_WATCH_GET = 'CODEX_BRIDGE_AUTO_WATCH_GET' as const;
export const CODEX_BRIDGE_AUTO_WATCH_SET = 'CODEX_BRIDGE_AUTO_WATCH_SET' as const;
export const CODEX_BRIDGE_AUTO_WATCH_GET_RUNNING_CANDIDATES = 'CODEX_BRIDGE_AUTO_WATCH_GET_RUNNING_CANDIDATES' as const;
export const CODEX_BRIDGE_AUTO_WATCH_COMPLETED = 'CODEX_BRIDGE_AUTO_WATCH_COMPLETED' as const;

export type CodexBridgeTerminalStatus = 'completed' | 'failed' | 'interrupted';
export type CodexBridgeNotificationState = 'pending' | 'requested' | 'played' | 'skipped' | 'failed';
export type CodexBridgeNotificationReason = 'disabled' | 'volume-zero' | 'settings-unavailable'
  | 'output-device-unavailable' | 'device-unavailable' | 'permission-denied' | 'sink-failed' | 'playback-failed'
  | 'muted' | 'owner-unavailable' | 'partial-output';
export type CodexBridgeOwnerDeliveryState = 'pending' | 'requested' | 'delivered' | 'skipped';

export type CodexBridgeWatchOwnerMute = Readonly<{
  ownerTabId: number;
  ownerConversationId: string;
  ownerMuted: boolean | null;
  ownerMuteRevision: number;
}>;

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
  ownerTabId?: number;
  ownerConversationId?: string;
  ownerMuted?: boolean | null;
  ownerMuteRevision?: number;
  ownerDeliveryState?: CodexBridgeOwnerDeliveryState;
  acknowledgedAt?: string | null;
}>;

export type CodexBridgeFinalAnswerResult =
  | Readonly<{ status: 'retrieved'; text: string; completeness: 'confirmed' | 'unconfirmed' }>
  | Readonly<{ status: 'no-final-answer'; completeness: 'unconfirmed' }>
  | Readonly<{ status: 'incomplete'; reason: string; completeness: 'unconfirmed' }>
  | Readonly<{ status: 'unavailable'; reason: string }>
  | Readonly<{ status: 'failed'; reason: 'connection-changed' | 'event-not-found' | 'authentication-required'
    | 'forbidden' | 'endpoint-not-found' | 'session-expired' | 'http-error' | 'disconnected' | 'timeout'
    | 'protocol-error' | 'protocol-version-unsupported' | 'readonly-tool-unavailable' | 'readonly-probe-failed'
    | 'permission-required' | 'settings-unavailable' | 'unknown-error' }>
  | Readonly<{ status: 'pending'; reason?: string }>;

export function isCodexBridgeFinalAnswerReason(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= CODEX_BRIDGE_FINAL_ANSWER_REASON_MAX_LENGTH
    && /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(value);
}

export type CodexBridgeWatchFetchOutcome =
  | 'ok'
  | '401'
  | '403'
  | 'authentication-required'
  | 'forbidden'
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
  | 'running-only-unsupported'
  | 'connection-changed'
  | 'invalid-endpoint'
  | 'read-queue-full'
  | 'storage-error'
  | 'response-too-large'
  | 'unknown-error';

export type CodexBridgeAutoWatchFailure = CodexBridgeWatchFetchOutcome
  | 'connection-unavailable' | 'target-unavailable' | 'owner-conflict' | 'ownerless-watch' | 'watch-limit' | 'owner-tab-unavailable'
  | 'auto-owner-conflict' | 'owner-recovering' | 'storage-error';

export type CodexBridgeAutoWatchStatus = Readonly<{
  targetId: string;
  connectionId: string | null;
  enabled: boolean;
  ownerConversationId: string | null;
  state: 'off' | 'ready' | 'error' | 'conflict' | 'recovering';
  failure: CodexBridgeAutoWatchFailure | null;
  watchingThreadCount: number;
}>;

export type CodexBridgeWatchTurnChange = 'baseline' | 'same' | 'advanced' | 'gap' | 'unknown';
export type CodexBridgeWatchBaselineKind = 'turn' | 'none' | 'unknown';
export type CodexBridgeTerminalHoldReason = 'previous-fetch-failed' | 'observation-gap' | 'thread-still-active'
  | 'terminal-evidence-unconfirmed' | 'execution-evidence-unconfirmed' | 'terminal-transition-not-confirmed';

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
  currentExecutionReason?: string | null;
  currentExecutionTurnId: string | null;
  terminalHoldReason?: CodexBridgeTerminalHoldReason | null;
  needsAttention: boolean | null;
  turnChange: CodexBridgeWatchTurnChange;
  observedAt: string | null;
  lastSuccessAt: string | null;
  fetchOutcome: CodexBridgeWatchFetchOutcome;
  nextPollAt: number;
  failureCount: number;
  ownerTabId?: number;
  ownerConversationId?: string;
  ownerMuted?: boolean | null;
  ownerMuteRevision?: number;
}>;

export type CodexBridgeWatchMessage =
  | Readonly<{ type: typeof CODEX_BRIDGE_WATCH_START; targetId: string; threadId: string; conversationId: string }>
  | Readonly<{ type: typeof CODEX_BRIDGE_WATCH_STOP; connectionId: string; targetId: string; threadId: string }>
  | Readonly<{ type: typeof CODEX_BRIDGE_WATCH_LIST }>
  | Readonly<{ type: typeof CODEX_BRIDGE_WATCH_READ; connectionId: string; targetId: string; threadId: string }>
  | Readonly<{ type: typeof CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH }>
  | Readonly<{ type: typeof CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER; eventId: string }>
  | Readonly<{ type: typeof CODEX_BRIDGE_WATCH_ACK_EVENTS; conversationId: string; eventIds: readonly string[] }>
  | Readonly<{ type: typeof CODEX_BRIDGE_WATCH_CLEAR_EVENTS; conversationId: string; eventIds: readonly string[] }>;

export type CodexBridgeTerminalEventSavedMessage = Readonly<{
  type: typeof CODEX_BRIDGE_TERMINAL_EVENT_SAVED;
  eventId: string;
  ownerConversationId: string;
  detectedAt: string;
}>;

export function isCodexBridgeTerminalEventSavedMessage(value: unknown): value is CodexBridgeTerminalEventSavedMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return Object.keys(message).length === 4 && message.type === CODEX_BRIDGE_TERMINAL_EVENT_SAVED
    && isCodexBridgeWatchIdentifier(message.eventId) && message.eventId.length <= 96
    && isConversationId(message.ownerConversationId)
    && typeof message.detectedAt === 'string' && message.detectedAt.length <= 40 && Number.isFinite(Date.parse(message.detectedAt));
}

export type CodexBridgeAutoWatchMessage =
  | Readonly<{ type: typeof CODEX_BRIDGE_AUTO_WATCH_GET; targetId: string; conversationId: string }>
  | Readonly<{ type: typeof CODEX_BRIDGE_AUTO_WATCH_SET; targetId: string; conversationId: string; enabled: boolean }>
  | Readonly<{ type: typeof CODEX_BRIDGE_AUTO_WATCH_GET_RUNNING_CANDIDATES; targetId: string; conversationId: string;
    turnKey: string; assistantMessageId: string }>
  | Readonly<{ type: typeof CODEX_BRIDGE_AUTO_WATCH_COMPLETED; targetId: string; candidateConnectionId: string;
    conversationId: string; turnKey: string; assistantMessageId: string; threadIds: readonly string[] }>;

export type CodexBridgeAutoWatchCompletionMessage = Extract<CodexBridgeAutoWatchMessage,
  Readonly<{ type: typeof CODEX_BRIDGE_AUTO_WATCH_COMPLETED }>>;

export type CodexBridgeAutoWatchCandidateRequest = Extract<CodexBridgeAutoWatchMessage,
  Readonly<{ type: typeof CODEX_BRIDGE_AUTO_WATCH_GET_RUNNING_CANDIDATES }>>;

export type CodexBridgeAutoWatchCandidateData = Readonly<{
  connectionId: string | null;
  threadIds: readonly string[];
}>;

export type CodexBridgeWatchListData = Readonly<{
  items: readonly CodexBridgeWatchSnapshot[];
  events: readonly CodexBridgeTerminalEvent[];
  currentConnectionId: string | null;
  summary: Readonly<{ watchingCount: number; unacknowledgedThreadCount: number }>;
}>;

export type CodexBridgeWatchResponse<T = undefined> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; reason: 'invalid-request' | 'watch-limit' | 'connection-unavailable' | 'storage-error'
    | 'owner-unavailable' | 'owner-conflict' | 'auto-owner-conflict' | 'target-unavailable'
    | CodexBridgeAutoWatchFailure }>;

export function isCodexBridgeWatchFetchOutcome(value: unknown): value is CodexBridgeWatchFetchOutcome {
  return typeof value === 'string' && [
    'ok', '401', '403', 'authentication-required', 'forbidden', 'timeout', 'disconnected', 'unknown', 'permission-required',
    'settings-unavailable', 'endpoint-not-found', 'session-expired', 'http-error',
    'protocol-error', 'protocol-version-unsupported', 'readonly-tool-unavailable',
    'readonly-probe-failed', 'running-only-unsupported', 'connection-changed', 'invalid-endpoint',
    'read-queue-full', 'storage-error', 'response-too-large', 'unknown-error',
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
): string {
  return `${codexBridgeWatchKey(connectionId, targetId, threadId)}\u0000${turnId}`;
}

export function isCodexBridgeTerminalEvent(value: unknown): value is CodexBridgeTerminalEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const hasOwner = ['ownerTabId', 'ownerConversationId', 'ownerMuted', 'ownerMuteRevision'].some((key) => key in event);
  const validOwner = !hasOwner || (Number.isSafeInteger(event.ownerTabId) && (event.ownerTabId as number) >= 0
    && isConversationId(event.ownerConversationId) && (typeof event.ownerMuted === 'boolean' || event.ownerMuted === null)
    && Number.isSafeInteger(event.ownerMuteRevision) && (event.ownerMuteRevision as number) >= 0);
  const validAcknowledgement = !('acknowledgedAt' in event) || event.acknowledgedAt === null
    || (typeof event.acknowledgedAt === 'string' && event.acknowledgedAt.length <= 40);
  const validOwnerDelivery = !('ownerDeliveryState' in event)
    || ['pending', 'requested', 'delivered', 'skipped'].includes(String(event.ownerDeliveryState));
  return validOwner && validAcknowledgement && validOwnerDelivery
    && typeof event.eventId === 'string' && event.eventId.length > 0 && event.eventId.length <= 96
    && typeof event.watchId === 'string' && event.watchId.length > 0 && event.watchId.length <= 96
    && isCodexBridgeWatchIdentifier(event.connectionId) && event.connectionId.length <= 96
    && isCodexBridgeWatchIdentifier(event.targetId) && isCodexBridgeWatchIdentifier(event.threadId)
    && isCodexBridgeWatchIdentifier(event.turnId) && event.status !== null
    && ['completed', 'failed', 'interrupted'].includes(String(event.status))
    && typeof event.detectedAt === 'string' && event.detectedAt.length <= 40
    && ['pending', 'requested', 'played', 'skipped', 'failed'].includes(String(event.notificationState))
    && (event.notificationReason === null || ['disabled', 'volume-zero', 'settings-unavailable',
      'output-device-unavailable', 'device-unavailable', 'permission-denied', 'sink-failed', 'playback-failed', 'muted', 'owner-unavailable', 'partial-output']
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

export function isCodexBridgeAutoWatchIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1_024
    && value.trim() === value
    && !Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    });
}

export function linkLiveCodexBridgeExecutionTurn(
  execution: CodexBridgeObservation | null,
  lastTurn: CodexBridgeLastTurn | null,
): CodexBridgeObservation | null {
  const state = execution?.state?.toLowerCase();
  if (!execution || execution.turnId !== null || (state !== 'in_progress' && state !== 'running')
    || execution.evidence?.toLowerCase() !== 'live' || !lastTurn?.turnId
    || !isCodexBridgeWatchIdentifier(lastTurn.turnId) || lastTurn.status !== 'in_progress'
    || lastTurn.evidence?.toLowerCase() !== 'live') return execution;
  return { ...execution, turnId: lastTurn.turnId };
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
