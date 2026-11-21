import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_BRIDGE_MCP_TEST_MESSAGE,
  CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY,
} from '../src/shared/codexbridge-mcp-protocol.ts';
import {
  createCodexBridgeMcpTestHandler,
} from '../src/background/codexbridge-mcp.ts';
import { CodexBridgeMcpClient } from '../src/background/mcp-client.ts';
import { McpTransportError } from '../src/background/mcp-transport.ts';

type RecordedRequest = Readonly<{
  payload: Record<string, unknown>;
  headers: Headers;
  init: RequestInit;
}>;

function jsonRpcResponse(id: number, result: unknown, sessionId?: string): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (sessionId) headers.set('Mcp-Session-Id', sessionId);
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200, headers });
}

function sseResponse(id: number, result: unknown): Response {
  const event = JSON.stringify({ jsonrpc: '2.0', id, result });
  return new Response(`event: message\ndata: ${event}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function recordRequest(_input: RequestInfo | URL, init?: RequestInit): RecordedRequest {
  return {
    payload: JSON.parse(String(init?.body)) as Record<string, unknown>,
    headers: new Headers(init?.headers),
    init: init ?? {},
  };
}

function createHandler(
  fetchImpl: typeof fetch,
  options: { permission?: boolean; permissionFailure?: boolean; token?: string; timeoutMs?: number } = {},
) {
  let containsOrigins: string[] = [];
  const token = options.token;
  const handler = createCodexBridgeMcpTestHandler({
    sessionStorage: {
      async get() {
        return token === undefined ? {} : { [CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY]: token };
      },
    },
    permissions: {
      async contains({ origins }) {
        containsOrigins = origins;
        if (options.permissionFailure) throw new TypeError('private permission detail');
        return options.permission ?? true;
      },
    },
    extensionId: 'test-extension',
    optionsPageUrl: 'chrome-extension://test-extension/index.html',
    fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  return {
    handler,
    get containsOrigins() { return containsOrigins; },
  };
}

const trustedSender = {
  id: 'test-extension',
  url: 'chrome-extension://test-extension/index.html',
};
const testMessage = {
  type: CODEX_BRIDGE_MCP_TEST_MESSAGE,
  endpoint: 'http://127.0.0.1:18000/mcp',
};

test('JSON Streamable HTTP negotiates session and protocol headers and calls only codex_targets', async () => {
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = recordRequest(input, init);
    requests.push(request);
    const { id, method } = request.payload;
    if (method === 'initialize') return jsonRpcResponse(id as number, { protocolVersion: '2025-03-26' }, 'session-json');
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (method === 'tools/list') {
      return jsonRpcResponse(id as number, {
        tools: [
          { name: 'codex_targets' },
          { name: 'codex_threads' },
          { name: 'codex_status' },
          { name: 'codex_wait' },
        ],
      });
    }
    if (method === 'tools/call') return jsonRpcResponse(id as number, { content: [{ type: 'text', text: 'private result' }] });
    return new Response(null, { status: 400 });
  };
  const { handler } = createHandler(fetchImpl, { token: 'mcp-test-secret' });

  const result = await handler(testMessage, trustedSender);

  assert.deepEqual(result, {
    ok: true,
    protocolVersion: '2025-03-26',
    toolCount: 4,
    readOnlyProbe: 'codex_targets',
  });
  assert.deepEqual(requests.map(({ payload }) => payload.method), [
    'initialize', 'notifications/initialized', 'tools/list', 'tools/call',
  ]);
  assert.equal((requests[0]?.payload.params as { protocolVersion?: string }).protocolVersion, '2025-03-26');
  assert.equal(requests[0]?.headers.get('mcp-session-id'), null);
  assert.equal(requests[0]?.headers.get('mcp-protocol-version'), null);
  for (const request of requests.slice(1)) {
    assert.equal(request.headers.get('mcp-session-id'), 'session-json');
    assert.equal(request.headers.get('mcp-protocol-version'), '2025-03-26');
    assert.equal(request.headers.get('authorization'), 'Bearer mcp-test-secret');
    assert.equal(request.init.credentials, 'omit');
  }
  assert.ok(requests.every(({ init }) => (init as RequestInit & { targetAddressSpace?: string }).targetAddressSpace === 'loopback'));
  const toolCall = requests.find(({ payload }) => payload.method === 'tools/call')?.payload;
  assert.deepEqual(toolCall?.params, { name: 'codex_targets', arguments: {} });
  assert.equal(JSON.stringify(result).includes('mcp-test-secret'), false);
  assert.equal(JSON.stringify(result).includes('private result'), false);
});

test('2025-06-18 is accepted and becomes the protocol header for all later requests', async () => {
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = recordRequest(input, init);
    requests.push(request);
    const { id, method } = request.payload;
    if (method === 'initialize') return jsonRpcResponse(id as number, { protocolVersion: '2025-06-18' }, 'session-2025-06-18');
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (method === 'tools/list') return jsonRpcResponse(id as number, { tools: [{ name: 'codex_targets' }] });
    if (method === 'tools/call') return jsonRpcResponse(id as number, { content: [], isError: false });
    return new Response(null, { status: 400 });
  };
  const { handler } = createHandler(fetchImpl);

  const result = await handler(testMessage, trustedSender);

  assert.deepEqual(result, {
    ok: true,
    protocolVersion: '2025-06-18',
    toolCount: 1,
    readOnlyProbe: 'codex_targets',
  });
  assert.equal((requests[0]?.payload.params as { protocolVersion?: string }).protocolVersion, '2025-03-26');
  assert.deepEqual(requests.map(({ payload }) => payload.method), [
    'initialize', 'notifications/initialized', 'tools/list', 'tools/call',
  ]);
  for (const request of requests.slice(1)) {
    assert.equal(request.headers.get('mcp-session-id'), 'session-2025-06-18');
    assert.equal(request.headers.get('mcp-protocol-version'), '2025-06-18');
  }
  assert.deepEqual((requests.at(-1)?.payload.params as { name?: string }).name, 'codex_targets');
});

test('unknown and malformed negotiated protocol versions are rejected before initialized or tool requests', async () => {
  const cases: readonly Readonly<{ protocolVersion: unknown; reason: string }>[] = [
    { protocolVersion: '2025-11-25', reason: 'protocol-version-unsupported' },
    { protocolVersion: 'unknown-version', reason: 'protocol-version-unsupported' },
    { protocolVersion: 2025, reason: 'protocol-error' },
    { protocolVersion: null, reason: 'protocol-error' },
    { protocolVersion: {}, reason: 'protocol-error' },
  ];
  for (const { protocolVersion, reason } of cases) {
    const requests: RecordedRequest[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = recordRequest(input, init);
      requests.push(request);
      if (request.payload.method === 'initialize') {
        return jsonRpcResponse(request.payload.id as number, { protocolVersion }, 'session-unaccepted');
      }
      return new Response(null, { status: 500 });
    };
    const { handler } = createHandler(fetchImpl);

    assert.deepEqual(await handler(testMessage, trustedSender), { ok: false, reason, stage: 'protocol' });
    assert.deepEqual(requests.map(({ payload }) => payload.method), ['initialize']);
  }
});

test('SSE responses work and a 404 session expiry reinitializes before retrying the read-only probe', async () => {
  const requests: RecordedRequest[] = [];
  let initialized = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = recordRequest(input, init);
    requests.push(request);
    const { id, method } = request.payload;
    if (method === 'initialize') {
      initialized += 1;
      return jsonRpcResponse(id as number, { protocolVersion: '2025-03-26' }, `session-${initialized}`);
    }
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (method === 'tools/list' && request.headers.get('mcp-session-id') === 'session-1') {
      return new Response(null, { status: 404 });
    }
    if (method === 'tools/list') return sseResponse(id as number, { tools: [{ name: 'codex_targets' }] });
    if (method === 'tools/call') return sseResponse(id as number, { content: [{ type: 'text', text: 'redacted target' }] });
    return new Response(null, { status: 400 });
  };
  const { handler } = createHandler(fetchImpl);

  const result = await handler(testMessage, trustedSender);

  assert.deepEqual(result, {
    ok: true,
    protocolVersion: '2025-03-26',
    toolCount: 1,
    readOnlyProbe: 'codex_targets',
  });
  assert.equal(initialized, 2);
  assert.equal(requests.filter(({ payload }) => payload.method === 'tools/list').length, 2);
  assert.equal(requests.filter(({ payload }) => payload.method === 'tools/call').length, 1);
  assert.equal(requests.filter(({ payload }) => payload.method === 'tools/call')
    .every(({ payload }) => (payload.params as { name?: string }).name === 'codex_targets'), true);
  assert.equal(requests.at(-1)?.headers.get('mcp-session-id'), 'session-2');
  assert.equal(requests.at(-1)?.headers.get('mcp-protocol-version'), '2025-03-26');
});

test('running_only capability is rechecked after session expiry before retrying the read', async () => {
  const requests: RecordedRequest[] = [];
  let initialized = 0;
  let toolsListCount = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = recordRequest(input, init);
    requests.push(request);
    const { id, method } = request.payload;
    if (method === 'initialize') {
      initialized += 1;
      return jsonRpcResponse(id as number, { protocolVersion: '2025-03-26' }, `session-${initialized}`);
    }
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (method === 'tools/list') {
      toolsListCount += 1;
      return jsonRpcResponse(id as number, { tools: [{ name: 'codex_threads', ...(toolsListCount === 1
        ? { inputSchema: { properties: { running_only: { type: 'boolean' } } } } : {}) }] });
    }
    if (method === 'tools/call') return new Response(null, { status: 404 });
    return new Response(null, { status: 400 });
  };
  const client = new CodexBridgeMcpClient('http://127.0.0.1:18000/mcp', '', { fetchImpl });

  await assert.rejects(client.readThreads('machine-1', undefined, true), (error: unknown) =>
    error instanceof McpTransportError && error.code === 'running-only-unsupported');

  assert.equal(initialized, 2);
  assert.equal(toolsListCount, 2);
  assert.equal(requests.filter(({ payload }) => payload.method === 'tools/call').length, 1);
});

test('connection diagnostics classify HTTP responses, request failure, timeout, and expired session without raw details', async () => {
  for (const [status, reason] of [
    [401, 'authentication-required'],
    [403, 'forbidden'],
    [404, 'endpoint-not-found'],
    [502, 'http-error'],
  ] as const) {
    const { handler } = createHandler(async () => new Response(null, { status }));
    assert.deepEqual(await handler(testMessage, trustedSender), {
      ok: false, reason, stage: 'http-response', httpStatus: status,
    });
  }

  const disconnected = createHandler(async () => { throw new TypeError('private network detail'); });
  assert.deepEqual(await disconnected.handler(testMessage, trustedSender), {
    ok: false, reason: 'disconnected', stage: 'request', errorName: 'TypeError',
  });
  const unsafeName = createHandler(async () => {
    const error = new Error('private message containing a credential');
    error.name = 'PrivateCredentialName';
    throw error;
  });
  const safeFailure = await unsafeName.handler(testMessage, trustedSender);
  assert.deepEqual(safeFailure, { ok: false, reason: 'disconnected', stage: 'request' });
  assert.equal(JSON.stringify(safeFailure).includes('credential'), false);
  assert.equal(JSON.stringify(safeFailure).includes('PrivateCredentialName'), false);

  const timeout = createHandler((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }), { timeoutMs: 5 });
  assert.deepEqual(await timeout.handler(testMessage, trustedSender), { ok: false, reason: 'timeout', stage: 'timeout' });

  const expired = createHandler(async (input, init) => {
    const request = recordRequest(input, init);
    const { id, method } = request.payload;
    if (method === 'initialize') return jsonRpcResponse(id as number, { protocolVersion: '2025-03-26' }, 'expired-session');
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    return new Response(null, { status: 404 });
  });
  assert.deepEqual(await expired.handler(testMessage, trustedSender), {
    ok: false, reason: 'session-expired', stage: 'http-response', httpStatus: 404,
  });
});

test('SSE stream read failures are distinct from fetch rejection and omit raw exception messages', async () => {
  const fetchImpl: typeof fetch = async () => new Response(new ReadableStream({
    start(controller) { controller.error(new TypeError('private stream body detail')); },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const { handler } = createHandler(fetchImpl);

  const result = await handler(testMessage, trustedSender);

  assert.deepEqual(result, {
    ok: false, reason: 'disconnected', stage: 'response-stream', errorName: 'TypeError',
  });
  assert.equal(JSON.stringify(result).includes('private stream body detail'), false);
});

test('protocol response size failures remain classified for the Options diagnostic', async () => {
  const { handler } = createHandler(async () => new Response(null, {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-length': String(8 * 1024 * 1024 + 1) },
  }));
  assert.deepEqual(await handler(testMessage, trustedSender), {
    ok: false, reason: 'response-too-large', stage: 'protocol',
  });
});

test('read-only monitor transport keeps the legacy disconnected error code', async () => {
  const client = new CodexBridgeMcpClient('http://127.0.0.1:18000/mcp', '', {
    fetchImpl: async () => { throw new TypeError('private connection detail'); },
  });
  await assert.rejects(client.readTargets(), (error: unknown) =>
    error instanceof McpTransportError && error.code === 'disconnected');
});

test('host permission denial prevents fetch, and only the Options page can request a connection check', async () => {
  let fetchCount = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCount += 1;
    return new Response(null, { status: 500 });
  };
  const denied = createHandler(fetchImpl, { permission: false });

  assert.deepEqual(await denied.handler(testMessage, trustedSender), { ok: false, reason: 'permission-required' });
  assert.deepEqual(denied.containsOrigins, ['http://127.0.0.1/*']);
  assert.equal(fetchCount, 0);
  assert.equal(await denied.handler(testMessage, { id: 'test-extension', url: 'https://chatgpt.com/c/example' }), null);
  assert.equal(fetchCount, 0);
});

test('host permission API rejection is reported as permission-required without starting fetch', async () => {
  let fetchCount = 0;
  const { handler } = createHandler(async () => {
    fetchCount += 1;
    return new Response(null, { status: 200 });
  }, { permissionFailure: true });
  assert.deepEqual(await handler(testMessage, trustedSender), { ok: false, reason: 'permission-required' });
  assert.equal(fetchCount, 0);
});

test('a fresh handler can reconnect from session storage without retaining a worker session', async () => {
  const storage = {
    async get() { return { [CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY]: 'restart-secret' }; },
  };
  let initializeCount = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = recordRequest(input, init);
    const { id, method } = request.payload;
    if (method === 'initialize') {
      initializeCount += 1;
      return jsonRpcResponse(id as number, { protocolVersion: '2025-03-26' }, `worker-${initializeCount}`);
    }
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (method === 'tools/list') return jsonRpcResponse(id as number, { tools: [{ name: 'codex_targets' }] });
    if (method === 'tools/call') return jsonRpcResponse(id as number, { content: [] });
    return new Response(null, { status: 400 });
  };
  const options = {
    sessionStorage: storage,
    permissions: { async contains() { return true; } },
    extensionId: 'test-extension',
    optionsPageUrl: 'chrome-extension://test-extension/index.html',
    fetchImpl,
  };
  const firstWorker = createCodexBridgeMcpTestHandler(options);
  const secondWorker = createCodexBridgeMcpTestHandler(options);

  assert.equal((await firstWorker(testMessage, trustedSender))?.ok, true);
  assert.equal((await secondWorker(testMessage, trustedSender))?.ok, true);
  assert.equal(initializeCount, 2);
});

test('a reused client initializes and lists tools once for multiple status reads, then recovers a 404 session read-only', async () => {
  const requests: RecordedRequest[] = [];
  let sessionCount = 0;
  let expireFirstStatus = true;
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = recordRequest(input, init);
    requests.push(request);
    const { id, method } = request.payload;
    if (method === 'initialize') {
      sessionCount += 1;
      return jsonRpcResponse(id as number, { protocolVersion: '2025-03-26' }, `monitor-session-${sessionCount}`);
    }
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (method === 'tools/list') return jsonRpcResponse(id as number, { tools: [{ name: 'codex_status' }] });
    if (method === 'tools/call' && expireFirstStatus && request.headers.get('mcp-session-id') === 'monitor-session-1') {
      expireFirstStatus = false;
      return new Response(null, { status: 404 });
    }
    if (method === 'tools/call') return jsonRpcResponse(id as number, {
      content: [],
      structuredContent: {
        state: 'not_loaded',
        current_execution: { state: 'unknown', turn_id: 'active-turn' },
        last_turn: { turn_id: 'completed-turn', status: 'completed' },
      },
    });
    return new Response(null, { status: 400 });
  };
  const client = new CodexBridgeMcpClient('http://127.0.0.1:18000/mcp', 'monitor-token', { fetchImpl });

  const first = await client.readStatus('machine-1', 'machine-1::thread-1');
  const second = await client.readStatus('machine-2', 'machine-2::thread-2');

  assert.equal(first.currentExecution?.turnId, 'active-turn');
  assert.equal(second.lastTurn?.turnId, 'completed-turn');
  assert.equal(requests.filter(({ payload }) => payload.method === 'initialize').length, 2);
  assert.equal(requests.filter(({ payload }) => payload.method === 'tools/list').length, 2);
  assert.equal(requests.filter(({ payload }) => payload.method === 'tools/call').length, 3);
  for (const request of requests.filter(({ payload }) => payload.method === 'tools/call')) {
    assert.deepEqual((request.payload.params as { name?: string }).name, 'codex_status');
    assert.equal((request.payload.params as { arguments?: unknown }).arguments && typeof (request.payload.params as { arguments?: unknown }).arguments, 'object');
  }
  assert.equal(JSON.stringify(first).includes('monitor-token'), false);
});

test('concurrent reads share one initial MCP handshake and tools list', async () => {
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = recordRequest(input, init);
    requests.push(request);
    const { id, method } = request.payload;
    if (method === 'initialize') return jsonRpcResponse(id as number, { protocolVersion: '2025-03-26' }, 'parallel-session');
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (method === 'tools/list') return jsonRpcResponse(id as number, { tools: [{ name: 'codex_status' }] });
    if (method === 'tools/call') return jsonRpcResponse(id as number, {
      content: [], structuredContent: { state: 'unknown', last_turn: { status: 'unknown' } },
    });
    return new Response(null, { status: 400 });
  };
  const client = new CodexBridgeMcpClient('http://127.0.0.1:18000/mcp', '', { fetchImpl });

  await Promise.all([
    client.readStatus('machine-1', 'machine-1::thread-1'),
    client.readStatus('machine-2', 'machine-2::thread-2'),
  ]);

  assert.equal(requests.filter(({ payload }) => payload.method === 'initialize').length, 1);
  assert.equal(requests.filter(({ payload }) => payload.method === 'tools/list').length, 1);
  assert.equal(requests.filter(({ payload }) => payload.method === 'tools/call').length, 2);
});

test('staggered 404 responses during parallel reads share one session reinitialization', async () => {
  const requests: RecordedRequest[] = [];
  let sessionCount = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = recordRequest(input, init);
    requests.push(request);
    const { id, method } = request.payload;
    if (method === 'initialize') {
      sessionCount += 1;
      return jsonRpcResponse(id as number, { protocolVersion: '2025-03-26' }, `staggered-${sessionCount}`);
    }
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (method === 'tools/list') return jsonRpcResponse(id as number, { tools: [{ name: 'codex_status' }] });
    if (method === 'tools/call' && request.headers.get('mcp-session-id') === 'staggered-1') {
      const args = (request.payload.params as { arguments?: { thread_id?: string } }).arguments;
      if (args?.thread_id?.endsWith('thread-2')) await new Promise((resolve) => setTimeout(resolve, 25));
      return new Response(null, { status: 404 });
    }
    if (method === 'tools/call') return jsonRpcResponse(id as number, {
      content: [], structuredContent: { state: 'unknown', last_turn: { status: 'unknown' } },
    });
    return new Response(null, { status: 400 });
  };
  const client = new CodexBridgeMcpClient('http://127.0.0.1:18000/mcp', '', { fetchImpl });

  await Promise.all([
    client.readStatus('machine-1', 'machine-1::thread-1'),
    client.readStatus('machine-2', 'machine-2::thread-2'),
  ]);

  assert.equal(requests.filter(({ payload }) => payload.method === 'initialize').length, 2);
  assert.equal(requests.filter(({ payload }) => payload.method === 'tools/list').length, 2);
  assert.equal(requests.filter(({ payload }) => payload.method === 'tools/call').length, 4);
});
