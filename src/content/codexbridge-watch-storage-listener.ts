import { CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY } from '../shared/codexbridge-thread-monitor-protocol.ts';
import { conversationIdFromPath } from '../shared/conversation-route.ts';
import type { CodexBridgeWatchAdditionObserver, CodexBridgeWatchAdditionSignal } from './codexbridge-watch-addition-observer.ts';

type WatchStorageListenerOptions = Readonly<{
  getOwnerConversationId: () => string | null;
  getPathname: () => string;
  observer: Pick<CodexBridgeWatchAdditionObserver, 'observeStorageChange'>;
  pending: Map<string, CodexBridgeWatchAdditionSignal>;
  refresh: () => void;
}>;

export function subscribeCodexBridgeWatchStorageChanges(options: WatchStorageListenerOptions): () => void {
  const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local') return;
    const change = changes[CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY];
    if (!change) return;
    const ownerConversationId = options.getOwnerConversationId();
    if (ownerConversationId && conversationIdFromPath(options.getPathname()) === ownerConversationId) {
      for (const addition of options.observer.observeStorageChange(ownerConversationId, change.oldValue, change.newValue)) {
        options.pending.set(`${addition.connectionId}\u0000${addition.targetId}\u0000${addition.threadId}\u0000${addition.watchId}`, addition);
      }
    }
    options.refresh();
  };
  chrome.storage.onChanged.addListener(onStorageChanged);
  return () => chrome.storage.onChanged.removeListener(onStorageChanged);
}
