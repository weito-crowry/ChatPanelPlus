import {
  CODEX_BRIDGE_MCP_PROTOCOL_VERSION,
  CODEX_BRIDGE_MCP_READ_ONLY_PROBE,
  isSupportedCodexBridgeMcpProtocolVersion,
  type CodexBridgeMcpProtocolVersion,
} from '../shared/codexbridge-mcp-protocol.ts';
import { McpTransportError, StreamableHttpMcpTransport } from './mcp-transport.ts';

type InitializeResult = Readonly<{ protocolVersion?: unknown }>;
type ToolsListResult = Readonly<{ tools?: unknown }>;

export type McpConnectionTestResult = Readonly<{
  protocolVersion: string;
  toolCount: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTools(value: unknown): readonly Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.tools)) throw new McpTransportError('protocol-error');
  if (!value.tools.every(isRecord) || !value.tools.every((tool) => typeof tool.name === 'string')) {
    throw new McpTransportError('protocol-error');
  }
  return value.tools;
}

function isSessionExpired(error: unknown): boolean {
  return error instanceof McpTransportError && error.code === 'session-expired';
}

export class CodexBridgeMcpClient {
  private readonly transport: StreamableHttpMcpTransport;
  private negotiatedProtocolVersion: CodexBridgeMcpProtocolVersion | null = null;

  constructor(endpoint: string, token: string, options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
    this.transport = new StreamableHttpMcpTransport(endpoint, token, options);
  }

  async testReadOnlyConnection(): Promise<McpConnectionTestResult> {
    await this.initializeSession();
    let tools = await this.listToolsWithRecovery();
    if (!tools.some(({ name }) => name === CODEX_BRIDGE_MCP_READ_ONLY_PROBE)) {
      throw new McpTransportError('readonly-tool-unavailable');
    }

    try {
      await this.callTool(CODEX_BRIDGE_MCP_READ_ONLY_PROBE, {});
    } catch (error) {
      if (!isSessionExpired(error)) throw error;
      await this.initializeSession();
      tools = await this.listTools();
      if (!tools.some(({ name }) => name === CODEX_BRIDGE_MCP_READ_ONLY_PROBE)) {
        throw new McpTransportError('readonly-tool-unavailable');
      }
      await this.callTool(CODEX_BRIDGE_MCP_READ_ONLY_PROBE, {});
    }

    if (!this.negotiatedProtocolVersion) throw new McpTransportError('protocol-error');
    return {
      protocolVersion: this.negotiatedProtocolVersion,
      toolCount: tools.length,
    };
  }

  private async initializeSession(): Promise<void> {
    try {
      await this.initializeSessionOnce();
    } catch (error) {
      if (!isSessionExpired(error)) throw error;
      await this.initializeSessionOnce();
    }
  }

  private async initializeSessionOnce(): Promise<void> {
    this.transport.clearSession();
    this.negotiatedProtocolVersion = null;
    const result = await this.transport.request<InitializeResult>('initialize', {
      protocolVersion: CODEX_BRIDGE_MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'ChatPanelPlus', version: '0.1.5' },
    });
    if (typeof result.protocolVersion !== 'string') throw new McpTransportError('protocol-error');
    if (!isSupportedCodexBridgeMcpProtocolVersion(result.protocolVersion)) {
      throw new McpTransportError('protocol-version-unsupported');
    }
    this.negotiatedProtocolVersion = result.protocolVersion;
    this.transport.setProtocolVersion(result.protocolVersion);
    await this.transport.notify('notifications/initialized');
  }

  private async listToolsWithRecovery(): Promise<readonly Record<string, unknown>[]> {
    try {
      return await this.listTools();
    } catch (error) {
      if (!isSessionExpired(error)) throw error;
      await this.initializeSession();
      return this.listTools();
    }
  }

  private async listTools(): Promise<readonly Record<string, unknown>[]> {
    const result = await this.transport.request<ToolsListResult>('tools/list', {});
    return readTools(result);
  }

  private async callTool(name: string, argumentsValue: Record<string, unknown>): Promise<void> {
    const result: unknown = await this.transport.request('tools/call', { name, arguments: argumentsValue });
    if (isRecord(result) && result.isError === true) throw new McpTransportError('readonly-probe-failed');
    if (!isRecord(result)) throw new McpTransportError('protocol-error');
  }
}
