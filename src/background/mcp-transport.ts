export type McpFailureCode =
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
  | 'response-too-large';

export class McpTransportError extends Error {
  readonly code: McpFailureCode;

  constructor(code: McpFailureCode) {
    super(code);
    this.name = 'McpTransportError';
    this.code = code;
  }
}
type JsonRpcEnvelope = Readonly<Record<string, unknown>>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const MAX_MCP_RESPONSE_BYTES = 8 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function responseForId(value: unknown, expectedId: number): JsonRpcEnvelope | null {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    if (isRecord(candidate) && candidate.jsonrpc === '2.0' && candidate.id === expectedId) return candidate;
  }
  return null;
}

function parseSseData(frame: string): unknown | undefined {
  const data = frame.split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (!data) return undefined;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return undefined;
  }
}

export class StreamableHttpMcpTransport {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private nextId = 0;
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;

  constructor(endpoint: string, token: string, options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}) {
    this.endpoint = endpoint;
    this.token = token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  clearSession(): void {
    this.sessionId = null;
    this.protocolVersion = null;
  }

  setProtocolVersion(protocolVersion: string): void {
    this.protocolVersion = protocolVersion;
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    const id = ++this.nextId;
    const result = await this.exchange({ jsonrpc: '2.0', id, method, params }, id, method);
    return result as T;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.exchange({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }, null, method);
  }

  private async exchange(payload: unknown, expectedId: number | null, method: string): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const work = (async () => {
      const headers = new Headers({
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      });
      if (this.token.length > 0) headers.set('Authorization', `Bearer ${this.token}`);
      if (this.sessionId) headers.set('Mcp-Session-Id', this.sessionId);
      if (this.protocolVersion) headers.set('MCP-Protocol-Version', this.protocolVersion);

      let response: Response;
      try {
        response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal,
        });
      } catch {
        throw new McpTransportError('disconnected');
      }

      if (response.status === 401) throw new McpTransportError('authentication-required');
      if (response.status === 403) throw new McpTransportError('forbidden');
      if (response.status === 404) {
        throw new McpTransportError(this.sessionId ? 'session-expired' : 'endpoint-not-found');
      }
      if (!response.ok) throw new McpTransportError('http-error');
      if (expectedId === null) return undefined;

      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      const matched = contentType === 'application/json'
        ? await this.readJsonResponse(response, expectedId)
        : contentType === 'text/event-stream'
          ? await this.readSseResponse(response, expectedId)
          : null;
      if (!matched) throw new McpTransportError('protocol-error');
      if (method === 'initialize') this.sessionId = response.headers.get('mcp-session-id');
      if ('error' in matched || !('result' in matched)) throw new McpTransportError('protocol-error');
      return matched.result;
    })();
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new McpTransportError('timeout'));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([work, timeout]);
    } catch (error) {
      if (timedOut) throw new McpTransportError('timeout');
      if (error instanceof McpTransportError) throw error;
      throw new McpTransportError('disconnected');
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }

  private async readJsonResponse(response: Response, expectedId: number): Promise<JsonRpcEnvelope | null> {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MCP_RESPONSE_BYTES) {
      throw new McpTransportError('response-too-large');
    }
    if (!response.body) throw new McpTransportError('protocol-error');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let byteCount = 0;
    let text = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (value) {
          byteCount += value.byteLength;
          if (byteCount > MAX_MCP_RESPONSE_BYTES) throw new McpTransportError('response-too-large');
          text += decoder.decode(value, { stream: !done });
        }
        if (done) break;
      }
      text += decoder.decode();
    } catch (error) {
      if (error instanceof McpTransportError) throw error;
      throw new McpTransportError('protocol-error');
    } finally {
      void reader.cancel().catch(() => {});
    }
    let payload: unknown;
    try { payload = JSON.parse(text) as unknown; } catch { throw new McpTransportError('protocol-error'); }
    return responseForId(payload, expectedId);
  }

  private async readSseResponse(response: Response, expectedId: number): Promise<JsonRpcEnvelope | null> {
    const body = response.body;
    if (!body) throw new McpTransportError('protocol-error');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let byteCount = 0;

    const consumeFrame = (frame: string): JsonRpcEnvelope | null => {
      const payload = parseSseData(frame);
      return payload === undefined ? null : responseForId(payload, expectedId);
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (value) {
          byteCount += value.byteLength;
          if (byteCount > MAX_MCP_RESPONSE_BYTES) throw new McpTransportError('response-too-large');
        }
        buffer += decoder.decode(value, { stream: !done });
        let separator = /\r?\n\r?\n/.exec(buffer);
        while (separator) {
          const frame = buffer.slice(0, separator.index);
          buffer = buffer.slice(separator.index + separator[0].length);
          const matched = consumeFrame(frame);
          if (matched) return matched;
          separator = /\r?\n\r?\n/.exec(buffer);
        }
        if (done) break;
      }
      return consumeFrame(buffer);
    } catch (error) {
      if (error instanceof McpTransportError) throw error;
      throw new McpTransportError('disconnected');
    } finally {
      void reader.cancel().catch(() => {});
    }
  }
}
