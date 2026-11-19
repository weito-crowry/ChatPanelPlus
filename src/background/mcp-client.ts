import {
  CODEX_BRIDGE_MCP_PROTOCOL_VERSION,
  CODEX_BRIDGE_MCP_READ_ONLY_PROBE,
  isSupportedCodexBridgeMcpProtocolVersion,
  type CodexBridgeLastTurn,
  type CodexBridgeObservation,
  type CodexBridgeTarget,
  type CodexBridgeThread,
  type CodexBridgeThreadPage,
  type CodexBridgeThreadStatus,
  type CodexBridgeMcpProtocolVersion,
} from '../shared/codexbridge-mcp-protocol.ts';
import type { CodexBridgeFinalAnswerResult } from '../shared/codexbridge-thread-monitor-protocol.ts';
import { McpTransportError, StreamableHttpMcpTransport } from './mcp-transport.ts';
import { parseCodexBridgeFinalAnswer } from './codexbridge-final-answer.ts';

type InitializeResult = Readonly<{ protocolVersion?: unknown }>;
type ToolsListResult = Readonly<{ tools?: unknown }>;

export type McpConnectionTestResult = Readonly<{
  protocolVersion: string;
  toolCount: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x200e || code === 0x200f
      || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) ? ' ' : character;
  }).join('');
  return cleaned.slice(0, maxLength).trim() || null;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

function identifier(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
    || value.trim() !== value || hasControlCharacters(value)) return null;
  return value;
}

function readTimestamp(value: unknown): string | null {
  let timestamp: number;
  if (typeof value === 'string') {
    timestamp = Date.parse(value);
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    // Bridge numeric timestamps use Unix seconds below 10^11 and milliseconds above it.
    timestamp = value > 100_000_000_000 ? value : value * 1000;
  } else {
    return null;
  }
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function readThreadUpdatedAt(value: unknown): string | null {
  if (typeof value !== 'number') return readTimestamp(value);
  if (!Number.isSafeInteger(value)) return null;
  // Codex App Server Thread.updatedAt is an integer Unix timestamp in seconds.
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function readToolPayload(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || value.isError === true) throw new McpTransportError('readonly-probe-failed');
  const structured = value.structuredContent ?? value.structured_content;
  if (isRecord(structured)) return structured;
  if (Array.isArray(value.content)) {
    for (const item of value.content) {
      if (!isRecord(item) || item.type !== 'text' || typeof item.text !== 'string') continue;
      try {
        const parsed: unknown = JSON.parse(item.text);
        if (isRecord(parsed)) return parsed;
      } catch {
        continue;
      }
    }
  }
  throw new McpTransportError('protocol-error');
}

function readObservation(value: unknown): CodexBridgeObservation | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new McpTransportError('protocol-error');
  const turnId = value.turn_id === undefined || value.turn_id === null ? null : identifier(value.turn_id);
  if (value.turn_id !== undefined && value.turn_id !== null && !turnId) throw new McpTransportError('protocol-error');
  return {
    turnId,
    state: boundedText(value.state, 80),
    evidence: boundedText(value.evidence, 80),
    reason: boundedText(value.reason, 160),
    observedAt: readTimestamp(value.observed_at),
    needsAttention: typeof value.needs_attention === 'boolean' ? value.needs_attention : null,
  };
}

function readLastTurn(value: unknown): CodexBridgeLastTurn | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new McpTransportError('protocol-error');
  const turnId = value.turn_id === undefined || value.turn_id === null ? null : identifier(value.turn_id);
  if (value.turn_id !== undefined && value.turn_id !== null && !turnId) throw new McpTransportError('protocol-error');
  const statuses = ['completed', 'failed', 'interrupted', 'in_progress', 'unknown'] as const;
  const status = typeof value.status === 'string'
    ? statuses.includes(value.status as typeof statuses[number]) ? value.status as typeof statuses[number] : 'unknown'
    : null;
  return {
    turnId,
    status,
    category: boundedText(value.category, 80),
    evidence: boundedText(value.evidence, 80),
    reason: boundedText(value.reason, 160),
    observedAt: readTimestamp(value.observed_at),
    needsAttention: typeof value.needs_attention === 'boolean' ? value.needs_attention : null,
  };
}

