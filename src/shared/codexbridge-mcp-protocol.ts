export const CODEX_BRIDGE_MCP_TEST_MESSAGE = 'CODEX_BRIDGE_MCP_TEST' as const;
export const CODEX_BRIDGE_MCP_GET_TARGETS = 'CODEX_BRIDGE_MCP_GET_TARGETS' as const;
export const CODEX_BRIDGE_MCP_GET_THREADS = 'CODEX_BRIDGE_MCP_GET_THREADS' as const;
export const CODEX_BRIDGE_MCP_GET_STATUS = 'CODEX_BRIDGE_MCP_GET_STATUS' as const;
export const CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY = 'chatPanelPlus.codexBridgeMcpToken';
export const CODEX_BRIDGE_MCP_DEFAULT_URL = 'http://127.0.0.1:18000/mcp';
export const CODEX_BRIDGE_MCP_PROTOCOL_VERSION = '2025-03-26';
export const CODEX_BRIDGE_MCP_SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2025-06-18'] as const;
export const CODEX_BRIDGE_MCP_READ_ONLY_PROBE = 'codex_targets';

export type CodexBridgeMcpProtocolVersion = typeof CODEX_BRIDGE_MCP_SUPPORTED_PROTOCOL_VERSIONS[number];

export function isSupportedCodexBridgeMcpProtocolVersion(value: string): value is CodexBridgeMcpProtocolVersion {
  return CODEX_BRIDGE_MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(value as CodexBridgeMcpProtocolVersion);
}

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

export type CodexBridgeReadFailureReason = CodexBridgeMcpDiagnosticCode | 'settings-unavailable';
export type CodexBridgeReadResponse<T> = Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; reason: CodexBridgeReadFailureReason }>;

export type CodexBridgeTarget = Readonly<{
  id: string;
  name: string;
  kind: string | null;
  available: boolean | null;
}>;

export type CodexBridgeObservation = Readonly<{
  state: string | null;
  evidence: string | null;
  reason: string | null;
  observedAt: string | null;
  needsAttention: boolean | null;
}>;

export type CodexBridgeLastTurn = Readonly<{
  turnId: string | null;
  status: 'completed' | 'failed' | 'interrupted' | 'in_progress' | 'unknown' | null;
  category: string | null;
  evidence: string | null;
  reason: string | null;
  observedAt: string | null;
  needsAttention: boolean | null;
}>;

export type CodexBridgeThread = Readonly<{
  targetId: string;
  id: string;
  title: string | null;
  preview: string | null;
  cwd: string | null;
  updatedAt: string | null;
  currentExecution: CodexBridgeObservation | null;
  lastTurn: CodexBridgeLastTurn | null;
  needsAttention: boolean | null;
}>;

export type CodexBridgeThreadPage = Readonly<{
  threads: readonly CodexBridgeThread[];
  nextCursor: string | null;
}>;

export type CodexBridgeThreadStatus = Readonly<{
  targetId: string;
  threadId: string;
  state: string | null;
  currentExecution: CodexBridgeObservation | null;
  lastTurn: CodexBridgeLastTurn | null;
  needsAttention: boolean | null;
}>;

export type CodexBridgeTargetsMessage = Readonly<{ type: typeof CODEX_BRIDGE_MCP_GET_TARGETS }>;
export type CodexBridgeThreadsMessage = Readonly<{
  type: typeof CODEX_BRIDGE_MCP_GET_THREADS;
  targetId: string;
  cursor?: string;
}>;
export type CodexBridgeStatusMessage = Readonly<{
  type: typeof CODEX_BRIDGE_MCP_GET_STATUS;
  targetId: string;
  threadId: string;
}>;

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
