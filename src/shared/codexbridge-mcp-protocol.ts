export const CODEX_BRIDGE_MCP_TEST_MESSAGE = 'CODEX_BRIDGE_MCP_TEST' as const;
export const CODEX_BRIDGE_MCP_GET_TARGETS = 'CODEX_BRIDGE_MCP_GET_TARGETS' as const;
export const CODEX_BRIDGE_MCP_GET_THREADS = 'CODEX_BRIDGE_MCP_GET_THREADS' as const;
export const CODEX_BRIDGE_MCP_GET_STATUS = 'CODEX_BRIDGE_MCP_GET_STATUS' as const;
export const CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY = 'chatPanelPlus.codexBridgeMcpToken';
export const CODEX_BRIDGE_MCP_DEFAULT_URL = 'http://127.0.0.1:18000/mcp';
export const CODEX_BRIDGE_MCP_PROTOCOL_VERSION = '2025-03-26';
export const CODEX_BRIDGE_MCP_SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2025-06-18'] as const;
export const CODEX_BRIDGE_MCP_READ_ONLY_PROBE = 'codex_targets';
export const CODEX_BRIDGE_MCP_SAFE_ERROR_NAMES = [
  'AbortError', 'NetworkError', 'NotAllowedError', 'SecurityError', 'TypeError',
] as const;

export type CodexBridgeMcpSafeErrorName = typeof CODEX_BRIDGE_MCP_SAFE_ERROR_NAMES[number];
export type CodexBridgeMcpTargetAddressSpace = 'loopback' | 'local';
export type CodexBridgeMcpNetworkTarget = CodexBridgeMcpTargetAddressSpace | 'external' | 'unknown';

export type CodexBridgeMcpDiagnosticStage =
  | 'request'
  | 'http-response'
  | 'response-stream'
  | 'protocol'
  | 'timeout';

export function safeCodexBridgeMcpErrorName(value: unknown): CodexBridgeMcpSafeErrorName | undefined {
  try {
    if (typeof value !== 'object' || value === null || !('name' in value)) return undefined;
    const name = value.name;
    return typeof name === 'string' && CODEX_BRIDGE_MCP_SAFE_ERROR_NAMES.includes(name as CodexBridgeMcpSafeErrorName)
      ? name as CodexBridgeMcpSafeErrorName
      : undefined;
  } catch {
    return undefined;
  }
}

function parseIpv4(hostname: string): readonly [number, number, number, number] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  if (!octets.every((part) => part >= 0 && part <= 255)) return null;
  return octets as unknown as readonly [number, number, number, number];
}

function classifyLocalHostname(hostnameValue: string): CodexBridgeMcpTargetAddressSpace | null {
  const hostname = hostnameValue.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (hostname === 'localhost' || hostname === '::1') return 'loopback';

  const ipv4 = parseIpv4(hostname);
  if (ipv4) {
    const [first, second] = ipv4;
    if (first === 127) return 'loopback';
    if (first === 10 || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168) || (first === 169 && second === 254)) return 'local';
    return null;
  }

  if (hostname.endsWith('.local')) return 'local';
  if (hostname.includes(':')) {
    const firstHextet = Number.parseInt(hostname.split(':', 1)[0] || '0', 16);
    if (!Number.isFinite(firstHextet)) return null;
    if ((firstHextet >= 0xfc00 && firstHextet <= 0xfdff)
      || (firstHextet >= 0xfe80 && firstHextet <= 0xfebf)) return 'local';
    if ((firstHextet & 0xe000) === 0x2000) return null;
  }
  return null;
}

export function classifyCodexBridgeMcpNetworkTarget(value: string): CodexBridgeMcpNetworkTarget {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    return 'unknown';
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') return 'unknown';
  const localTarget = classifyLocalHostname(endpoint.hostname);
  if (localTarget) return localTarget;
  if (parseIpv4(endpoint.hostname.replace(/^\[|\]$/g, ''))) return 'external';
  if (endpoint.hostname.includes(':')) {
    const firstHextet = Number.parseInt(endpoint.hostname.replace(/^\[|\]$/g, '').split(':', 1)[0] || '0', 16);
    if (Number.isFinite(firstHextet) && (firstHextet & 0xe000) === 0x2000) return 'external';
  }
  return 'unknown';
}

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
  | 'running-only-unsupported'
  | 'readonly-probe-failed'
  | 'response-too-large'
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
  | Readonly<{
      ok: false;
      reason: CodexBridgeMcpDiagnosticCode;
      stage?: CodexBridgeMcpDiagnosticStage;
      httpStatus?: number;
      errorName?: CodexBridgeMcpSafeErrorName;
    }>;

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
  turnId: string | null;
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
  runningOnly?: boolean;
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
