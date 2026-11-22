import type { CodexBridgeThread } from '../shared/codexbridge-mcp-protocol.ts';

export function codexBridgeThreadDisplayName(
  title: string | null | undefined,
  threadId: string,
): string {
  return title?.trim() || threadId;
}

export function codexBridgeWatchThreadLabel(
  candidates: readonly Pick<CodexBridgeThread, 'id' | 'targetId' | 'title'>[],
  targetId: string,
  threadId: string,
  fallbackToId: boolean,
): string {
  const candidate = candidates.find((thread) => thread.targetId === targetId && thread.id === threadId);
  if (!candidate) return fallbackToId ? threadId : '監視スレッド';
  if (fallbackToId) return codexBridgeThreadDisplayName(candidate.title, threadId);
  return candidate.title?.trim() || '表示名未取得';
}
