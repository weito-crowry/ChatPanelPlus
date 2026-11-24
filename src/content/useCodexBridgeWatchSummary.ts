import { useEffect, useMemo } from 'react';
import type { CodexBridgeWatchSummary, CodexBridgeWatchSummaryInput } from './codexbridge-watch-summary.ts';
import { createCodexBridgeWatchSummary } from './codexbridge-watch-summary.ts';

export function useCodexBridgeWatchSummary(
  input: CodexBridgeWatchSummaryInput,
  onChange?: (summary: CodexBridgeWatchSummary | null) => void,
): void {
  const summary = useMemo(() => createCodexBridgeWatchSummary(input), [input.conversationId, input.listConversationId,
    input.listLoading, input.listFailure, input.listFailureConversationId, input.currentConnectionId,
    input.items, input.events, input.operationBusy, input.notificationError]);
  useEffect(() => { onChange?.(summary); }, [onChange, summary]);
}
