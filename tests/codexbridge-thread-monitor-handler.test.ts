import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH,
  CODEX_BRIDGE_WATCH_LIST,
  CODEX_BRIDGE_WATCH_READ,
  CODEX_BRIDGE_WATCH_START,
  CODEX_BRIDGE_WATCH_STOP,
  type CodexBridgeWatchSnapshot,
} from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import { createCodexBridgeThreadMonitorMessageHandler } from '../src/background/codexbridge-thread-monitor.ts';

const item: CodexBridgeWatchSnapshot = {
  watchId: 'watch-1', connectionId: 'sha256:abc', targetId: 'target-1', threadId: 'thread-1', enabled: true,
  baselineCaptured: true, baselineTurnKind: 'turn', baselineTurnId: 'turn-1', baselineTurnStatus: 'completed',
  lastObservedTurnId: 'turn-1', statusState: 'not_loaded', lastTurnStatus: 'completed', lastTurnEvidence: 'live',
  currentExecutionState: null, currentExecutionEvidence: null, currentExecutionTurnId: null,
  needsAttention: false, turnChange: 'baseline', observedAt: '2026-11-20T00:00:00.000Z',
  lastSuccessAt: '2026-11-20T00:00:00.000Z', fetchOutcome: 'ok', nextPollAt: 0, failureCount: 0,
};

function handlerFixture() {
  const calls: string[] = [];
  const monitor = {
    async startWatch(targetId: string, threadId: string) {
      calls.push(`start:${targetId}:${threadId}`);
      return { ok: true as const, item, created: true };
    },
    async stopWatch(connectionId: string, targetId: string, threadId: string) {
      calls.push(`stop:${connectionId}:${targetId}:${threadId}`);
      return true;
    },
    async list() {
      calls.push('list');
      return [item];
    },
    async read(connectionId: string, targetId: string, threadId: string) {
      calls.push(`read:${connectionId}:${targetId}:${threadId}`);
      return item;
    },
    async refreshForeground() { calls.push('foreground'); },
  };
  const handle = createCodexBridgeThreadMonitorMessageHandler({
    extensionId: 'test-extension',
    monitor,
    async resolveAccess() { return { connectionId: 'sha256:abc', failure: 'permission-required' }; },
  });
  return { handle, calls };
}

const trustedSender = {
  id: 'test-extension',
  origin: 'https://chatgpt.com',
  url: 'https://chatgpt.com/c/test',
  frameId: 0,
  tab: { id: 4, url: 'https://chatgpt.com/c/test' },
};

test('only top-level ChatGPT senders can use the typed watch messages', async () => {
  const { handle, calls } = handlerFixture();
  assert.equal(await handle({ type: CODEX_BRIDGE_WATCH_LIST }, { ...trustedSender, frameId: 2 }), null);
  assert.equal(await handle({ type: CODEX_BRIDGE_WATCH_LIST }, { ...trustedSender, tab: { id: 4, url: 'https://example.com/' } }), null);
  assert.deepEqual(await handle({ type: 'ARBITRARY_FETCH', url: 'https://bridge.example' }, trustedSender), {
    ok: false, reason: 'invalid-request',
  });
  assert.deepEqual(await handle({ type: CODEX_BRIDGE_WATCH_LIST, endpoint: 'https://bridge.example' }, trustedSender), {
    ok: false, reason: 'invalid-request',
  });
  assert.deepEqual(await handle({
    type: CODEX_BRIDGE_WATCH_START, targetId: 'target-1', threadId: 'target-2::thread-1',
  }, trustedSender), { ok: false, reason: 'invalid-request' });
  assert.deepEqual(calls, []);
});

test('start, stop, read, list, and foreground refresh are explicit bounded operations', async () => {
  const { handle, calls } = handlerFixture();
  assert.deepEqual(await handle({ type: CODEX_BRIDGE_WATCH_START, targetId: 'target-1', threadId: 'thread-1' }, trustedSender), {
    ok: true, data: { item, created: true },
  });
  assert.deepEqual(await handle({
    type: CODEX_BRIDGE_WATCH_STOP, connectionId: item.connectionId, targetId: item.targetId, threadId: item.threadId,
  }, trustedSender), { ok: true, data: { removed: true } });
  assert.deepEqual(await handle({
    type: CODEX_BRIDGE_WATCH_READ, connectionId: item.connectionId, targetId: item.targetId, threadId: item.threadId,
  }, trustedSender), { ok: true, data: item });
  assert.deepEqual(await handle({ type: CODEX_BRIDGE_WATCH_LIST }, trustedSender), {
    ok: true, data: { items: [item], currentConnectionId: item.connectionId },
  });
  assert.deepEqual(await handle({ type: CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH }, trustedSender), {
    ok: true, data: { items: [item], currentConnectionId: item.connectionId },
  });
  assert.deepEqual(calls, [
    'start:target-1:thread-1',
    `stop:${item.connectionId}:${item.targetId}:${item.threadId}`,
    `read:${item.connectionId}:${item.targetId}:${item.threadId}`,
    'list', 'foreground', 'list',
  ]);
});
