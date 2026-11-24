import type { CodexBridgeTarget, CodexBridgeThreadPage } from '../shared/codexbridge-mcp-protocol.ts';
import type { CodexBridgeRunningSnapshot, CodexBridgeReadPriority } from './codexbridge-read-service.ts';
import type { CodexBridgeMonitorAccess, CodexBridgeThreadMonitor } from './thread-monitor.ts';

type Access = Pick<CodexBridgeMonitorAccess, 'connectionId' | 'generation' | 'readsScheduled' | 'readTargets'
  | 'readRunningThreads' | 'readRunningSnapshot' | 'isCurrent'>;
type Monitor = Pick<CodexBridgeThreadMonitor, 'scheduleTargetRequest'>;
type Options = Readonly<{ priority: CodexBridgeReadPriority; maxAgeMs: number; force?: boolean }>;

function invalid(reason: string): Error {
  return Object.assign(new Error(reason), { code: reason });
}

export async function readFreshRunningPage(access: Access, monitor: Monitor, targetId: string,
  options: Options): Promise<CodexBridgeThreadPage> {
  if (!access.readTargets) throw invalid('readonly-tool-unavailable');
  const read = async () => {
    const targets: readonly CodexBridgeTarget[] = await access.readTargets!(options.priority);
    if (!targets.some((target) => target.id === targetId && target.available !== false)) {
      throw invalid('target-unavailable');
    }
    if (access.readRunningSnapshot) {
      const snapshot: CodexBridgeRunningSnapshot = await access.readRunningSnapshot(targetId, options);
      if (!snapshot.ok) throw invalid(snapshot.reason);
      if (snapshot.connectionId !== access.connectionId || (access.generation !== undefined
        && snapshot.generation !== access.generation)) throw invalid('connection-changed');
      if (snapshot.freshness !== 'fresh') throw invalid(snapshot.failureReason ?? 'timeout');
      return snapshot.page;
    }
    if (!access.readRunningThreads) throw invalid('readonly-tool-unavailable');
    return access.readRunningThreads(targetId);
  };
  const page = access.readsScheduled ? await read() : await monitor.scheduleTargetRequest(targetId, read);
  if (access.isCurrent && !access.isCurrent()) throw invalid('connection-changed');
  if (!page || page.nextCursor !== null || !Array.isArray(page.threads) || page.threads.length > 1_000) {
    throw invalid('protocol-error');
  }
  return page;
}
