import {
  CODEX_BRIDGE_MCP_DEFAULT_URL,
  CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY,
  parseCodexBridgeMcpEndpoint,
} from '../shared/codexbridge-mcp-protocol.ts';
import {
  CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH,
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
  type CodexBridgeWatchSnapshot,
  type CodexBridgeFinalAnswerResult,
} from '../shared/codexbridge-thread-monitor-protocol.ts';
import { createChromeSettingsRepository } from '../shared/settings-repository.ts';
import { CodexBridgeMcpClient } from './mcp-client.ts';
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
type MonitorLike = Pick<CodexBridgeThreadMonitor, 'startWatch' | 'stopWatch' | 'list' | 'listEvents' | 'read' | 'readEvent' | 'refreshForeground'>;

export type CodexBridgeThreadMonitorHandlerOptions = Readonly<{
  extensionId: string;
  monitor: MonitorLike;
  resolveAccess: () => Promise<CodexBridgeMonitorAccess>;
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

function matchesTargetThread(targetId: string, threadId: string): boolean {
  const separator = threadId.indexOf('::');
  return separator < 0 || threadId.slice(0, separator) === targetId;
}

function isTrustedSender(sender: SenderLike, extensionId: string): boolean {
  const origin = 'https://chatgpt.com';
  return sender.id === extensionId && Number.isSafeInteger(sender.tab?.id) && (sender.tab?.id ?? -1) >= 0
    && sender.frameId === 0 && pageOrigin(sender.tab?.url) === origin
    && (sender.url === undefined || pageOrigin(sender.url) === origin)
    && (sender.origin === undefined || sender.origin === origin);
}

function isMessage(value: unknown): value is CodexBridgeWatchMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  const keys = Object.keys(value);
  if (value.type === CODEX_BRIDGE_WATCH_START) {
    return keys.length === 3 && keys.includes('targetId') && keys.includes('threadId')
      && isCodexBridgeWatchIdentifier(value.targetId) && isCodexBridgeWatchIdentifier(value.threadId)
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
  return (value.type === CODEX_BRIDGE_WATCH_LIST || value.type === CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH)
    && keys.length === 1;
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
    return { status: 'failed', reason: error.code };
  }
  return { status: 'failed', reason: 'unknown-error' };
}

export function createCodexBridgeThreadMonitorMessageHandler(options: CodexBridgeThreadMonitorHandlerOptions) {
  return async (message: unknown, sender: SenderLike): Promise<
    | CodexBridgeWatchResponse<Readonly<{ item: CodexBridgeWatchSnapshot; created: boolean }>>
    | CodexBridgeWatchResponse<Readonly<{ removed: boolean }>>
    | CodexBridgeWatchResponse<CodexBridgeWatchListData>
    | CodexBridgeWatchResponse<CodexBridgeWatchSnapshot | null>
    | CodexBridgeWatchResponse<CodexBridgeWatchListData>
    | CodexBridgeWatchResponse<CodexBridgeFinalAnswerResult>
    | null
  > => {
    if (!isTrustedSender(sender, options.extensionId)) return null;
    if (!isMessage(message)) return { ok: false, reason: 'invalid-request' };
    try {
      if (message.type === CODEX_BRIDGE_WATCH_START) {
        const result = await options.monitor.startWatch(message.targetId, message.threadId);
        if (!result.ok) return result;
        return { ok: true, data: { item: result.item, created: result.created } };
      }
      if (message.type === CODEX_BRIDGE_WATCH_STOP) {
        const removed = await options.monitor.stopWatch(message.connectionId, message.targetId, message.threadId);
        return { ok: true, data: { removed } };
      }
      if (message.type === CODEX_BRIDGE_WATCH_READ) {
        const item = await options.monitor.read(message.connectionId, message.targetId, message.threadId);
        return { ok: true, data: item };
      }
      if (message.type === CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER) {
        const event = await options.monitor.readEvent(message.eventId);
        if (!event) return { ok: true, data: { status: 'failed', reason: 'event-not-found' } };
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
          currentConnectionId(options.resolveAccess), options.monitor.readEvent(event.eventId),
        ]);
        if (stillCurrent !== event.connectionId) return { ok: true, data: { status: 'failed', reason: 'connection-changed' } };
        if (!stillSaved || stillSaved.connectionId !== event.connectionId || stillSaved.targetId !== event.targetId
          || stillSaved.threadId !== event.threadId || stillSaved.turnId !== event.turnId || stillSaved.status !== event.status) {
          return { ok: true, data: { status: 'failed', reason: 'event-not-found' } };
        }
        return { ok: true, data: result };
      }
      if (message.type === CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH) await options.monitor.refreshForeground();
      const [items, events, connectionId] = await Promise.all([
        options.monitor.list(),
        options.monitor.listEvents(),
        currentConnectionId(options.resolveAccess),
      ]);
      if (message.type === CODEX_BRIDGE_WATCH_LIST) return { ok: true, data: { items, events, currentConnectionId: connectionId } };
      return { ok: true, data: { items, events, currentConnectionId: connectionId } };
    } catch {
      return { ok: false, reason: 'storage-error' };
    }
  };
}

export function createDefaultCodexBridgeThreadMonitor(
  extensionId: string,
  notification?: CodexBridgeNotificationHandler,
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
      readStatus: (targetId, threadId) => client.readStatus(targetId, threadId),
      readFinalAnswer: (targetId, threadId, turnId) => client.readFinalAnswer(targetId, threadId, turnId),
    };
  };

  const monitor = new CodexBridgeThreadMonitor(chrome.storage.local, chrome.alarms, resolveAccess, { notification });
  const handleMessage = createCodexBridgeThreadMonitorMessageHandler({ extensionId, monitor, resolveAccess });
  return { monitor, handleMessage };
}
