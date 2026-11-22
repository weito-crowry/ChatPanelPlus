import type { Dispatch, SetStateAction } from 'react';
import { conversationIdFromPath } from '../shared/conversation-route.ts';
import { CODEX_BRIDGE_WATCH_STOP, type CodexBridgeWatchSnapshot } from '../shared/codexbridge-thread-monitor-protocol.ts';

type StopWatchOptions = Readonly<{
  item: CodexBridgeWatchSnapshot;
  getConversationId: () => string | null;
  getPathname: () => string;
  sendMessage: (message: unknown) => Promise<unknown>;
  refreshList: () => Promise<void>;
  setBusyKey: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
}>;

export async function stopOwnedCodexBridgeWatch(options: StopWatchOptions): Promise<void> {
  const ownerConversationId = options.getConversationId();
  if (!ownerConversationId || options.item.ownerConversationId !== ownerConversationId
    || conversationIdFromPath(options.getPathname()) !== ownerConversationId) return;
  const key = `stop:${options.item.watchId}`;
  options.setBusyKey(key);
  options.setError('');
  try {
    await options.sendMessage({
      type: CODEX_BRIDGE_WATCH_STOP, connectionId: options.item.connectionId,
      targetId: options.item.targetId, threadId: options.item.threadId,
    });
    if (options.getConversationId() !== ownerConversationId
      || conversationIdFromPath(options.getPathname()) !== ownerConversationId) return;
    await options.refreshList();
  } catch {
    if (options.getConversationId() === ownerConversationId) options.setError('監視解除: watchを解除できませんでした。');
  } finally {
    options.setBusyKey((current) => current === key ? '' : current);
  }
}
