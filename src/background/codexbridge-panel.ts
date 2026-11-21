import {
  CODEX_BRIDGE_MCP_DEFAULT_URL,
  CODEX_BRIDGE_MCP_GET_STATUS,
  CODEX_BRIDGE_MCP_GET_TARGETS,
  CODEX_BRIDGE_MCP_GET_THREADS,
  CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY,
  parseCodexBridgeMcpEndpoint,
  type CodexBridgeReadFailureReason,
  type CodexBridgeReadResponse,
  type CodexBridgeTargetsMessage,
  type CodexBridgeThreadsMessage,
  type CodexBridgeStatusMessage,
  type CodexBridgeTarget,
  type CodexBridgeThreadPage,
  type CodexBridgeThreadStatus,
} from '../shared/codexbridge-mcp-protocol.ts';
import { createChromeSettingsRepository, type SettingsRepository } from '../shared/settings-repository.ts';
import { CodexBridgeMcpClient } from './mcp-client.ts';
import { McpTransportError } from './mcp-transport.ts';

type SessionStorageLike = Readonly<{ get(keys: string[]): Promise<Record<string, unknown>> }>;
type PermissionApiLike = Readonly<{ contains(permissions: { origins: string[] }): Promise<boolean> }>;
export type CodexBridgePanelSender = Readonly<{
  id?: string;
  origin?: string;
  url?: string;
  frameId?: number;
  tab?: { id?: number; url?: string };
}>;

export type CodexBridgePanelHandlerOptions = Readonly<{
  sessionStorage: SessionStorageLike;
  permissions: PermissionApiLike;
  settings: Pick<SettingsRepository, 'loadSettings'>;
  extensionId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}>;

const CHATGPT_ORIGIN = 'https://chatgpt.com';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    && value.trim() === value && !hasControlCharacters(value);
}

function pageOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function isTrustedSender(sender: CodexBridgePanelSender, extensionId: string): boolean {
  if (sender.id !== extensionId || !Number.isSafeInteger(sender.tab?.id)
    || (sender.tab?.id ?? -1) < 0 || sender.frameId !== 0
    || pageOrigin(sender.tab?.url) !== CHATGPT_ORIGIN) return false;
  if (sender.url !== undefined && pageOrigin(sender.url) !== CHATGPT_ORIGIN) return false;
  if (sender.origin !== undefined && sender.origin !== CHATGPT_ORIGIN) return false;
  return true;
}

function readRequest(message: unknown): CodexBridgeTargetsMessage | CodexBridgeThreadsMessage | CodexBridgeStatusMessage | null {
  if (!isRecord(message) || typeof message.type !== 'string') return null;
  const keys = Object.keys(message);
  if (message.type === CODEX_BRIDGE_MCP_GET_TARGETS && keys.length === 1) {
    return { type: CODEX_BRIDGE_MCP_GET_TARGETS };
  }
  if (message.type === CODEX_BRIDGE_MCP_GET_THREADS && isIdentifier(message.targetId)
    && keys.every((key) => key === 'type' || key === 'targetId' || key === 'cursor' || key === 'runningOnly')
    && (message.runningOnly === undefined || typeof message.runningOnly === 'boolean')
    && !(message.runningOnly === true && message.cursor !== undefined)
    && (message.cursor === undefined || (typeof message.cursor === 'string'
      && message.cursor.length > 0 && message.cursor.length <= 2048
      && !hasControlCharacters(message.cursor)))) {
    return {
      type: CODEX_BRIDGE_MCP_GET_THREADS,
      targetId: message.targetId,
      ...(typeof message.cursor === 'string' ? { cursor: message.cursor } : {}),
      ...(message.runningOnly === true ? { runningOnly: true } : {}),
    };
  }
  if (message.type === CODEX_BRIDGE_MCP_GET_STATUS && isIdentifier(message.targetId)
    && isIdentifier(message.threadId) && keys.length === 3) {
    const separator = message.threadId.indexOf('::');
    if (separator >= 0 && message.threadId.slice(0, separator) !== message.targetId) return null;
    return { type: CODEX_BRIDGE_MCP_GET_STATUS, targetId: message.targetId, threadId: message.threadId };
  }
  return null;
}

function responseForError(error: unknown): CodexBridgeReadFailureReason {
  if (error instanceof McpTransportError) return error.code;
  return 'unknown-error';
}

export function createCodexBridgePanelHandler(options: CodexBridgePanelHandlerOptions) {
  return async (message: unknown, sender: CodexBridgePanelSender): Promise<
    CodexBridgeReadResponse<readonly CodexBridgeTarget[]>
    | CodexBridgeReadResponse<CodexBridgeThreadPage>
    | CodexBridgeReadResponse<CodexBridgeThreadStatus>
    | null
  > => {
    if (!isTrustedSender(sender, options.extensionId)) return null;
    const request = readRequest(message);
    if (!request) return { ok: false, reason: 'protocol-error' };

    const loaded = await options.settings.loadSettings();
    if (!loaded.ok) return { ok: false, reason: 'settings-unavailable' };
    const endpoint = parseCodexBridgeMcpEndpoint(loaded.settings.codexBridgeMcpUrl ?? CODEX_BRIDGE_MCP_DEFAULT_URL);
    if (!endpoint) return { ok: false, reason: 'invalid-endpoint' };
    try {
      if (!await options.permissions.contains({ origins: [endpoint.originPattern] })) {
        return { ok: false, reason: 'permission-required' };
      }
    } catch {
      return { ok: false, reason: 'permission-required' };
    }

    let token = '';
    try {
      const stored = await options.sessionStorage.get([CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY]);
      const value = stored[CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY];
      if (value !== undefined && typeof value !== 'string') return { ok: false, reason: 'settings-unavailable' };
      if (typeof value === 'string') token = value;
    } catch {
      return { ok: false, reason: 'settings-unavailable' };
    }

    try {
      const client = new CodexBridgeMcpClient(endpoint.url, token, {
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      });
      if (request.type === CODEX_BRIDGE_MCP_GET_TARGETS) {
        return { ok: true, data: await client.readTargets() };
      }
      if (request.type === CODEX_BRIDGE_MCP_GET_THREADS) {
        return { ok: true, data: await client.readThreads(request.targetId, request.cursor, request.runningOnly === true) };
      }
      return { ok: true, data: await client.readStatus(request.targetId, request.threadId) };
    } catch (error) {
      return { ok: false, reason: responseForError(error) };
    }
  };
}

export function createDefaultCodexBridgePanelHandler(extensionId: string) {
  return createCodexBridgePanelHandler({
    sessionStorage: chrome.storage.session,
    permissions: chrome.permissions,
    settings: createChromeSettingsRepository(),
    extensionId,
  });
}