function readTargets(value: unknown): readonly CodexBridgeTarget[] {
  const payload = readToolPayload(value);
  if (!Array.isArray(payload.targets) || payload.targets.length > 100) throw new McpTransportError('protocol-error');
  return payload.targets.map((item): CodexBridgeTarget => {
    if (!isRecord(item)) throw new McpTransportError('protocol-error');
    const id = identifier(item.id);
    const name = boundedText(item.name, 160);
    if (!id || !name) throw new McpTransportError('protocol-error');
    return {
      id,
      name,
      kind: boundedText(item.kind, 80),
      available: typeof item.available === 'boolean' ? item.available : null,
    };
  });
}

function readThreads(value: unknown, targetId: string): CodexBridgeThreadPage {
  const payload = readToolPayload(value);
  if (!Array.isArray(payload.threads) || payload.threads.length > 100) throw new McpTransportError('protocol-error');
  const external = payload.external_threads === undefined ? [] : payload.external_threads;
  if (!Array.isArray(external) || external.length > 100) throw new McpTransportError('protocol-error');
  const unique = new Map<string, CodexBridgeThread>();
  for (const item of [...payload.threads, ...external]) {
    if (!isRecord(item)) throw new McpTransportError('protocol-error');
    const id = identifier(item.id ?? item.thread_id);
    const rowTarget = item.target_id === undefined ? targetId : identifier(item.target_id);
    if (!id || !rowTarget || rowTarget !== targetId) throw new McpTransportError('protocol-error');
    const thread: CodexBridgeThread = {
      targetId,
      id,
      title: boundedText(item.name, 240) ?? boundedText(item.title, 240),
      preview: boundedText(item.preview, 240),
      cwd: boundedText(item.cwd, 240),
      updatedAt: readThreadUpdatedAt(item.updatedAt) ?? readThreadUpdatedAt(item.updated_at),
      currentExecution: readObservation(item.current_execution),
      lastTurn: readLastTurn(item.last_turn),
      needsAttention: typeof item.needs_attention === 'boolean' ? item.needs_attention : null,
    };
    const key = `${targetId}\u0000${id}`;
    if (!unique.has(key)) unique.set(key, thread);
  }
  const cursor = payload.next_cursor ?? payload.nextCursor;
  if (cursor !== undefined && cursor !== null && (typeof cursor !== 'string' || cursor.length > 2048)) {
    throw new McpTransportError('protocol-error');
  }
  return { threads: [...unique.values()], nextCursor: typeof cursor === 'string' && cursor.length > 0 ? cursor : null };
}

