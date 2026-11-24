import type { CodexBridgeWatchSnapshot } from '../shared/codexbridge-thread-monitor-protocol.ts';

type Cadence = 'foreground' | 'background';

export function selectDueWatchPolls(items: readonly CodexBridgeWatchSnapshot[], connectionId: string, now: number,
  cadence: Cadence, force: boolean, limit: number, foregroundInterval: number) {
  const interval = cadence === 'foreground' ? foregroundInterval : 30_000;
  const candidates = items.filter((item) => {
    if (!item.enabled || item.connectionId !== connectionId) return false;
    if (force || item.nextPollAt <= now) return true;
    return cadence === 'foreground' && item.fetchOutcome === 'ok' && item.lastSuccessAt !== null
      && Date.parse(item.lastSuccessAt) + foregroundInterval <= now;
  }).sort((left, right) => left.nextPollAt - right.nextPollAt
    || (left.lastSuccessAt ?? '').localeCompare(right.lastSuccessAt ?? ''));
  const perTarget = new Map<string, number>();
  const due: CodexBridgeWatchSnapshot[] = [];
  for (const item of candidates) {
    const count = perTarget.get(item.targetId) ?? 0;
    if (count >= 3) continue;
    perTarget.set(item.targetId, count + 1);
    due.push(item);
    if (due.length >= limit) break;
  }
  return { interval, due };
}
