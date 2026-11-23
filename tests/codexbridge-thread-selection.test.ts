import assert from 'node:assert/strict';
import test from 'node:test';
import type { CodexBridgeThread } from '../src/shared/codexbridge-mcp-protocol.ts';
import { reconcileCodexBridgeThreadSelection } from '../src/content/codexbridge-thread-selection.ts';

function thread(id: string, title: string, targetId = 'target-A'): CodexBridgeThread {
  return { id, title, targetId, preview: null, cwd: null, updatedAt: null, currentExecution: null, lastTurn: null, needsAttention: null };
}

test('running refresh keeps the selected thread identity and replaces it with its refreshed row', () => {
  const selected = thread('thread-A', 'old title');
  const refreshed = thread('thread-A', 'updated title');
  assert.deepEqual(reconcileCodexBridgeThreadSelection(selected, [refreshed], false), { thread: refreshed, missing: false });
});

test('empty running refresh retains the selected thread and marks it absent instead of clearing selection', () => {
  const selected = thread('thread-A', 'selected');
  assert.deepEqual(reconcileCodexBridgeThreadSelection(selected, [], false), { thread: selected, missing: true });
});

test('normal cursor page with no selected row does not change selection state', () => {
  assert.equal(reconcileCodexBridgeThreadSelection(thread('thread-A', 'selected'), [], true), null);
});
