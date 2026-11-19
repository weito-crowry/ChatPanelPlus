import {
  CODEX_BRIDGE_MCP_TEST_MESSAGE,
  CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY,
  parseCodexBridgeMcpEndpoint,
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
    switch (error.code) {
      case 'authentication-required': return { ok: false, reason: 'authentication-required' };
      case 'forbidden': return { ok: false, reason: 'forbidden' };
      case 'endpoint-not-found': return { ok: false, reason: 'endpoint-not-found' };
      case 'session-expired': return { ok: false, reason: 'session-expired' };
      case 'http-error': return { ok: false, reason: 'http-error' };
      case 'disconnected': return { ok: false, reason: 'disconnected' };
      case 'timeout': return { ok: false, reason: 'timeout' };
      case 'protocol-error': return { ok: false, reason: 'protocol-error' };
      case 'protocol-version-unsupported': return { ok: false, reason: 'protocol-version-unsupported' };
      case 'readonly-tool-unavailable': return { ok: false, reason: 'readonly-tool-unavailable' };
      case 'readonly-probe-failed': return { ok: false, reason: 'readonly-probe-failed' };
    }
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