function readStatus(value: unknown, targetId: string, threadId: string): CodexBridgeThreadStatus {
  const payload = readToolPayload(value);
  if (!['state', 'current_execution', 'last_turn', 'needs_attention'].some((key) => key in payload)) {
    throw new McpTransportError('protocol-error');
  }
  return {
    targetId,
    threadId,
    state: boundedText(payload.state, 80),
    currentExecution: readObservation(payload.current_execution),
    lastTurn: readLastTurn(payload.last_turn),
    needsAttention: typeof payload.needs_attention === 'boolean' ? payload.needs_attention : null,
  };
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
  private availableTools: ReadonlySet<string> | null = null;
  private initializeFlight: Promise<void> | null = null;
  private toolsFlight: Promise<readonly Record<string, unknown>[]> | null = null;
  private sessionEpoch = 0;

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
      await this.initializeSession(true);
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

  async readTargets(): Promise<readonly CodexBridgeTarget[]> {
    return readTargets(await this.callReadonlyTool('codex_targets', {}));
  }

  async readThreads(targetId: string, cursor?: string): Promise<CodexBridgeThreadPage> {
    return readThreads(await this.callReadonlyTool('codex_threads', {
      target_id: targetId,
      include_history: false,
      limit: 20,
      ...(cursor === undefined ? {} : { cursor }),
    }), targetId);
  }

  async readStatus(targetId: string, threadId: string): Promise<CodexBridgeThreadStatus> {
    return readStatus(await this.callReadonlyTool('codex_status', { thread_id: threadId }), targetId, threadId);
  }

  async readFinalAnswer(targetId: string, threadId: string, turnId: string): Promise<CodexBridgeFinalAnswerResult> {
    try {
      const payload = readToolPayload(await this.callReadonlyTool('codex_threads', {
        thread_id: threadId,
        target_id: targetId,
        include_history: true,
      }));
      return parseCodexBridgeFinalAnswer(payload, threadId, turnId);
    } catch (error) {
      if (error instanceof McpTransportError && error.code === 'response-too-large') {
        return { status: 'incomplete', reason: 'history-too-large', completeness: 'unconfirmed' };
      }
      throw error;
    }
  }

  private async initializeSession(force = false): Promise<void> {
    if (!force && this.negotiatedProtocolVersion) return;
    if (this.initializeFlight) return this.initializeFlight;
    const flight = this.initializeSessionOnce().catch(async (error) => {
      if (!isSessionExpired(error)) throw error;
      await this.initializeSessionOnce();
    });
    this.initializeFlight = flight;
    try {
      await flight;
    } finally {
      if (this.initializeFlight === flight) this.initializeFlight = null;
    }
  }

  private async initializeSessionOnce(): Promise<void> {
    this.transport.clearSession();
    this.negotiatedProtocolVersion = null;
    this.availableTools = null;
    this.toolsFlight = null;
    const result = await this.transport.request<InitializeResult>('initialize', {
      protocolVersion: CODEX_BRIDGE_MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'ChatPanelPlus', version: '0.1.5' },
    });
    if (typeof result.protocolVersion !== 'string') throw new McpTransportError('protocol-error');
    if (!isSupportedCodexBridgeMcpProtocolVersion(result.protocolVersion)) {
      throw new McpTransportError('protocol-version-unsupported');
    }
    this.transport.setProtocolVersion(result.protocolVersion);
    await this.transport.notify('notifications/initialized');
    this.negotiatedProtocolVersion = result.protocolVersion;
    this.sessionEpoch += 1;
  }

  private async listToolsWithRecovery(): Promise<readonly Record<string, unknown>[]> {
    if (this.availableTools) return [...this.availableTools].map((name) => ({ name }));
    if (this.toolsFlight) return this.toolsFlight;
    const flight = this.listToolsOnceWithRecovery();
    this.toolsFlight = flight;
    try {
      return await flight;
    } finally {
      if (this.toolsFlight === flight) this.toolsFlight = null;
    }
  }

  private async listToolsOnceWithRecovery(): Promise<readonly Record<string, unknown>[]> {
    try {
      return await this.listTools();
    } catch (error) {
      if (!isSessionExpired(error)) throw error;
      await this.initializeSession(true);
      return this.listTools();
    }
  }

  private async listTools(): Promise<readonly Record<string, unknown>[]> {
    const result = await this.transport.request<ToolsListResult>('tools/list', {});
    const tools = readTools(result);
    this.availableTools = new Set(tools.map(({ name }) => name as string));
    return tools;
  }

  private async callTool(name: string, argumentsValue: Record<string, unknown>): Promise<void> {
    const result: unknown = await this.transport.request('tools/call', { name, arguments: argumentsValue });
    if (isRecord(result) && result.isError === true) throw new McpTransportError('readonly-probe-failed');
    if (!isRecord(result)) throw new McpTransportError('protocol-error');
  }

  private async callReadonlyTool(name: 'codex_targets' | 'codex_threads' | 'codex_status', argumentsValue: Record<string, unknown>): Promise<unknown> {
    if (!this.negotiatedProtocolVersion) await this.initializeSession();
    let availableTools = this.availableTools;
    if (!availableTools) {
      await this.listToolsWithRecovery();
      availableTools = this.availableTools;
    }
    if (!availableTools?.has(name)) throw new McpTransportError('readonly-tool-unavailable');
    const requestSessionEpoch = this.sessionEpoch;
    try {
      return await this.callToolResult(name, argumentsValue);
    } catch (error) {
      if (!isSessionExpired(error)) throw error;
      if (this.sessionEpoch === requestSessionEpoch) await this.initializeSession(true);
      else if (!this.negotiatedProtocolVersion) await this.initializeSession();
      await this.listToolsWithRecovery();
      availableTools = this.availableTools;
      if (!availableTools?.has(name)) throw new McpTransportError('readonly-tool-unavailable');
      return this.callToolResult(name, argumentsValue);
    }
  }

  private async callToolResult(name: string, argumentsValue: Record<string, unknown>): Promise<unknown> {
    const result: unknown = await this.transport.request('tools/call', { name, arguments: argumentsValue });
    if (isRecord(result) && result.isError === true) throw new McpTransportError('readonly-probe-failed');
    if (!isRecord(result)) throw new McpTransportError('protocol-error');
    return result;
  }
}
