import {
  CODEX_BRIDGE_MCP_TEST_MESSAGE,
  CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY,
  parseCodexBridgeMcpEndpoint,
  type CodexBridgeMcpDiagnosticCode,
  type CodexBridgeMcpTestMessage,
  type CodexBridgeMcpTestResponse,
} from '../shared/codexbridge-mcp-protocol.ts';
import { CodexBridgeMcpClient } from './mcp-client.ts';
import { McpTransportError } from './mcp-transport.ts';

type SessionStorageLike = Readonly<{
  get(keys: string[]): Promise<Record<string, unknown>>;
}>;

type PermissionApiLike = Readonly<{
  contains(permissions: { origins: string[] }): Promise<boolean>;
}>;

type SenderLike = Readonly<{ id?: string; url?: string }>;
type FetchLike = typeof fetch;

export type CodexBridgeMcpTestHandlerOptions = Readonly<{
  sessionStorage: SessionStorageLike;
  permissions: PermissionApiLike;
  extensionId: string;
  optionsPageUrl: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}>;

function isTestMessage(value: unknown): value is CodexBridgeMcpTestMessage {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === CODEX_BRIDGE_MCP_TEST_MESSAGE
    && 'endpoint' in value && typeof value.endpoint === 'string';
}

function responseForError(error: unknown): CodexBridgeMcpTestResponse {
  if (error instanceof McpTransportError) {
    let reason: CodexBridgeMcpDiagnosticCode = 'unknown-error';
    switch (error.code) {
      case 'authentication-required': reason = 'authentication-required'; break;
      case 'forbidden': reason = 'forbidden'; break;
      case 'endpoint-not-found': reason = 'endpoint-not-found'; break;
      case 'session-expired': reason = 'session-expired'; break;
      case 'http-error': reason = 'http-error'; break;
      case 'disconnected': reason = 'disconnected'; break;
      case 'timeout': reason = 'timeout'; break;
      case 'protocol-error': reason = 'protocol-error'; break;
      case 'protocol-version-unsupported': reason = 'protocol-version-unsupported'; break;
      case 'readonly-tool-unavailable': reason = 'readonly-tool-unavailable'; break;
      case 'running-only-unsupported': reason = 'running-only-unsupported'; break;
      case 'readonly-probe-failed': reason = 'readonly-probe-failed'; break;
      case 'response-too-large': reason = 'response-too-large'; break;
    }
    const stage = error.stage
      ?? (error.code === 'timeout' ? 'timeout'
        : error.code === 'protocol-error' || error.code === 'protocol-version-unsupported'
          || error.code === 'readonly-tool-unavailable' || error.code === 'running-only-unsupported'
          || error.code === 'readonly-probe-failed'
          || error.code === 'response-too-large' ? 'protocol' : undefined);
    return {
      ok: false,
      reason,
      ...(stage ? { stage } : {}),
      ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}),
      ...(error.errorName ? { errorName: error.errorName } : {}),
    };
  }
  return { ok: false, reason: 'unknown-error' };
}

export function createCodexBridgeMcpTestHandler(options: CodexBridgeMcpTestHandlerOptions) {
  return async (message: unknown, sender: SenderLike): Promise<CodexBridgeMcpTestResponse | null> => {
    if (!isTestMessage(message)) return null;
    if (sender.id !== options.extensionId || sender.url !== options.optionsPageUrl) return null;

    const endpoint = parseCodexBridgeMcpEndpoint(message.endpoint);
    if (!endpoint) return { ok: false, reason: 'invalid-endpoint' };
    try {
      if (!await options.permissions.contains({ origins: [endpoint.originPattern] })) {
        return { ok: false, reason: 'permission-required' };
      }
    } catch {
      return { ok: false, reason: 'permission-required' };
    }

    let token: string;
    try {
      const stored = await options.sessionStorage.get([CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY]);
      const storedToken = stored[CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY];
      if (storedToken !== undefined && typeof storedToken !== 'string') {
        return { ok: false, reason: 'storage-error' };
      }
      token = typeof storedToken === 'string' ? storedToken : '';
    } catch {
      return { ok: false, reason: 'storage-error' };
    }

    try {
      const client = new CodexBridgeMcpClient(endpoint.url, token, {
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      });
      const result = await client.testReadOnlyConnection();
      return {
        ok: true,
        protocolVersion: result.protocolVersion,
        toolCount: result.toolCount,
        readOnlyProbe: 'codex_targets',
      };
    } catch (error) {
      return responseForError(error);
    }
  };
}
