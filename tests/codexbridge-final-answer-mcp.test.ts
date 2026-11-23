import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexBridgeMcpClient } from '../src/background/mcp-client.ts';
import { parseCodexBridgeFinalAnswerResponse } from '../src/background/codexbridge-final-answer.ts';

const targetId = 'remote-target::leaf-7';
const threadId = 'remote-thread::thread-7';
const turnId = 'turn-7';
const source = 'app_server.item/completed.agentMessage.phase=final_answer';

type Request = Readonly<{ payload: Record<string, unknown>; headers: Headers }>;
type ToolCall = (name: string, args: Record<string, unknown>, session: number, call: number) => unknown | Promise<unknown>;

function retrieved(text = 'exact final text', overrides: Record<string, unknown> = {}) {
  return {
    target_id: targetId, thread_id: threadId, turn_id: turnId, status: 'retrieved',
    source, item_id: 'item-final-7', text, ...overrides,
  };
}

function legacyHistory(text: string | null) {
  return { thread: { id: threadId, turns: [{ id: turnId, status: 'completed', items: text === null ? [] : [
    { type: 'agentMessage', phase: 'final_answer', text },
  ] }] } };
}

function createClient(options: {
  tools?: readonly string[];
  toolsForSession?: (session: number) => readonly string[];
  onCall: ToolCall;
}) {
  const requests: Request[] = [];
  let session = 0;
  let toolCall = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ payload, headers: new Headers(init?.headers) });
    const id = payload.id as number;
    if (payload.method === 'initialize') {
      session += 1;
      return rpcResponse(id, { protocolVersion: '2025-03-26' }, `session-${session}`);
    }
    if (payload.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (payload.method === 'tools/list') {
      const names = options.toolsForSession?.(session) ?? options.tools ?? ['codex_threads', 'codex_final_answer'];
      return rpcResponse(id, { tools: names.map((name) => ({ name })) });
    }
    if (payload.method === 'tools/call') {
      const params = payload.params as { name: string; arguments: Record<string, unknown> };
      const result = await options.onCall(params.name, params.arguments, session, ++toolCall);
      return result instanceof Response ? result : rpcResponse(id, { structuredContent: result });
    }
    return new Response(null, { status: 400 });
  };
  return {
    client: new CodexBridgeMcpClient('http://127.0.0.1:18000/mcp', 'test-token', { fetchImpl }),
    requests,
  };
}

function rpcResponse(id: number, result: unknown, sessionId?: string): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (sessionId) headers.set('mcp-session-id', sessionId);
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200, headers });
}

function callNames(requests: readonly Request[]): string[] {
  return requests.filter(({ payload }) => payload.method === 'tools/call')
    .map(({ payload }) => (payload.params as { name: string }).name);
}

test('advertised codex_final_answer returns confirmed exact text without requesting history', async () => {
  const { client, requests } = createClient({
    onCall(name, args) {
      assert.equal(name, 'codex_final_answer');
      assert.deepEqual(args, { target_id: targetId, thread_id: threadId, turn_id: turnId });
      return retrieved('line 1\n😀 line 2');
    },
  });

  assert.deepEqual(await client.readFinalAnswer(targetId, threadId, turnId), {
    status: 'retrieved', text: 'line 1\n😀 line 2', completeness: 'confirmed',
  });
  assert.deepEqual(callNames(requests), ['codex_final_answer']);
});

test('retrieved MCP response accepts Bridge native_thread_id for the exact remote thread', async () => {
  const publicTargetId = 'notebook';
  const publicThreadId = 'notebook::native-thread-7';
  const { client, requests } = createClient({
    onCall(name, args) {
      assert.equal(name, 'codex_final_answer');
      assert.deepEqual(args, { target_id: publicTargetId, thread_id: publicThreadId, turn_id: turnId });
      return {
        target_id: publicTargetId,
        thread_id: publicThreadId,
        turn_id: turnId,
        status: 'retrieved',
        item_id: 'item-final-7',
        source,
        text: 'exact final text from Bridge',
        native_thread_id: 'native-thread-7',
      };
    },
  });

  assert.deepEqual(await client.readFinalAnswer(publicTargetId, publicThreadId, turnId), {
    status: 'retrieved', text: 'exact final text from Bridge', completeness: 'confirmed',
  });
  assert.deepEqual(callNames(requests), ['codex_final_answer']);
});

test('dedicated response rejects identity, provenance, item, and shape mismatches without returning answer text', () => {
  const corrupt = [
    retrieved('secret answer', { target_id: 'other-target' }),
    retrieved('secret answer', { thread_id: 'other-thread' }),
    retrieved('secret answer', { turn_id: 'other-turn' }),
    retrieved('secret answer', { source: 'codex_status.latest_agent_message' }),
    retrieved('secret answer', { item_id: '' }),
    retrieved('secret answer', { item_id: '../outside' }),
    retrieved('secret answer', { native_thread_id: 'different-native-thread' }),
    retrieved('secret answer', { native_thread_id: threadId, unexpected: true }),
    retrieved('\ud800'),
    retrieved('secret answer', { unexpected: true }),
  ];
  for (const payload of corrupt) {
    const result = parseCodexBridgeFinalAnswerResponse(payload, targetId, threadId, turnId);
    assert.deepEqual(result, { status: 'failed', reason: 'protocol-error' });
    assert.equal(JSON.stringify(result).includes('secret answer'), false);
  }
});

