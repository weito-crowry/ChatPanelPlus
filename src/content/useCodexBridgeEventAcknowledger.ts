import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { CODEX_BRIDGE_WATCH_ACK_EVENTS, type CodexBridgeTerminalEvent } from '../shared/codexbridge-thread-monitor-protocol.ts';
import { conversationIdFromPath } from '../shared/conversation-route.ts';
import { CodexBridgeEventAcknowledger, type CodexBridgeEventAckOwner } from './codexbridge-event-ack.ts';

type Options = Readonly<{
  events: readonly CodexBridgeTerminalEvent[];
  conversationId: string | null;
  routeGeneration: number;
  getCurrentOwner: () => CodexBridgeEventAckOwner;
  listIsCurrent: boolean;
  listLoading: boolean;
  listFailed: boolean;
  busyKey: string;
  refreshList: () => Promise<boolean>;
  setBusyKey: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotificationError: Dispatch<SetStateAction<string | null>>;
  onAcknowledgeEvents?: (handler: (() => void) | null) => void;
}>;

export function useCodexBridgeEventAcknowledger(options: Options): () => Promise<void> {
  const controller = useRef(new CodexBridgeEventAcknowledger());
  const { events, conversationId, routeGeneration, getCurrentOwner, listIsCurrent, listLoading, listFailed,
    busyKey, refreshList, setBusyKey, setError, setNotificationError, onAcknowledgeEvents } = options;

  const acknowledge = useCallback(async () => {
    if (!conversationId || conversationIdFromPath(window.location.pathname) !== conversationId || !listIsCurrent
      || listLoading || listFailed || busyKey || controller.current.isBusy) return;
    if (!events.some((event) => event.ownerConversationId === conversationId && !event.acknowledgedAt)) return;
    setBusyKey('acknowledge');
    setError('');
    setNotificationError(null);
    const isCurrent = () => {
      const owner = getCurrentOwner();
      return owner.conversationId === conversationId && owner.generation === routeGeneration
        && conversationIdFromPath(window.location.pathname) === conversationId;
    };
    try {
      const result = await controller.current.acknowledge({
        events, ownerConversationId: conversationId, ownerGeneration: routeGeneration, getCurrentOwner,
        async sendBatch(eventIds) {
          const response: unknown = await chrome.runtime.sendMessage({
            type: CODEX_BRIDGE_WATCH_ACK_EVENTS, conversationId, eventIds,
          });
          return typeof response === 'object' && response !== null && 'ok' in response && response.ok === true;
        },
      });
      if (result.status === 'empty' || result.status === 'busy' || result.status === 'cancelled' || !isCurrent()) return;
      const refreshed = await refreshList();
      if (!isCurrent()) return;
      if (!refreshed) {
        setNotificationError(`通知確認 ${result.confirmedCount}/${result.totalCount} 件。最新一覧を再取得できず、未確認件数は未取得です。`);
      } else if (result.status === 'failed') {
        setNotificationError(`通知確認に失敗しました（${result.confirmedCount}/${result.totalCount}件）。正規一覧へ同期済みです。未確認分は再試行できます。`);
      } else if (result.status === 'partial') {
        setNotificationError(`通知確認が一部失敗しました（${result.confirmedCount}/${result.totalCount}件）。上部の件数は最新一覧へ同期済みです。未確認分は再試行できます。`);
      }
    } finally {
      setBusyKey((current) => current === 'acknowledge' ? '' : current);
    }
  }, [busyKey, conversationId, events, getCurrentOwner, listFailed, listIsCurrent, listLoading, refreshList,
    routeGeneration, setBusyKey, setError, setNotificationError]);

  const handlerRef = useRef<() => void>(() => {});
  handlerRef.current = () => { void acknowledge(); };
  useEffect(() => {
    const handler = () => handlerRef.current();
    onAcknowledgeEvents?.(handler);
    return () => onAcknowledgeEvents?.(null);
  }, [onAcknowledgeEvents]);
  return acknowledge;
}
