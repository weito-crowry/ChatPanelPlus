import {
  CODEX_BRIDGE_MCP_DEFAULT_URL,
  CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY,
  parseCodexBridgeMcpEndpoint,
} from '../shared/codexbridge-mcp-protocol.ts';
import {
  CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH,
  CODEX_BRIDGE_WATCH_ACK_EVENTS,
  CODEX_BRIDGE_WATCH_ACK_EVENT_IDS_LIMIT,
  CODEX_BRIDGE_WATCH_CLEAR_EVENTS,
  CODEX_BRIDGE_AUTO_WATCH_GET,
  CODEX_BRIDGE_AUTO_WATCH_SET,
  CODEX_BRIDGE_AUTO_WATCH_COMPLETED,
  CODEX_BRIDGE_WATCH_LIST,
  CODEX_BRIDGE_WATCH_READ,
  CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER,
  CODEX_BRIDGE_WATCH_START,
  CODEX_BRIDGE_WATCH_STOP,
  createCodexBridgeConnectionId,
  isCodexBridgeWatchIdentifier,
  type CodexBridgeWatchListData,
  type CodexBridgeWatchMessage,
  type CodexBridgeWatchResponse,
  type CodexBridgeAutoWatchStatus,
  type CodexBridgeWatchSnapshot,
  type CodexBridgeFinalAnswerResult,
  type CodexBridgeWatchOwnerMute,
  type CodexBridgeAutoWatchMessage,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import { conversationIdFromPath, isConversationId } from '../shared/conversation-route.ts';
import { createChromeSettingsRepository } from '../shared/settings-repository.ts';
import { CodexBridgeMcpClient } from './mcp-client.ts';
import { CodexBridgeAutoThreadRegistration } from './thread-monitor-auto-registration.ts';
import { McpTransportError } from './mcp-transport.ts';
import {
  CodexBridgeThreadMonitor,
  type CodexBridgeMonitorAccess,
  type CodexBridgeNotificationHandler,
} from './thread-monitor.ts';

type SessionStorageLike = Readonly<{ get(keys: string[]): Promise<Record<string, unknown>> }>;
type PermissionApiLike = Readonly<{ contains(permissions: { origins: string[] }): Promise<boolean> }>;
type SenderLike = Readonly<{
  id?: string;
  origin?: string;
  url?: string;
  frameId?: number;
  tab?: { id?: number; url?: string };
}>;
type MonitorLike = Pick<CodexBridgeThreadMonitor, 'startWatch' | 'stopWatch' | 'list' | 'listEvents' | 'read' | 'readEvent'
  | 'refreshForeground' | 'acknowledgeEvents' | 'clearEvents'>;

export type CodexBridgeThreadMonitorHandlerOptions = Readonly<{
  extensionId: string;
  monitor: MonitorLike;
  resolveAccess: () => Promise<CodexBridgeMonitorAccess>;
  loadOwnerMute: (tabId: number, conversationId: string) => Promise<
    | { readonly ok: true; readonly muted: boolean; readonly revision: number }
    | { readonly ok: false }
  >;
  autoRegistration?: Pick<CodexBridgeAutoThreadRegistration, 'getStatus' | 'setEnabled' | 'registerCompletedAnswer' | 'stopWatch'>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pageOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

export async function ownerTabMatchesConversation(
  tabs: Readonly<{ get(tabId: number): Promise<{ url?: string }> }>,
  tabId: number,
  conversationId: string,
): Promise<boolean> {
  try {
    const url = new URL((await tabs.get(tabId)).url ?? '');
    return url.origin === 'https://chatgpt.com' && !url.username && !url.password
      && conversationIdFromPath(url.pathname) === conversationId;
  } catch { return false; }
}

function matchesTargetThread(targetId: string, threadId: string): boolean {
  const separator = threadId.indexOf('::');
  return separator < 0 || threadId.slice(0, separator) === targetId;
}

function trustedConversation(sender: SenderLike, extensionId: string, requestedConversationId?: string): { tabId: number; conversationId: string } | null {
  const origin = 'https://chatgpt.com';
  if (sender.id !== extensionId || !Number.isSafeInteger(sender.tab?.id) || (sender.tab?.id ?? -1) < 0
    || sender.frameId !== 0 || pageOrigin(sender.tab?.url) !== origin || pageOrigin(sender.url) !== origin
    || (sender.origin !== undefined && sender.origin !== origin)) return null;
  try {
    const frameConversationId = conversationIdFromPath(new URL(sender.url!).pathname);
    const tabConversationId = conversationIdFromPath(new URL(sender.tab!.url!).pathname);
    if (!isConversationId(frameConversationId) || frameConversationId !== tabConversationId
      || (requestedConversationId !== undefined && requestedConversationId !== frameConversationId)) return null;
    return { tabId: sender.tab!.id!, conversationId: frameConversationId };
  } catch { return null; }
}

function isMessage(value: unknown): value is CodexBridgeWatchMessage | CodexBridgeAutoWatchMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  const keys = Object.keys(value);
  if ((value.type === CODEX_BRIDGE_AUTO_WATCH_GET || value.type === CODEX_BRIDGE_AUTO_WATCH_SET)
    && keys.includes('targetId') && keys.includes('conversationId') && isCodexBridgeWatchIdentifier(value.targetId)
    && isConversationId(value.conversationId)
    && (value.type === CODEX_BRIDGE_AUTO_WATCH_GET
      ? keys.length === 3 : keys.length === 4 && typeof value.enabled === 'boolean')) return true;
  if (value.type === CODEX_BRIDGE_AUTO_WATCH_COMPLETED) {
    return keys.length === 6 && isCodexBridgeWatchIdentifier(value.targetId) && value.targetId.length <= 512
      && isConversationId(value.conversationId)
      && typeof value.turnKey === 'string' && value.turnKey.length > 0 && value.turnKey.length <= 1_024
      && value.turnKey.trim() === value.turnKey
      && typeof value.assistantMessageId === 'string' && value.assistantMessageId.length > 0
      && value.assistantMessageId.length <= 1_024 && value.assistantMessageId.trim() === value.assistantMessageId
      && Array.isArray(value.threadIds) && value.threadIds.length > 0 && value.threadIds.length <= 32
      && value.threadIds.every((id) => isCodexBridgeWatchIdentifier(id) && id.length <= 512)
      && new Set(value.threadIds).size === value.threadIds.length;
  }
  if (value.type === CODEX_BRIDGE_WATCH_START) {
    return keys.length === 4 && keys.includes('targetId') && keys.includes('threadId') && keys.includes('conversationId')
      && isCodexBridgeWatchIdentifier(value.targetId) && isCodexBridgeWatchIdentifier(value.threadId)
      && isConversationId(value.conversationId)
      && matchesTargetThread(value.targetId, value.threadId);
  }
  if (value.type === CODEX_BRIDGE_WATCH_STOP || value.type === CODEX_BRIDGE_WATCH_READ) {
    return keys.length === 4 && keys.includes('connectionId') && keys.includes('targetId') && keys.includes('threadId')
      && isCodexBridgeWatchIdentifier(value.connectionId) && value.connectionId.length <= 96
      && isCodexBridgeWatchIdentifier(value.targetId) && isCodexBridgeWatchIdentifier(value.threadId)
      && matchesTargetThread(value.targetId, value.threadId);
  }
  if (value.type === CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER) {
    return keys.length === 2 && isCodexBridgeWatchIdentifier(value.eventId) && value.eventId.length <= 96;
  }
  if (value.type === CODEX_BRIDGE_WATCH_ACK_EVENTS || value.type === CODEX_BRIDGE_WATCH_CLEAR_EVENTS) {
    return keys.length === 3 && isConversationId(value.conversationId) && Array.isArray(value.eventIds)
      && value.eventIds.length > 0 && value.eventIds.length <= CODEX_BRIDGE_WATCH_ACK_EVENT_IDS_LIMIT
      && value.eventIds.every((eventId) => isCodexBridgeWatchIdentifier(eventId) && eventId.length <= 96);
  }
  return (value.type === CODEX_BRIDGE_WATCH_LIST || value.type === CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH)
    && keys.length === 1;
}

function summarize(items: readonly CodexBridgeWatchSnapshot[], events: CodexBridgeWatchListData['events']) {
  const unacknowledged = new Set<string>();
  for (const event of events) {
    if (!event.acknowledgedAt) unacknowledged.add(`${event.connectionId}\u0000${event.targetId}\u0000${event.threadId}`);
  }
  return { watchingCount: items.length, unacknowledgedThreadCount: unacknowledged.size };
}

async function currentConnectionId(resolveAccess: () => Promise<CodexBridgeMonitorAccess>): Promise<string | null> {
  try {
    return (await resolveAccess()).connectionId;
  } catch {
    return null;
  }
}

function finalAnswerFailure(error: unknown): CodexBridgeFinalAnswerResult {
  if (error instanceof McpTransportError) {
    if (error.code === 'response-too-large') {
      return { status: 'incomplete', reason: 'history-too-large', completeness: 'unconfirmed' };
    }
    return { status: 'failed', reason: error.code === 'running-only-unsupported' ? 'readonly-tool-unavailable' : error.code };
  }
  return { status: 'failed', reason: 'unknown-error' };
}

export function createCodexBridgeThreadMonitorMessageHandler(options: CodexBridgeThreadMonitorHandlerOptions) {
  return async (message: unknown, sender: SenderLike): Promise<
    | CodexBridgeWatchResponse<Readonly<{ item: CodexBridgeWatchSnapshot; created: boolean; transferred: boolean }>>
    | CodexBridgeWatchResponse<Readonly<{ removed: boolean }>>
    | CodexBridgeWatchResponse<CodexBridgeWatchListData>
    | CodexBridgeWatchResponse<CodexBridgeAutoWatchStatus>
    | CodexBridgeWatchResponse<Readonly<{ registeredCount: number }>>
    | CodexBridgeWatchResponse<CodexBridgeWatchSnapshot | null>
    | CodexBridgeWatchResponse<CodexBridgeWatchListData>
    | CodexBridgeWatchResponse<CodexBridgeFinalAnswerResult>
    | CodexBridgeWatchResponse<Readonly<{ acknowledged: boolean }>>
    | CodexBridgeWatchResponse<Readonly<{ cleared: boolean }>>
    | null
  > => {
    if (!isMessage(message)) return { ok: false, reason: 'invalid-request' };
    const requestedConversationId = message.type === CODEX_BRIDGE_WATCH_START
      || message.type === CODEX_BRIDGE_AUTO_WATCH_GET || message.type === CODEX_BRIDGE_AUTO_WATCH_SET
      || message.type === CODEX_BRIDGE_AUTO_WATCH_COMPLETED
      ? message.conversationId : undefined;
    const identity = trustedConversation(sender, options.extensionId, requestedConversationId);
    if (!identity) return null;
    try {
      if (message.type === CODEX_BRIDGE_AUTO_WATCH_GET) {
        if (!options.autoRegistration) return { ok: false, reason: 'storage-error' };
        return { ok: true, data: await options.autoRegistration.getStatus(message.targetId, identity.conversationId) };
      }
      if (message.type === CODEX_BRIDGE_AUTO_WATCH_SET) {
        if (!options.autoRegistration) return { ok: false, reason: 'storage-error' };
        const result = await options.autoRegistration.setEnabled(message.targetId, identity.tabId, identity.conversationId, message.enabled);
        return result.ok ? { ok: true, data: result.status } : { ok: false, reason: result.reason };
      }
      if (message.type === CODEX_BRIDGE_AUTO_WATCH_COMPLETED) {
        if (!options.autoRegistration) return { ok: true, data: { registeredCount: 0 } };
        const registeredCount = await options.autoRegistration.registerCompletedAnswer(message.targetId, identity.tabId,
          identity.conversationId, message.turnKey, message.assistantMessageId, message.threadIds);
        return { ok: true, data: { registeredCount } };
      }
      if (message.type === CODEX_BRIDGE_WATCH_START) {
        const mute = await options.loadOwnerMute(identity.tabId, identity.conversationId);
        if (!mute.ok) return { ok: false, reason: 'storage-error' };
        const owner: CodexBridgeWatchOwnerMute = {
          ownerTabId: identity.tabId, ownerConversationId: identity.conversationId,
          ownerMuted: mute.muted, ownerMuteRevision: mute.revision,
        };
        const result = await options.monitor.startWatch(message.targetId, message.threadId, owner);
        if (!result.ok) return result;
        return { ok: true, data: { item: result.item, created: result.created, transferred: result.transferred } };
      }
      if (message.type === CODEX_BRIDGE_WATCH_STOP) {
        const removed = options.autoRegistration
          ? await options.autoRegistration.stopWatch(message.connectionId, message.targetId, message.threadId, identity.conversationId)
          : await options.monitor.stopWatch(message.connectionId, message.targetId, message.threadId, identity.conversationId);
        return { ok: true, data: { removed } };
      }
      if (message.type === CODEX_BRIDGE_WATCH_READ) {
        const item = await options.monitor.read(message.connectionId, message.targetId, message.threadId);
        return { ok: true, data: item?.ownerConversationId === identity.conversationId ? item : null };
      }
      if (message.type === CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER) {
        const event = await options.monitor.readEvent(message.eventId, identity.conversationId);
        if (!event || event.ownerConversationId !== identity.conversationId) {
          return { ok: true, data: { status: 'failed', reason: 'event-not-found' } };
        }
        if (!matchesTargetThread(event.targetId, event.threadId)) {
          return { ok: true, data: { status: 'failed', reason: 'event-not-found' } };
        }
        let access: CodexBridgeMonitorAccess;
        try { access = await options.resolveAccess(); } catch { access = { connectionId: null }; }
        if (!access.connectionId || access.connectionId !== event.connectionId) {
          return { ok: true, data: { status: 'failed', reason: 'connection-changed' } };
        }
        if (!access.readFinalAnswer) {
          const reason = access.failure === 'permission-required' ? 'permission-required'
            : access.failure === 'settings-unavailable' ? 'settings-unavailable' : 'readonly-tool-unavailable';
          return { ok: true, data: { status: 'failed', reason } };
        }
        let result: CodexBridgeFinalAnswerResult;
        try {
          result = await access.readFinalAnswer(event.targetId, event.threadId, event.turnId);
        } catch (error) {
          result = finalAnswerFailure(error);
        }
        const [stillCurrent, stillSaved] = await Promise.all([
          currentConnectionId(options.resolveAccess), options.monitor.readEvent(event.eventId, identity.conversationId),
        ]);
        if (stillCurrent !== event.connectionId) return { ok: true, data: { status: 'failed', reason: 'connection-changed' } };
        if (!stillSaved || stillSaved.connectionId !== event.connectionId || stillSaved.targetId !== event.targetId
          || stillSaved.threadId !== event.threadId || stillSaved.turnId !== event.turnId || stillSaved.status !== event.status) {
          return { ok: true, data: { status: 'failed', reason: 'event-not-found' } };
        }
        return { ok: true, data: result };
      }
      if (message.type === CODEX_BRIDGE_WATCH_ACK_EVENTS) {
        if (message.conversationId !== identity.conversationId) return { ok: false, reason: 'invalid-request' };
        const acknowledged = await options.monitor.acknowledgeEvents(identity.conversationId, message.eventIds, new Date().toISOString());
        return acknowledged ? { ok: true, data: { acknowledged: true } } : { ok: false, reason: 'invalid-request' };
      }
      if (message.type === CODEX_BRIDGE_WATCH_CLEAR_EVENTS) {
        if (message.conversationId !== identity.conversationId) return { ok: false, reason: 'invalid-request' };
        const cleared = await options.monitor.clearEvents(identity.conversationId, message.eventIds);
        return cleared ? { ok: true, data: { cleared: true } } : { ok: false, reason: 'invalid-request' };
      }
      if (message.type === CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH) {
        await options.monitor.refreshForeground();
      }
      const [items, events, connectionId] = await Promise.all([
        options.monitor.list(),
        options.monitor.listEvents(),
        currentConnectionId(options.resolveAccess),
      ]);
      const ownedItems = items.filter((item) => item.ownerConversationId === identity.conversationId);
      const ownedEvents = events.filter((event) => event.ownerConversationId === identity.conversationId);
      return { ok: true, data: {
        items: ownedItems, events: ownedEvents, currentConnectionId: connectionId,
        summary: summarize(ownedItems, ownedEvents),
      } };
    } catch {
      return { ok: false, reason: 'storage-error' };
    }
  };
}

export function createDefaultCodexBridgeThreadMonitor(
  extensionId: string,
  notification?: CodexBridgeNotificationHandler,
  loadOwnerMute: CodexBridgeThreadMonitorHandlerOptions['loadOwnerMute'] = async () => ({ ok: false }),
) {
  const sessionStorage = chrome.storage.session as SessionStorageLike;
  const settings = createChromeSettingsRepository();
  const permissions = chrome.permissions as PermissionApiLike;
  let cached: Readonly<{ connectionId: string; endpoint: string; token: string; client: CodexBridgeMcpClient }> | null = null;

  const resolveAccess = async (): Promise<CodexBridgeMonitorAccess> => {
    const loaded = await settings.loadSettings();
    if (!loaded.ok) {
      cached = null;
      return { connectionId: null, failure: 'settings-unavailable' };
    }
    const endpoint = parseCodexBridgeMcpEndpoint(loaded.settings.codexBridgeMcpUrl ?? CODEX_BRIDGE_MCP_DEFAULT_URL);
    if (!endpoint) {
      cached = null;
      return { connectionId: null, failure: 'settings-unavailable' };
    }
    const connectionId = await createCodexBridgeConnectionId(endpoint.url);
    if (!connectionId) {
      cached = null;
      return { connectionId: null, failure: 'unknown' };
    }
    try {
      if (!await permissions.contains({ origins: [endpoint.originPattern] })) {
        cached = null;
        return { connectionId, failure: 'permission-required' };
      }
    } catch {
      cached = null;
      return { connectionId, failure: 'permission-required' };
    }

    let token = '';
    try {
      const stored = await sessionStorage.get([CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY]);
      const value = stored[CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY];
      if (value !== undefined && typeof value !== 'string') {
        cached = null;
        return { connectionId, failure: 'settings-unavailable' };
      }
      if (typeof value === 'string') token = value;
    } catch {
      cached = null;
      return { connectionId, failure: 'settings-unavailable' };
    }
    if (!cached || cached.connectionId !== connectionId || cached.endpoint !== endpoint.url || cached.token !== token) {
      cached = { connectionId, endpoint: endpoint.url, token, client: new CodexBridgeMcpClient(endpoint.url, token, { timeoutMs: 4_000 }) };
    }
    const client = cached.client;
    return {
      connectionId,
      readTargets: () => client.readTargets(),
      readRunningThreads: (targetId) => client.readThreads(targetId, undefined, true),
      readStatus: (targetId, threadId) => client.readStatus(targetId, threadId),
      readFinalAnswer: (targetId, threadId, turnId) => client.readFinalAnswer(targetId, threadId, turnId),
    };
  };

  const monitor = new CodexBridgeThreadMonitor(chrome.storage.local, chrome.alarms, resolveAccess, { notification });
  const autoRegistration = new CodexBridgeAutoThreadRegistration(
    chrome.storage.local, chrome.alarms, monitor, resolveAccess, loadOwnerMute,
    (tabId, conversationId) => ownerTabMatchesConversation(chrome.tabs, tabId, conversationId),
  );
  const handleMessage = createCodexBridgeThreadMonitorMessageHandler({
    extensionId, monitor, resolveAccess, loadOwnerMute, autoRegistration,
  });
  return { monitor, autoRegistration, handleMessage };
}
