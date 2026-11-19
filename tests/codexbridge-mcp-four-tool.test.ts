import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexBridgeMcpClient } from '../src/background/mcp-client.ts';

type ResponseMode = 'json' | 'sse';
type RecordedRequest = Readonly<{ payload: Record<string, unknown>; headers: Headers; init: RequestInit }>;

const CPP_TOOL_NAMES = ['codex_targets', 'codex_threads', 'codex_status', 'codex_wait'] as const;

function rpcResponse(mode: ResponseMode, id: number, result: unknown, sessionId?: string): Response {
  const headers = new Headers({
    'content-type': mode === 'json' ? 'application/json' : 'text/event-stream',
  });
  if (sessionId) headers.set('mcp-session-id', sessionId);
  const message = JSON.stringify({ jsonrpc: '2.0', id, result });
  const body = mode === 'json' ? message : `event: message\ndata: ${message}\n\n`;
  return new Response(body, { status: 200, headers });
}

for (const mode of ['json', 'sse'] as const) {
  test(`four-tool MCP mock supports read-only client flow and expiry recovery (${mode})`, async () => {
    const requests: RecordedRequest[] = [];
    let sessionCount = 0;
    let expireFirstThreadsCall = true;
    const token = 'integration-test-token';
    const fetchImpl: typeof fetch = async (_input, init) => {
      const request = {
        payload: JSON.parse(String(init?.body)) as Record<string, unknown>,
        headers: new Headers(init?.headers),
        init: init ?? {},
      };
      requests.push(request);
      const { id, method } = request.payload;
      if (method === 'initialize') {
        sessionCount += 1;
        return rpcResponse(mode, id as number, { protocolVersion: '2025-03-26' }, `session-${sessionCount}`);
      }
      if (method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (method === 'tools/list') {
        return rpcResponse(mode, id as number, { tools: CPP_TOOL_NAMES.map((name) => ({ name })) });
      }
      if (method === 'tools/call') {
        const params = request.payload.params as { name: string };
        if (params.name === 'codex_threads' && expireFirstThreadsCall) {
          expireFirstThreadsCall = false;
          return new Response('expired', { status: 404 });
        }
        const structuredContent = params.name === 'codex_targets'
          ? { targets: [{ id: 'machine-1', name: 'Work PC', kind: 'local', available: true }] }
          : params.name === 'codex_threads'
            ? {
              threads: [{ id: 'thread-1', name: 'Native' }],
              external_threads: [{ id: 'thread-1', name: 'Duplicate' }, { id: 'external-1' }],
              next_cursor: 'cursor-2',
            }
            : {
              state: 'not_loaded',
              current_execution: { state: 'unknown', reason: 'execution_unconfirmed' },
              last_turn: { turn_id: 'turn-1', status: 'completed' },
            };
        return rpcResponse(mode, id as number, { structuredContent });
      }
      return new Response(null, { status: 400 });
    };
    const client = new CodexBridgeMcpClient('http://bridge.example.test:18000/mcp', token, { fetchImpl });

    const targets = await client.readTargets();
    const threads = await client.readThreads('machine-1');
    const status = await client.readStatus('machine-1', 'machine-1::thread-1');

    assert.deepEqual(targets, [{ id: 'machine-1', name: 'Work PC', kind: 'local', available: true }]);
    assert.deepEqual(threads.threads.map(({ id }) => id), ['thread-1', 'external-1']);
    assert.equal(threads.nextCursor, 'cursor-2');
    assert.equal(status.currentExecution?.reason, 'execution_unconfirmed');
    assert.equal(status.lastTurn?.status, 'completed');

    const methodNames = requests.map(({ payload }) => payload.method);
    assert.deepEqual(methodNames, [
      'initialize', 'notifications/initialized', 'tools/list', 'tools/call',
      'tools/call', 'initialize', 'notifications/initialized', 'tools/list',
      'tools/call', 'tools/call',
    ]);
    assert.equal(sessionCount, 2);
    const toolLists = requests.filter(({ payload }) => payload.method === 'tools/list');
    assert.equal(toolLists.length, 2);
    assert.ok(toolLists.every(({ headers }) => headers.get('mcp-session-id')?.startsWith('session-')));
    const callNames = requests
      .filter(({ payload }) => payload.method === 'tools/call')
      .map(({ payload }) => (payload.params as { name: string }).name);
    assert.deepEqual(callNames, ['codex_targets', 'codex_threads', 'codex_threads', 'codex_status']);
    assert.ok(requests.every(({ headers }) => headers.get('authorization') === `Bearer ${token}`));
    assert.ok(requests.every(({ init }) => init.credentials === 'omit'));
    assert.ok(requests.filter(({ payload }) => payload.method !== 'initialize')
      .every(({ headers }) => headers.get('mcp-protocol-version') === '2025-03-26'));
    assert.equal(JSON.stringify({ targets, threads, status }).includes(token), false);
  });
}
