import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCodexBridgeFinalAnswer } from '../src/background/codexbridge-final-answer.ts';
import { CodexBridgeMcpClient } from '../src/background/mcp-client.ts';
import { McpTransportError, StreamableHttpMcpTransport } from '../src/background/mcp-transport.ts';

function thread(turns: unknown[]) {
  return { thread: { id: 'thread-1', turns } };
}

test('only the exact completed turn final_answer text is returned without changing Markdown', () => {
  const text = '## Title\n\n```ts\nconst answer = true;\n```';
  const result = parseCodexBridgeFinalAnswer(thread([
    { id: 'turn-old', status: 'completed', items: [{ type: 'agentMessage', phase: 'final_answer', text: 'wrong turn' }] },
    { id: 'turn-1', status: 'completed', items: [
      { type: 'agentMessage', phase: 'commentary', text: 'intermediate' },
      { type: 'reasoning', phase: 'final_answer', text: 'private' },
      { type: 'agentMessage', phase: 'final_answer', text },
    ] },
  ]), 'thread-1', 'turn-1');
  assert.deepEqual(result, { status: 'retrieved', text, completeness: 'unconfirmed' });
});

test('missing, malformed, ambiguous, unfinished, and oversized history stays explicit', () => {
  assert.deepEqual(parseCodexBridgeFinalAnswer(thread([
    { id: 'turn-1', status: 'completed', items: [{ type: 'agentMessage', phase: 'commentary', text: 'working' }] },
  ]), 'thread-1', 'turn-1'), { status: 'no-final-answer', completeness: 'unconfirmed' });
  assert.deepEqual(parseCodexBridgeFinalAnswer(thread([
    { id: 'turn-1', status: 'inProgress', items: [] },
  ]), 'thread-1', 'turn-1'), { status: 'pending' });
  assert.deepEqual(parseCodexBridgeFinalAnswer(thread([]), 'thread-1', 'turn-1'), {
    status: 'incomplete', reason: 'turn-not-found', completeness: 'unconfirmed',
  });
  assert.deepEqual(parseCodexBridgeFinalAnswer(thread([
    { id: 'turn-1', status: 'completed', items: [] }, { id: 'turn-1', status: 'completed', items: [] },
  ]), 'thread-1', 'turn-1'), { status: 'incomplete', reason: 'multiple-matching-turns', completeness: 'unconfirmed' });
  assert.deepEqual(parseCodexBridgeFinalAnswer({ thread: { id: 'other', turns: [] } }, 'thread-1', 'turn-1'), {
    status: 'incomplete', reason: 'malformed-history', completeness: 'unconfirmed',
  });
  assert.deepEqual(parseCodexBridgeFinalAnswer(thread([
    { id: 'turn-1', status: 'completed', items: [{ type: 'agentMessage', phase: 'final_answer', text: 'a'.repeat(256 * 1024 + 1) }] },
  ]), 'thread-1', 'turn-1'), { status: 'incomplete', reason: 'text-too-large', completeness: 'unconfirmed' });
  assert.deepEqual(parseCodexBridgeFinalAnswer(thread(Array.from({ length: 101 }, (_, index) => ({
    id: `turn-${index}`, status: 'completed', items: [],
  }))), 'thread-1', 'turn-1'), { status: 'incomplete', reason: 'history-too-large', completeness: 'unconfirmed' });
  assert.deepEqual(parseCodexBridgeFinalAnswer(thread([
    { id: 'turn-1', status: 'completed', items: Array.from({ length: 101 }, () => ({ type: 'userMessage' })) },
  ]), 'thread-1', 'turn-1'), { status: 'incomplete', reason: 'history-too-large', completeness: 'unconfirmed' });
  assert.deepEqual(parseCodexBridgeFinalAnswer(thread([
    { id: 'turn-1', status: 'completed', items: [
      { type: 'agentMessage', phase: 'final_answer', text: 'one' },
      { type: 'agentMessage', phase: 'final_answer', text: 'two' },
    ] },
  ]), 'thread-1', 'turn-1'), { status: 'incomplete', reason: 'multiple-final-answers', completeness: 'unconfirmed' });
});

test('codex_threads uses exact read-only arguments and recovers an expired MCP session', async () => {
  const requests: Array<{ payload: Record<string, unknown>; headers: Headers }> = [];
  let session = 0;
  let calls = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const headers = new Headers(init?.headers);
    requests.push({ payload, headers });
    const id = payload.id as number;
    const method = payload.method;
    if (method === 'initialize') {
      session += 1;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-03-26' } }), {
        status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': `session-${session}` },
      });
    }
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (method === 'tools/list') return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { tools: [{ name: 'codex_threads' }] } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    if (method === 'tools/call' && calls++ === 0) return new Response('expired', { status: 404 });
    if (method === 'tools/call') return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: {
      structuredContent: thread([{ id: 'turn-1', status: 'completed', items: [{
        type: 'agentMessage', phase: 'final_answer', text: 'final text',
      }] }]),
    } }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(null, { status: 400 });
  };
  const client = new CodexBridgeMcpClient('http://127.0.0.1:18000/mcp', 'private-token', { fetchImpl });
  const answer = await client.readFinalAnswer('target-1', 'thread-1', 'turn-1');
  assert.deepEqual(answer, {
    status: 'retrieved', text: 'final text', completeness: 'unconfirmed',
  });
  const callsOnly = requests.filter(({ payload }) => payload.method === 'tools/call');
  assert.deepEqual(callsOnly.map(({ payload }) => payload.params), [
    { name: 'codex_threads', arguments: { thread_id: 'thread-1', target_id: 'target-1', include_history: true } },
    { name: 'codex_threads', arguments: { thread_id: 'thread-1', target_id: 'target-1', include_history: true } },
  ]);
  assert.equal(JSON.stringify(answer).includes('private-token'), false);
  assert.ok(requests.every(({ headers }) => headers.get('authorization') === 'Bearer private-token'));
});

test('MCP JSON responses above the transport byte bound fail explicitly', async () => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { data: 'x'.repeat(8 * 1024 * 1024) } });
  const transport = new StreamableHttpMcpTransport('http://127.0.0.1:18000/mcp', '', {
    fetchImpl: async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  await assert.rejects(transport.request('read', {}), (error: unknown) =>
    error instanceof McpTransportError && error.code === 'response-too-large');
});
