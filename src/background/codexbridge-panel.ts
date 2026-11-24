import {
  CODEX_BRIDGE_MCP_GET_STATUS,
  CODEX_BRIDGE_MCP_GET_TARGETS,
  CODEX_BRIDGE_MCP_GET_THREADS,
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
import { CodexBridgeReadService, createDefaultCodexBridgeReadService, type CodexBridgeRunningSnapshot } from './codexbridge-read-service.ts';
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
  readService?: Pick<CodexBridgeReadService, 'readTargets' | 'readThreads' | 'readStatus' | 'readRunningSnapshot'>;
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
    && keys.every((key) => key === 'type' || key === 'targetId' || key === 'cursor' || key === 'runningOnly'
      || key === 'refresh' || key === 'priority')
    && (message.runningOnly === undefined || typeof message.runningOnly === 'boolean')
    && (message.refresh === undefined || message.refresh === 'auto' || message.refresh === 'force')
    && (message.priority === undefined || message.priority === 'foreground' || message.priority === 'background'
      || message.priority === 'manual')
    && (message.runningOnly === true || message.refresh === undefined)
    && !(message.runningOnly === true && message.cursor !== undefined)
    && (message.cursor === undefined || (typeof message.cursor === 'string'
      && message.cursor.length > 0 && message.cursor.length <= 2048
      && !hasControlCharacters(message.cursor)))) {
    return {
      type: CODEX_BRIDGE_MCP_GET_THREADS,
      targetId: message.targetId,
      ...(typeof message.cursor === 'string' ? { cursor: message.cursor } : {}),
      ...(message.runningOnly === true ? { runningOnly: true } : {}),
      ...(message.refresh === 'force' ? { refresh: 'force' } : {}),
      ...(message.priority === 'foreground' || message.priority === 'background' || message.priority === 'manual'
        ? { priority: message.priority } : {}),
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
  const readService = options.readService ?? new CodexBridgeReadService({
    sessionStorage: options.sessionStorage, permissions: options.permissions, settings: options.settings,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  return async (message: unknown, sender: CodexBridgePanelSender): Promise<
    CodexBridgeReadResponse<readonly CodexBridgeTarget[]>
    | CodexBridgeReadResponse<CodexBridgeThreadPage>
    | CodexBridgeReadResponse<CodexBridgeThreadStatus>
    | null
  > => {
    if (!isTrustedSender(sender, options.extensionId)) return null;
    const request = readRequest(message);
    if (!request) return { ok: false, reason: 'protocol-error' };

    try {
      if (request.type === CODEX_BRIDGE_MCP_GET_TARGETS) {
        return { ok: true, data: await readService.readTargets('foreground') };
      }
      if (request.type === CODEX_BRIDGE_MCP_GET_THREADS) {
        if (request.runningOnly === true) {
          const priority = request.priority ?? 'foreground';
          const snapshot: CodexBridgeRunningSnapshot = await readService.readRunningSnapshot(request.targetId, {
            priority, force: request.refresh === 'force',
          });
          const runningSnapshot = {
            freshness: snapshot.freshness,
            observedAt: snapshot.observedAt,
            ageMs: snapshot.ageMs,
            reason: snapshot.ok ? snapshot.failureReason : snapshot.reason,
          } as const;
          return snapshot.ok
            ? { ok: true, data: snapshot.page, runningSnapshot }
            : { ok: false, reason: snapshot.reason };
        }
        return { ok: true, data: await readService.readThreads(request.targetId, request.cursor, request.priority ?? 'foreground') };
      }
      return { ok: true, data: await readService.readStatus(request.targetId, request.threadId, 'manual') };
    } catch (error) {
      return { ok: false, reason: responseForError(error) };
    }
  };
}

export function createDefaultCodexBridgePanelHandler(extensionId: string,
  readService: CodexBridgeReadService = createDefaultCodexBridgeReadService()) {
  return createCodexBridgePanelHandler({
    sessionStorage: chrome.storage.session,
    permissions: chrome.permissions,
    settings: createChromeSettingsRepository(),
    extensionId,
    readService,
  });
}