test('dedicated answer accepts the UTF-16 boundary and rejects oversize or blank text without truncation', () => {
  const exactlyAtLimit = '😀'.repeat(128 * 1024);
  const accepted = parseCodexBridgeFinalAnswerResponse(retrieved(exactlyAtLimit), targetId, threadId, turnId);
  assert.deepEqual(accepted, { status: 'retrieved', text: exactlyAtLimit, completeness: 'confirmed' });

  const tooLarge = parseCodexBridgeFinalAnswerResponse(
    retrieved(`${exactlyAtLimit}x`, { native_thread_id: threadId }), targetId, threadId, turnId,
  );
  assert.deepEqual(tooLarge, { status: 'incomplete', reason: 'text-too-large', completeness: 'unconfirmed' });
  assert.equal('text' in tooLarge, false);
  assert.deepEqual(parseCodexBridgeFinalAnswerResponse(retrieved(' \n\t '), targetId, threadId, turnId), {
    status: 'failed', reason: 'protocol-error',
  });
});

test('pending, incomplete, and unavailable responses require safe reason and contain no text', () => {
  for (const [status, reason] of [
    ['pending', 'turn_terminal_not_observed'],
    ['incomplete', 'terminal_status_conflict'],
    ['unavailable', 'no_confirmed_final_answer'],
  ] as const) {
    const payload = { target_id: targetId, thread_id: threadId, turn_id: turnId, status, reason };
    const result = parseCodexBridgeFinalAnswerResponse(payload, targetId, threadId, turnId);
    assert.equal(result.status, status);
    assert.equal('text' in result, false);
    assert.equal('reason' in result && result.reason === reason, true);
  }
  for (const reason of ['unsafe reason', 'UPPER_CASE', 'bad-hyphen', 'x'.repeat(129)]) {
    assert.deepEqual(parseCodexBridgeFinalAnswerResponse({
      target_id: targetId, thread_id: threadId, turn_id: turnId, status: 'unavailable', reason,
    }, targetId, threadId, turnId), { status: 'failed', reason: 'protocol-error' });
  }
  assert.deepEqual(parseCodexBridgeFinalAnswerResponse({
    target_id: targetId, thread_id: threadId, turn_id: turnId,
    status: 'pending', reason: 'turn_terminal_not_observed', text: 'must not escape',
  }, targetId, threadId, turnId), { status: 'failed', reason: 'protocol-error' });
});

test('matching native_thread_id is the only optional identity field on non-retrieved responses', () => {
  for (const [status, reason] of [
    ['pending', 'turn_terminal_not_observed'],
    ['incomplete', 'terminal_status_conflict'],
    ['unavailable', 'storage_unavailable'],
  ] as const) {
    const result = parseCodexBridgeFinalAnswerResponse({
      target_id: targetId, thread_id: threadId, turn_id: turnId, status, reason, native_thread_id: threadId,
    }, targetId, threadId, turnId);
    assert.equal(result.status, status);
    assert.equal('reason' in result && result.reason === reason, true);
    assert.equal('text' in result, false);
  }
});

test('mismatched remote native_thread_id is rejected against the public thread identity', () => {
  const payload = {
    target_id: 'notebook',
    thread_id: 'notebook::native-thread-7',
    turn_id: turnId,
    status: 'retrieved',
    source,
    item_id: 'item-final-7',
    text: 'must not escape',
    native_thread_id: 'different-native-thread',
  };
  assert.deepEqual(parseCodexBridgeFinalAnswerResponse(payload, 'notebook', 'notebook::native-thread-7', turnId), {
    status: 'failed', reason: 'protocol-error',
  });
});

test('legacy history is used when the new tool is not advertised and remains unconfirmed', async () => {
  const { client, requests } = createClient({
    tools: ['codex_threads'],
    onCall(name, args) {
      assert.equal(name, 'codex_threads');
      assert.deepEqual(args, { thread_id: threadId, target_id: targetId, include_history: true });
      return legacyHistory('legacy exact final');
    },
  });

  assert.deepEqual(await client.readFinalAnswer(targetId, threadId, turnId), {
    status: 'retrieved', text: 'legacy exact final', completeness: 'unconfirmed',
  });
  assert.deepEqual(callNames(requests), ['codex_threads']);
});

test('only no_confirmed_final_answer permits strict legacy-history fallback', async () => {
  const { client, requests } = createClient({
    onCall(name) {
      return name === 'codex_final_answer'
        ? { target_id: targetId, thread_id: threadId, turn_id: turnId, status: 'unavailable', reason: 'no_confirmed_final_answer' }
        : legacyHistory('historical final');
    },
  });

  assert.deepEqual(await client.readFinalAnswer(targetId, threadId, turnId), {
    status: 'retrieved', text: 'historical final', completeness: 'unconfirmed',
  });
  assert.deepEqual(callNames(requests), ['codex_final_answer', 'codex_threads']);
});

