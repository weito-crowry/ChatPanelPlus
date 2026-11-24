import { isConversationId } from '../shared/conversation-route.ts';
import {
  isCodexBridgeWatchIdentifier,
  type CodexBridgeAutoWatchFailure,
} from '../shared/codexbridge-thread-monitor-protocol.ts';

export type SkippedExecution = Readonly<{ threadId: string; turnId: string | null }>;
export type AutoEntry = Readonly<{
  connectionId: string;
  targetId: string;
  enabled: boolean;
  ownerTabId: number;
  ownerConversationId: string;
  ownerMuted: boolean | null;
  ownerMuteRevision: number;
  failure: CodexBridgeAutoWatchFailure | null;
  liveThreadCount: number | null;
  lastScannedAt: string | null;
  nextScanAt: number;
  failureCount: number;
  skippedExecutions: readonly SkippedExecution[];
}>;
export type AutoState = Readonly<{ version: 1; entries: readonly AutoEntry[] }>;

export const MAX_ENTRIES = 100;
export const MAX_SKIPS_PER_ENTRY = 256;
const MAX_RUNNING_THREADS = 1_000;
const FAILURE_REASONS: readonly CodexBridgeAutoWatchFailure[] = [
  'ok', '401', '403', 'authentication-required', 'forbidden', 'timeout', 'disconnected', 'unknown', 'permission-required', 'settings-unavailable',
  'endpoint-not-found', 'session-expired', 'http-error', 'protocol-error', 'protocol-version-unsupported',
  'readonly-tool-unavailable', 'readonly-probe-failed', 'running-only-unsupported', 'connection-changed',
  'target-unavailable', 'owner-conflict', 'ownerless-watch', 'watch-limit', 'owner-tab-unavailable', 'storage-error',
  'invalid-endpoint', 'read-queue-full', 'response-too-large', 'unknown-error',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAutoWatchFailure(value: unknown): value is CodexBridgeAutoWatchFailure {
  return typeof value === 'string' && FAILURE_REASONS.includes(value as CodexBridgeAutoWatchFailure);
}

function readEntry(value: unknown): AutoEntry | null {
  if (!isRecord(value) || Object.keys(value).length !== 13 || !isCodexBridgeWatchIdentifier(value.connectionId)
    || value.connectionId.length > 96 || !isCodexBridgeWatchIdentifier(value.targetId)
    || typeof value.enabled !== 'boolean' || !Number.isSafeInteger(value.ownerTabId) || (value.ownerTabId as number) < 0
    || !isConversationId(value.ownerConversationId)
    || (typeof value.ownerMuted !== 'boolean' && value.ownerMuted !== null)
    || !Number.isSafeInteger(value.ownerMuteRevision) || (value.ownerMuteRevision as number) < 0
    || !(value.failure === null || isAutoWatchFailure(value.failure))
    || (value.liveThreadCount !== null && (!Number.isSafeInteger(value.liveThreadCount)
      || (value.liveThreadCount as number) < 0 || (value.liveThreadCount as number) > MAX_RUNNING_THREADS))
    || (value.lastScannedAt !== null && (typeof value.lastScannedAt !== 'string' || value.lastScannedAt.length > 40))
    || !Number.isSafeInteger(value.nextScanAt) || (value.nextScanAt as number) < 0
    || !Number.isSafeInteger(value.failureCount) || (value.failureCount as number) < 0 || (value.failureCount as number) > 8
    || !Array.isArray(value.skippedExecutions) || value.skippedExecutions.length > MAX_SKIPS_PER_ENTRY) return null;
  const skips: SkippedExecution[] = [];
  for (const candidate of value.skippedExecutions) {
    if (!isRecord(candidate) || Object.keys(candidate).length !== 2 || !isCodexBridgeWatchIdentifier(candidate.threadId)
      || (candidate.turnId !== null && !isCodexBridgeWatchIdentifier(candidate.turnId))) return null;
    skips.push({ threadId: candidate.threadId, turnId: candidate.turnId as string | null });
  }
  if (new Set(skips.map(({ threadId }) => threadId)).size !== skips.length) return null;
  return { ...value, skippedExecutions: skips } as unknown as AutoEntry;
}

export function readAutoWatchState(value: unknown): AutoState | null {
  if (value === undefined) return { version: 1, entries: [] };
  if (!isRecord(value) || Object.keys(value).length !== 2 || value.version !== 1
    || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) return null;
  const entries = value.entries.map(readEntry);
  if (entries.some((entry) => entry === null)) return null;
  const validated = entries as AutoEntry[];
  const identities = new Set<string>();
  for (const entry of validated) {
    const key = `${entry.connectionId}\u0000${entry.targetId}\u0000${entry.ownerConversationId}`;
    if (identities.has(key)) return null;
    identities.add(key);
  }
  return { version: 1, entries: validated };
}
