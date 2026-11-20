import type { CodexBridgeThread } from '../shared/codexbridge-mcp-protocol.ts';

export type CodexBridgeThreadsRequest = Readonly<{
  generation: number;
  targetId: string;
  cursor: string | null;
}>;

export function mergeCodexBridgeThreads(
  current: readonly CodexBridgeThread[],
  incoming: readonly CodexBridgeThread[],
): CodexBridgeThread[] {
  const merged = new Map(current.map((thread) => [`${thread.targetId}\u0000${thread.id}`, thread]));
  for (const thread of incoming) merged.set(`${thread.targetId}\u0000${thread.id}`, thread);
  return [...merged.values()];
}

export type CodexBridgeStatusRequest = Readonly<{
  generation: number;
  targetId: string;
  threadId: string;
}>;

export class CodexBridgeRequestTracker {
  private targetId = '';
  private cursor: string | null = null;
  private selectedThread: Readonly<{ targetId: string; threadId: string }> | null = null;
  private threadsGeneration = 0;
  private statusGeneration = 0;

  selectTarget(targetId: string): void {
    if (targetId === this.targetId) return;
    this.targetId = targetId;
    this.cursor = null;
    this.selectedThread = null;
    this.threadsGeneration += 1;
    this.statusGeneration += 1;
  }

  beginThreads(targetId: string, cursor: string | null = null): CodexBridgeThreadsRequest {
    if (cursor === null) this.cursor = null;
    return { generation: ++this.threadsGeneration, targetId, cursor };
  }

  isCurrentThreads(request: CodexBridgeThreadsRequest): boolean {
    return this.isLatestThreads(request)
      && request.cursor === this.cursor;
  }

  isLatestThreads(request: CodexBridgeThreadsRequest): boolean {
    return request.generation === this.threadsGeneration && request.targetId === this.targetId;
  }

  setNextCursor(request: CodexBridgeThreadsRequest, cursor: string | null): boolean {
    if (!this.isCurrentThreads(request)) return false;
    this.cursor = cursor;
    return true;
  }

  invalidateThreads(): void {
    this.cursor = null;
    this.threadsGeneration += 1;
  }

  selectThread(targetId: string, threadId: string): void {
    this.selectedThread = { targetId, threadId };
    this.statusGeneration += 1;
  }

  clearSelectedThread(): void {
    this.selectedThread = null;
    this.statusGeneration += 1;
  }

  beginStatus(targetId: string, threadId: string): CodexBridgeStatusRequest {
    return { generation: ++this.statusGeneration, targetId, threadId };
  }

  isCurrentStatus(request: CodexBridgeStatusRequest): boolean {
    return request.generation === this.statusGeneration
      && request.targetId === this.targetId
      && request.targetId === this.selectedThread?.targetId
      && request.threadId === this.selectedThread.threadId;
  }

  invalidateStatus(): void {
    this.statusGeneration += 1;
  }
}