test('no_confirmed_final_answer with no strict history candidate remains not found', async () => {
  const { client } = createClient({
    onCall(name) {
      return name === 'codex_final_answer'
        ? { target_id: targetId, thread_id: threadId, turn_id: turnId, status: 'unavailable', reason: 'no_confirmed_final_answer' }
        : { thread: { id: threadId, turns: [{ id: turnId, status: 'completed', items: [
          { type: 'agentMessage', phase: 'commentary', text: 'not final' },
        ] }] } };
    },
  });

  assert.deepEqual(await client.readFinalAnswer(targetId, threadId, turnId), {
    status: 'no-final-answer', completeness: 'unconfirmed',
  });
});

test('storage unavailable, pending, incomplete, and corrupt dedicated responses do not fall back', async () => {
  const responses = [
    { status: 'unavailable', reason: 'storage_unavailable' },
    { status: 'pending', reason: 'turn_terminal_not_observed' },
    { status: 'incomplete', reason: 'terminal_status_conflict' },
    { status: 'unavailable', reason: 'no_confirmed_final_answer', target_id: 'injected-target' },
  ];
  for (const partial of responses) {
    const { client, requests } = createClient({
      onCall() { return { target_id: targetId, thread_id: threadId, turn_id: turnId, ...partial }; },
    });
    const result = await client.readFinalAnswer(targetId, threadId, turnId);
    assert.equal(result.status, partial.status === 'unavailable' && partial.target_id ? 'failed' : partial.status);
    assert.deepEqual(callNames(requests), ['codex_final_answer']);
  }
});

test('corrupt retrieved identity or unknown fields do not fall back to history', async () => {
  for (const partial of [
    { status: 'retrieved', native_thread_id: 'different-native-thread' },
    { status: 'retrieved', native_thread_id: threadId, unexpected: true },
  ]) {
    const { client, requests } = createClient({
      onCall() { return retrieved('must not escape', partial); },
    });
    assert.deepEqual(await client.readFinalAnswer(targetId, threadId, turnId), {
      status: 'failed', reason: 'protocol-error',
    });
    assert.deepEqual(callNames(requests), ['codex_final_answer']);
  }
});

test('no final item in strict legacy history remains not found without status or commentary substitution', async () => {
  const { client } = createClient({
    tools: ['codex_threads'],
    onCall() {
      return { thread: { id: threadId, turns: [{ id: turnId, status: 'completed', items: [
        { type: 'agentMessage', phase: 'commentary', text: 'not the final answer' },
      ] }] }, latest_agent_message: 'also not a final answer' };
    },
  });

  assert.deepEqual(await client.readFinalAnswer(targetId, threadId, turnId), {
    status: 'no-final-answer', completeness: 'unconfirmed',
  });
});

test('expired dedicated-tool session renews, relists capabilities, and retries read-only', async () => {
  const { client, requests } = createClient({
    onCall(_name, _args, _session, call) {
      if (call === 1) return new Response('expired', { status: 404 });
      return retrieved('after renewal');
    },
  });

  assert.deepEqual(await client.readFinalAnswer(targetId, threadId, turnId), {
    status: 'retrieved', text: 'after renewal', completeness: 'confirmed',
  });
  assert.equal(requests.filter(({ payload }) => payload.method === 'initialize').length, 2);
  assert.equal(requests.filter(({ payload }) => payload.method === 'tools/list').length, 2);
  assert.deepEqual(callNames(requests), ['codex_final_answer', 'codex_final_answer']);
});

test('capability removal during session renewal falls back only after the new tools/list omits the tool', async () => {
  const { client, requests } = createClient({
    toolsForSession: (session) => session === 1
      ? ['codex_threads', 'codex_final_answer']
      : ['codex_threads'],
    onCall(name, _args, _session, call) {
      if (name === 'codex_final_answer' && call === 1) return new Response('expired', { status: 404 });
      assert.equal(name, 'codex_threads');
      return legacyHistory('legacy after capability changed');
    },
  });

  assert.deepEqual(await client.readFinalAnswer(targetId, threadId, turnId), {
    status: 'retrieved', text: 'legacy after capability changed', completeness: 'unconfirmed',
  });
  assert.equal(requests.filter(({ payload }) => payload.method === 'tools/list').length, 2);
  assert.deepEqual(callNames(requests), ['codex_final_answer', 'codex_threads']);
});

test('concurrent final-answer reads share the MCP handshake and cached tool list', async () => {
  const { client, requests } = createClient({ onCall() { return retrieved(); } });

  const answers = await Promise.all([
    client.readFinalAnswer(targetId, threadId, turnId),
    client.readFinalAnswer(targetId, threadId, turnId),
  ]);

  assert.ok(answers.every((answer) => answer.status === 'retrieved' && answer.completeness === 'confirmed'));
  assert.equal(requests.filter(({ payload }) => payload.method === 'initialize').length, 1);
  assert.equal(requests.filter(({ payload }) => payload.method === 'tools/list').length, 1);
  assert.deepEqual(callNames(requests), ['codex_final_answer', 'codex_final_answer']);
});
