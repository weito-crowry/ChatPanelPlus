import {
  CODEX_BRIDGE_AUTO_WATCH_REGISTRATION_REASONS,
  type CodexBridgeAutoWatchRegistrationOutcome,
} from '../shared/codexbridge-thread-monitor-protocol.ts';

const REASONS = new Set<string>(CODEX_BRIDGE_AUTO_WATCH_REGISTRATION_REASONS);
const FAILURES = new Set([
  'owner-claim-other-tab', 'owner-claim-recovering', 'owner-claim-storage-error', 'owner-state-unavailable',
  'connection-unavailable', 'connection-changed', 'generation-changed', 'owner-tab-unavailable', 'bridge-read-failed',
  'already-watching-different-owner', 'already-watching-ownerless', 'watch-limit',
  'start-watch-connection-unavailable', 'start-watch-connection-changed', 'start-watch-owner-unavailable',
  'start-watch-owner-conflict', 'start-watch-watch-limit', 'start-watch-failed',
]);

export function parseRegistrationOutcomes(value: unknown): readonly CodexBridgeAutoWatchRegistrationOutcome[] | null {
  if (!Array.isArray(value) || value.length > CODEX_BRIDGE_AUTO_WATCH_REGISTRATION_REASONS.length) return null;
  const outcomes: CodexBridgeAutoWatchRegistrationOutcome[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const outcome = item as Record<string, unknown>;
    if (Object.keys(outcome).length !== 2 || typeof outcome.reason !== 'string' || !REASONS.has(outcome.reason)
      || !Number.isSafeInteger(outcome.count) || (outcome.count as number) < 1 || (outcome.count as number) > 1_000
      || outcomes.some((previous) => previous.reason === outcome.reason)) return null;
    outcomes.push({ reason: outcome.reason as CodexBridgeAutoWatchRegistrationOutcome['reason'], count: outcome.count as number });
  }
  return outcomes;
}

export function formatRegistrationOutcomes(outcomes: readonly CodexBridgeAutoWatchRegistrationOutcome[]): string {
  return outcomes.map(({ reason, count }) => `${reason}×${count}`).join('、');
}

export function registrationOutcomesHaveFailure(outcomes: readonly CodexBridgeAutoWatchRegistrationOutcome[]): boolean {
  return outcomes.some(({ reason }) => FAILURES.has(reason));
}
