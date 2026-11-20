import {
  classifyCodexBridgeMcpNetworkTarget,
  safeCodexBridgeMcpErrorName,
  type CodexBridgeMcpNetworkTarget,
  type CodexBridgeMcpSafeErrorName,
} from '../../src/shared/codexbridge-mcp-protocol.ts';

export type McpLnaPermissionState = 'granted' | 'prompt' | 'denied' | 'unavailable' | 'not-required';
export type McpLnaPermissionName = 'loopback-network' | 'local-network';
export type McpLnaPermissionQuery = (name: McpLnaPermissionName) => Promise<Readonly<{ state: unknown }>>;
export type McpNetworkTarget = CodexBridgeMcpNetworkTarget;
export type McpLocalProbeResult =
  | Readonly<{ status: 'not-applicable' }>
  | Readonly<{ status: 'reached'; httpStatus: number }>
  | Readonly<{ status: 'failed'; failureStage: 'request'; errorName?: CodexBridgeMcpSafeErrorName }>;

export function classifyMcpNetworkTarget(endpoint: string): CodexBridgeMcpNetworkTarget {
  return classifyCodexBridgeMcpNetworkTarget(endpoint);
}

export function lnaPermissionNameForTarget(
  target: CodexBridgeMcpNetworkTarget,
): McpLnaPermissionName | null {
  if (target === 'loopback') return 'loopback-network';
  if (target === 'local') return 'local-network';
  return null;
}

export async function readMcpLnaPermissionState(
  target: CodexBridgeMcpNetworkTarget,
  query: McpLnaPermissionQuery | undefined,
): Promise<McpLnaPermissionState> {
  const name = lnaPermissionNameForTarget(target);
  if (!name) return 'not-required';
  if (!query) return 'unavailable';
  try {
    const result = await query(name);
    return result.state === 'granted' || result.state === 'prompt' || result.state === 'denied'
      ? result.state
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export async function probeMcpLocalNetwork(
  endpoint: string,
  fetchImpl: typeof fetch = fetch,
): Promise<McpLocalProbeResult> {
  const target = classifyMcpNetworkTarget(endpoint);
  if (target !== 'loopback' && target !== 'local') return { status: 'not-applicable' };

  let probeUrl: URL;
  try {
    probeUrl = new URL('/__cpp_lna_probe__', endpoint);
  } catch {
    return { status: 'not-applicable' };
  }
  const addressSpace = target;
  const init: RequestInit & { targetAddressSpace: 'loopback' | 'local' } = {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    targetAddressSpace: addressSpace,
  };

  try {
    const response = await fetchImpl(probeUrl.toString(), init);
    return { status: 'reached', httpStatus: response.status };
  } catch (error) {
    const errorName = safeCodexBridgeMcpErrorName(error);
    return {
      status: 'failed',
      failureStage: 'request',
      ...(errorName ? { errorName } : {}),
    };
  }
}
