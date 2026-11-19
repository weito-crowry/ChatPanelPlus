export const CODEX_BRIDGE_MCP_TEST_MESSAGE = 'CODEX_BRIDGE_MCP_TEST' as const;
export const CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY = 'chatPanelPlus.codexBridgeMcpToken';
export const CODEX_BRIDGE_MCP_DEFAULT_URL = 'http://127.0.0.1:18000/mcp';
export const CODEX_BRIDGE_MCP_PROTOCOL_VERSION = '2025-03-26';
export const CODEX_BRIDGE_MCP_READ_ONLY_PROBE = 'codex_targets';

export type CodexBridgeMcpDiagnosticCode =
  | 'invalid-endpoint'
  | 'permission-required'
  | 'authentication-required'
  | 'forbidden'
  | 'endpoint-not-found'
  | 'session-expired'
  | 'http-error'
  | 'disconnected'
  | 'timeout'
  | 'protocol-error'
  | 'protocol-version-unsupported'
  | 'readonly-tool-unavailable'
  | 'readonly-probe-failed'
  | 'storage-error'
  | 'unknown-error';

export type CodexBridgeMcpTestMessage = Readonly<{
  type: typeof CODEX_BRIDGE_MCP_TEST_MESSAGE;
  endpoint: string;
}>;

export type CodexBridgeMcpTestResponse =
  | Readonly<{
      ok: true;
      protocolVersion: string;
      toolCount: number;
      readOnlyProbe: typeof CODEX_BRIDGE_MCP_READ_ONLY_PROBE;
    }>
  | Readonly<{ ok: false; reason: CodexBridgeMcpDiagnosticCode }>;

export type ParsedMcpEndpoint = Readonly<{ url: string; originPattern: string }>;

export function parseCodexBridgeMcpEndpoint(value: string): ParsedMcpEndpoint | null {
  let endpoint: URL;
  try {
    endpoint = new URL(value.trim());
  } catch {
    return null;
  }
  if ((endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:')
    || !endpoint.hostname
    || endpoint.username
    || endpoint.password
    || endpoint.hash) return null;
  return {
    url: endpoint.toString(),
    originPattern: `${endpoint.protocol}//${endpoint.hostname}/*`,
  };
}
