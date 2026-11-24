import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexBridgeAutoThreadRegistration } from '../src/background/thread-monitor-auto-registration.ts';
import { CodexBridgeThreadMonitor } from '../src/background/thread-monitor.ts';
import type { CodexBridgeThread, CodexBridgeThreadPage, CodexBridgeThreadStatus } from '../src/shared/codexbridge-mcp-protocol.ts';
import { publishCodexBridgeAutoWatchCompletion, matchCompletedAnswerAfterBridgeCandidates,
  subscribeCodexBridgeAutoWatchCompletion } from '../src/content/codexbridge-auto-watch-completion.ts';
import { harness as statisticsHarness, settle, turn, FakeMutationObserver } from './conversation-statistics-controller-fixture.ts';

class FakeStorage {
  readonly values: Record<string, unknown> = {};
  async get(keys: string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.filter((key) => key in this.values)
      .map((key) => [key, structuredClone(this.values[key])]));
  }
  async set(items: Record<string, unknown>): Promise<void> { Object.assign(this.values, structuredClone(items)); }
}

class FakeAlarms {
  readonly names = new Set<string>();
  async get(name: string): Promise<unknown> { return this.names.has(name) ? { name } : undefined; }
  create(name: string): void { this.names.add(name); }
  async clear(name: string): Promise<boolean> { return this.names.delete(name); }
}

const targetId = 'target-1';
const threadId = '01a207cf-52ab-7900-a91d-3288982ab221';
const turnId = '01a20fc8-e85f-7333-9501-cac4e67cd7dd';
const ownerTabId = 4;
const conversationId = 'conversation-A';

function liveThread(): CodexBridgeThread {
  return {
    targetId, id: threadId, title: threadId, preview: null, cwd: null, updatedAt: null,
    currentExecution: { turnId: null, state: 'in_progress', evidence: 'live', reason: null,
      observedAt: null, needsAttention: false },
    lastTurn: { turnId, status: 'in_progress', category: null, evidence: 'live', reason: null,
      observedAt: null, needsAttention: false },
    needsAttention: false,
  };
}

function background(threads: readonly CodexBridgeThread[] = [liveThread()]) {
  const storage = new FakeStorage();
  const alarms = new FakeAlarms();
  let runningOnlyCalls = 0;
  const resolveAccess = async () => ({
    connectionId: 'connection-A',
    readStatus: async (requestedTargetId: string, requestedThreadId: string): Promise<CodexBridgeThreadStatus> => ({
      targetId: requestedTargetId, threadId: requestedThreadId, state: 'in_progress', currentExecution: null,
      lastTurn: { turnId, status: 'in_progress', category: null, evidence: 'live', reason: null,
        observedAt: null, needsAttention: false }, needsAttention: false,
    }),
    readTargets: async () => [{ id: targetId, name: 'Workstation', kind: 'local' as const, available: true }],
    readRunningThreads: async (): Promise<CodexBridgeThreadPage> => {
      runningOnlyCalls += 1;
      return { threads, nextCursor: null };
    },
  });
  let watchSequence = 0;
  const monitor = new CodexBridgeThreadMonitor(storage, alarms, resolveAccess, {
    now: () => 1_800_000_000_000, createWatchId: () => `watch-${++watchSequence}`,
  });
  const auto = new CodexBridgeAutoThreadRegistration(storage, alarms, monitor, resolveAccess,
    async () => ({ ok: true as const, muted: false, revision: 0 }), async () => true);
  return { auto, monitor, get runningOnlyCalls() { return runningOnlyCalls; } };
}

test('完了済みhistorical lastTurnをcurrent live Turn IDとして候補に含めない', async () => {
  const ended = liveThread();
  const h = background([{ ...ended, currentExecution: null,
    lastTurn: { ...ended.lastTurn!, status: 'completed' } }]);
  assert.equal((await h.auto.setEnabled(targetId, ownerTabId, conversationId, true)).ok, true);
  const candidates = await h.auto.getRunningCandidates(targetId, ownerTabId, conversationId,
    'answer-turn', 'assistant-message');
  assert.deepEqual(candidates, { ok: true, data: { connectionId: 'connection-A', threads: [] } });
});

test('回答本文のlive Turn IDだけで同一canonical threadを登録し、linked live turnを使う', async () => {
  const h = background();
  assert.equal((await h.auto.setEnabled(targetId, ownerTabId, conversationId, true)).ok, true);
  const active = turn('completion-live-turn', '質問', '', 'assistant-live-turn', 'in_progress');
  const stats = statisticsHarness(`/c/${conversationId}`, false, undefined, {
    onAnswerCompleted: (event, ownerConversationId) => publishCodexBridgeAutoWatchCompletion(
      stats.window.location.pathname, event, ownerConversationId),
  });
  let registration: Promise<number> | null = null;
  const unsubscribe = subscribeCodexBridgeAutoWatchCompletion((notice) => {
    registration = (async () => {
      const candidates = await h.auto.getRunningCandidates(targetId, ownerTabId, notice.conversationId,
        notice.turnKey, notice.assistantMessageId);
      if (!candidates.ok) return 0;
      const match = await matchCompletedAnswerAfterBridgeCandidates(async () => ({ ok: true, data: candidates.data }),
        () => ({ document: stats.document as unknown as Document, pathname: stats.window.location.pathname,
          targetId, conversationId: notice.conversationId }), targetId, notice.conversationId, notice);
      if (match.status !== 'ready') return 0;
      assert.deepEqual(match.expectedTurns, [{ threadId, turnId }]);
      return h.auto.registerCompletedAnswer(targetId, match.connectionId, ownerTabId, notice.conversationId,
        notice.turnKey, notice.assistantMessageId, match.threadIds, match.expectedTurns);
    })();
  });
  stats.document.root.append(active);
  stats.controller.start();
  await settle();
  active.querySelectorAll('[data-talvt-turn-state]')[0]!.attributes['data-talvt-turn-state'] = 'complete';
  active.querySelectorAll('[data-dil-message-id]')[0]!.text = `実行中 Turn ID: ${turnId}`;
  FakeMutationObserver.latest?.notify(active, active);
  await settle();

  assert.equal(await registration, 1);
  assert.equal(h.runningOnlyCalls, 2);
  const watches = await h.monitor.list();
  assert.deepEqual(watches.map((watch) => watch.threadId), [threadId]);
  assert.equal(watches[0]?.baselineTurnId, turnId);
  stats.controller.stop();
  unsubscribe();
});
