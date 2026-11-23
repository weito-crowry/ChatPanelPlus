import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexBridgeMcpClient } from '../src/background/mcp-client.ts';

test('Bridge live response without execution turn_id links its simultaneous in_progress last_turn', async () => {
  const turnId = '01a2077d-c0fa-77b2-95fe-1265f5b4ee21';
  const rpc = (id: number, result: unknown, sessionId?: string) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200, headers: { 'content-type': 'application/json', ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}) },
  });
  const fetchImpl: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const id = payload.id as number;
    if (payload.method === 'initialize') return rpc(id, { protocolVersion: '2025-03-26' }, 'live-turn-session');
    if (payload.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (payload.method === 'tools/list') return rpc(id, { tools: [
      { name: 'codex_threads', inputSchema: { properties: { running_only: { type: 'boolean' } } } },
      { name: 'codex_status' },
    ] });
    if (payload.method === 'tools/call') {
      const name = (payload.params as { name?: string }).name;
      const currentExecution = { state: 'in_progress', evidence: 'live', reason: 'managed_turn' };
      const lastTurn = { turn_id: turnId, status: 'in_progress', evidence: 'live' };
      const structuredContent = name === 'codex_threads' ? { threads: [{
        id: '01a2077d-bb7d-7ac3-a190-b36c4c29b8ea', target_id: 'target-1', current_execution: currentExecution,
        last_turn: lastTurn,
      }], next_cursor: null } : { state: 'in_progress', current_execution: currentExecution, last_turn: lastTurn };
      return rpc(id, { structuredContent });
    }
    return new Response(null, { status: 400 });
  };
  const client = new CodexBridgeMcpClient('http://127.0.0.1:18000/mcp', '', { fetchImpl });

  const page = await client.readThreads('target-1', undefined, true);
  const status = await client.readStatus('target-1', '01a2077d-bb7d-7ac3-a190-b36c4c29b8ea');
  assert.equal(page.threads[0]?.currentExecution?.turnId, turnId);
  assert.equal(page.threads[0]?.lastTurn?.turnId, turnId);
  assert.equal(status.currentExecution?.turnId, turnId);
  assert.equal(status.lastTurn?.turnId, turnId);
});
