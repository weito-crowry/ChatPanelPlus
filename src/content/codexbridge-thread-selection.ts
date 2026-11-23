import type { CodexBridgeThread } from '../shared/codexbridge-mcp-protocol.ts';

export type CodexBridgeSelectionUpdate = Readonly<{ thread: CodexBridgeThread; missing: boolean }>;

export function reconcileCodexBridgeThreadSelection(
  selected: CodexBridgeThread | null,
  updated: readonly CodexBridgeThread[],
  loadMore: boolean,
): CodexBridgeSelectionUpdate | null {
  if (!selected) return null;
  const match = updated.find((thread) => thread.targetId === selected.targetId && thread.id === selected.id);
  if (match) return { thread: match, missing: false };
  return loadMore ? null : { thread: selected, missing: true };
}
