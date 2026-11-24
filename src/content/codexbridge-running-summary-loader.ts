import { CODEX_BRIDGE_MCP_GET_THREADS, type CodexBridgeThreadPage }
  from '../shared/codexbridge-mcp-protocol.ts';
import type { RunningThreadSummary } from './codexbridge-running-summary.ts';
import { isReadResponse, isRecord } from './codexbridge-list-validation.ts';

export async function fetchRunningThreadSummary(targetId: string, priority: 'foreground' | 'background' | 'manual',
  force: boolean, send: (message: unknown) => Promise<unknown>, isCurrent: () => boolean): Promise<RunningThreadSummary | null> {
  try {
    const response: unknown = await send({ type: CODEX_BRIDGE_MCP_GET_THREADS, targetId, runningOnly: true,
      refresh: force ? 'force' : 'auto', priority });
    if (!isCurrent()) return null;
    if (!isReadResponse<CodexBridgeThreadPage>(response) || !response.ok
      || !isRecord(response.data) || !Array.isArray(response.data.threads) || response.data.nextCursor !== null) {
      const reason = isReadResponse(response) && !response.ok ? response.reason : null;
      return { targetId, threads: null, status: reason === 'running-only-unsupported' ? 'unsupported' : 'error' };
    }
    const freshness = response.runningSnapshot?.freshness;
    return { targetId, threads: response.data.threads,
      status: freshness === 'fresh' ? 'ready' : freshness === 'stale' ? 'stale' : 'unknown',
      observedAt: response.runningSnapshot?.observedAt };
  } catch { return isCurrent() ? { targetId, threads: null, status: 'error' } : null; }
}
