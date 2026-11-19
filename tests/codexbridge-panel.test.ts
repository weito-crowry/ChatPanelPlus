import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import {
  CODEX_BRIDGE_MCP_GET_STATUS,
  CODEX_BRIDGE_MCP_GET_TARGETS,
  CODEX_BRIDGE_MCP_GET_THREADS,
  CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY,
  type CodexBridgeThreadPage,
} from '../src/shared/codexbridge-mcp-protocol.ts';
import { createCodexBridgePanelHandler } from '../src/background/codexbridge-panel.ts';

type RequestRecord = Readonly<{ payload: Record<string, unknown>; headers: Headers }>;
type MockOptions = Readonly<{
  permission?: boolean;
  token?: string;
  endpoint?: string;
  targets?: unknown;
  threads?: unknown;
  status?: unknown;
  toolError?: boolean;
  responseMode?: 'json' | 'sse';
  httpStatus?: number;
}>;

function jsonRpc(id: number, result: unknown, sessionId?: string): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (sessionId) headers.set('Mcp-Session-Id', sessionId);
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200, headers });
}

function sseRpc(id: number, result: unknown): Response {
  const event = JSON.stringify({ jsonrpc: '2.0', id, result });
  return new Response(`event: message\ndata: ${event}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function createMock(options: MockOptions = {}) {
  const requests: RequestRecord[] = [];
  const endpoint = options.endpoint ?? 'http://127.0.0.1:18000/mcp';
  const fetchImpl: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const headers = new Headers(init?.headers);
    requests.push({ payload, headers });
    if (options.httpStatus) return new Response(null, { status: options.httpStatus });
    const id = payload.id as number;
    if (payload.method === 'initialize') return jsonRpc(id, { protocolVersion: '2025-03-26' }, 'panel-session');
    if (payload.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (payload.method === 'tools/list') {
      return jsonRpc(id, { tools: [{ name: 'codex_targets' }, { name: 'codex_threads' }, { name: 'codex_status' }] });
    }
    if (payload.method === 'tools/call') {
      const params = payload.params as { name: string };
      if (options.toolError) return jsonRpc(id, { isError: true, content: [{ type: 'text', text: 'private provider detail' }] });
      const result = params.name === 'codex_targets'
        ? options.targets ?? { targets: [{ id: 'machine-1', name: 'Workstation', kind: 'local', available: true }] }
        : params.name === 'codex_threads'
          ? options.threads ?? { threads: [], external_threads: [], next_cursor: null }
          : options.status ?? { state: 'not_loaded', current_execution: { state: 'unknown' }, last_turn: { state: 'not_loaded' } };
      return options.responseMode === 'sse'
        ? sseRpc(id, { content: [{ type: 'text', text: JSON.stringify(result) }] })
        : jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
    }
    return new Response(null, { status: 400 });
  };
  const handler = createCodexBridgePanelHandler({
    sessionStorage: {
      async get() {
        return options.token === undefined ? {} : { [CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY]: options.token };
      },
    },
    permissions: { async contains() { return options.permission ?? true; } },
    settings: {
      async loadSettings() {
        return { ok: true as const, settings: { ...DEFAULT_SETTINGS, codexBridgeMcpUrl: endpoint } };
      },
    },
    extensionId: 'test-extension',
    fetchImpl,
  });
  return { handler, requests };
}

const trustedSender = {
  id: 'test-extension',
  origin: 'https://chatgpt.com',
  url: 'https://chatgpt.com/c/abc',
  frameId: 0,
  tab: { id: 13, url: 'https://chatgpt.com/c/abc' },
};

test('targets are projected to bounded fields and never return the session token', async () => {
  const { handler, requests } = createMock({
    token: 'panel-secret',
    targets: { targets: [
      { id: 'machine-1', name: 'Desk\u202e', kind: 'local', available: true, private: 'discard' },
      { id: 'machine-2', name: 'Remote', kind: 'remote' },
    ] },
  });
  const response = await handler({ type: CODEX_BRIDGE_MCP_GET_TARGETS }, trustedSender);

  assert.deepEqual(response, { ok: true, data: [
    { id: 'machine-1', name: 'Desk', kind: 'local', available: true },
    { id: 'machine-2', name: 'Remote', kind: 'remote', available: null },
  ] });
  assert.deepEqual(requests.filter(({ payload }) => payload.method === 'tools/call')
    .map(({ payload }) => (payload.params as { name: string }).name), ['codex_targets']);
  assert.equal(requests.some(({ headers }) => headers.get('authorization') === 'Bearer panel-secret'), true);
  assert.equal(JSON.stringify(response).includes('panel-secret'), false);
  assert.equal(JSON.stringify(response).includes('private'), false);
});

test('thread pages request bounded history-free data, deduplicate external rows by target and thread, and preserve observations', async () => {
  const rows = {
    threads: [{
      id: 'thread-1', target_id: 'machine-1', name: 'Native', cwd: 'C:\\work',
      current_execution: { state: 'estimated_running', evidence: 'inferred', observed_at: '2026-11-20T01:00:00Z' },
      last_turn: { state: 'not_loaded', evidence: 'unknown' },
    }],
    external_threads: [
      { id: 'thread-1', target_id: 'machine-1', name: 'Duplicate', current_execution: { state: 'unknown' } },
      { id: 'thread-2', target_id: 'machine-1', name: 'External', needs_attention: true },
    ],
    next_cursor: 'cursor-2',
  };
  const first = createMock({ threads: rows });
  const firstPage = await first.handler({ type: CODEX_BRIDGE_MCP_GET_THREADS, targetId: 'machine-1' }, trustedSender);
  assert.equal(firstPage?.ok, true);
  if (!firstPage?.ok) return;
  const firstData = firstPage.data as CodexBridgeThreadPage;
  assert.equal(firstData.threads.length, 2);
  assert.deepEqual(firstData.threads[0], {
    targetId: 'machine-1', id: 'thread-1', title: 'Native', cwd: 'C:\\work',
    currentExecution: { state: 'estimated_running', evidence: 'inferred', reason: null, observedAt: '2026-11-20T01:00:00Z', needsAttention: null },
    lastTurn: { state: 'not_loaded', evidence: 'unknown', reason: null, observedAt: null, needsAttention: null },
    needsAttention: null,
  });
  assert.equal(firstData.threads[1]?.needsAttention, true);
  assert.equal(firstData.nextCursor, 'cursor-2');
  const call = first.requests.find(({ payload }) => payload.method === 'tools/call')?.payload;
  assert.deepEqual((call?.params as { name: string; arguments: unknown }).arguments, {
    target_id: 'machine-1', include_history: false, limit: 20,
  });

  const second = createMock({ threads: { threads: [{ id: 'thread-3', name: 'Page 2' }], external_threads: [], next_cursor: null } });
  const secondPage = await second.handler({ type: CODEX_BRIDGE_MCP_GET_THREADS, targetId: 'machine-1', cursor: 'cursor-2' }, trustedSender);
  assert.equal(secondPage?.ok, true);
  const secondCall = second.requests.find(({ payload }) => payload.method === 'tools/call')?.payload;
  assert.deepEqual((secondCall?.params as { arguments: unknown }).arguments, {
    target_id: 'machine-1', include_history: false, limit: 20, cursor: 'cursor-2',
  });
});

test('empty pages are valid and selected status stays bound to its target/thread pair', async () => {
  const empty = createMock({ threads: { threads: [], external_threads: [], next_cursor: null } });
  const emptyPage = await empty.handler({ type: CODEX_BRIDGE_MCP_GET_THREADS, targetId: 'machine-1' }, trustedSender);
  assert.deepEqual(emptyPage, { ok: true, data: { threads: [], nextCursor: null } });

  const statusClient = createMock({ status: {
    state: 'not_loaded',
    current_execution: { state: 'unknown', evidence: 'inferred', reason: 'execution_unconfirmed' },
    last_turn: { state: 'not_loaded', needs_attention: false },
    needs_attention: false,
  } });
  const status = await statusClient.handler({
    type: CODEX_BRIDGE_MCP_GET_STATUS,
    targetId: 'machine-remote',
    threadId: 'machine-remote::remote-thread',
  }, trustedSender);
  assert.deepEqual(status, { ok: true, data: {
    targetId: 'machine-remote', threadId: 'machine-remote::remote-thread', state: 'not_loaded',
    currentExecution: { state: 'unknown', evidence: 'inferred', reason: 'execution_unconfirmed', observedAt: null, needsAttention: null },
    lastTurn: { state: 'not_loaded', evidence: null, reason: null, observedAt: null, needsAttention: false },
    needsAttention: false,
  } });
  const call = statusClient.requests.find(({ payload }) => payload.method === 'tools/call')?.payload;
  assert.deepEqual((call?.params as { name: string; arguments: unknown }).arguments, { thread_id: 'machine-remote::remote-thread' });
});

test('malformed tool data and tool errors are explicit; target listing also accepts MCP SSE text results', async () => {
  const malformed = createMock({ targets: { target: [] } });
  assert.deepEqual(await malformed.handler({ type: CODEX_BRIDGE_MCP_GET_TARGETS }, trustedSender), {
    ok: false, reason: 'protocol-error',
  });
  const toolError = createMock({ toolError: true });
  const failed = await toolError.handler({ type: CODEX_BRIDGE_MCP_GET_TARGETS }, trustedSender);
  assert.deepEqual(failed, { ok: false, reason: 'readonly-probe-failed' });
  assert.equal(JSON.stringify(failed).includes('private provider detail'), false);
  const sse = createMock({ responseMode: 'sse', targets: { targets: [] } });
  assert.deepEqual(await sse.handler({ type: CODEX_BRIDGE_MCP_GET_TARGETS }, trustedSender), { ok: true, data: [] });
});

test('permission and HTTP auth failures are explicit without exposing connection secrets', async () => {
  const noPermission = createMock({ permission: false, token: 'private-token' });
  assert.deepEqual(await noPermission.handler({ type: CODEX_BRIDGE_MCP_GET_TARGETS }, trustedSender), {
    ok: false, reason: 'permission-required',
  });
  assert.equal(noPermission.requests.length, 0);
  for (const [httpStatus, reason] of [[401, 'authentication-required'], [403, 'forbidden']] as const) {
    const mock = createMock({ httpStatus, token: 'private-token' });
    const response = await mock.handler({ type: CODEX_BRIDGE_MCP_GET_TARGETS }, trustedSender);
    assert.deepEqual(response, { ok: false, reason });
    assert.equal(JSON.stringify(response).includes('private-token'), false);
  }
});

test('only a top-frame ChatGPT content script may read, and requests cannot supply endpoint or tool names', async () => {
  const { handler, requests } = createMock();
  const request = { type: CODEX_BRIDGE_MCP_GET_TARGETS };
  for (const sender of [
    { ...trustedSender, id: 'other-extension' },
    { ...trustedSender, frameId: 2 },
    { ...trustedSender, tab: { id: 13, url: 'https://example.com/' } },
    { ...trustedSender, origin: 'https://example.com' },
    { ...trustedSender, tab: { url: trustedSender.tab.url } },
  ]) assert.equal(await handler(request, sender), null);
  assert.deepEqual(await handler({ ...request, endpoint: 'https://attacker.example/mcp', tool: 'github_delete' }, trustedSender), {
    ok: false, reason: 'protocol-error',
  });
  assert.equal(requests.length, 0);
});
