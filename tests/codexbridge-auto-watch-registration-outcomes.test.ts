import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY,
} from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeTarget, CodexBridgeThread, CodexBridgeThreadPage } from '../src/shared/codexbridge-mcp-protocol.ts';
import { CodexBridgeAutoThreadRegistration } from '../src/background/thread-monitor-auto-registration.ts';
import { CodexBridgeThreadMonitor } from '../src/background/thread-monitor.ts';
import { formatRegistrationOutcomes, parseRegistrationOutcomes,
  registrationOutcomesHaveFailure } from '../src/content/codexbridge-auto-watch-registration-diagnostics.ts';

class FakeStorage {
  readonly values: Record<string, unknown> = {};
  async get(keys: string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.filter((key) => key in this.values)
      .map((key) => [key, structuredClone(this.values[key])]));
  }
  async set(items: Record<string, unknown>): Promise<void> { Object.assign(this.values, structuredClone(items)); }
}

class FakeAlarms {
  async get(): Promise<undefined> { return undefined; }
  async create(): Promise<void> {}
  async clear(): Promise<boolean> { return false; }
}

const target: CodexBridgeTarget = { id: 'target-1', name: 'Workstation', kind: 'local', available: true };
const threadId = '01a207cf-52ab-7900-a91d-3288982ab221';
const turnOneId = '01a207d1-12ab-7c00-a911-3288982ab223';
const turnTwoId = '01a207d2-12ab-7c00-a911-3288982ab224';
const ownerTabId = 4;
const conversationId = 'conversation-A';

function liveThread(turnId: string): CodexBridgeThread {
  return { targetId: target.id, id: threadId, title: threadId, preview: null, cwd: null, updatedAt: null,
    currentExecution: { turnId, state: 'in_progress', evidence: 'live', reason: null, observedAt: null, needsAttention: false },
    lastTurn: { turnId, status: 'in_progress', category: null, evidence: 'live', reason: null, observedAt: null, needsAttention: false },
    needsAttention: false };
}

function harness(initialTurnId: string, useOwnerLease = false) {
  const storage = new FakeStorage();
  const alarms = new FakeAlarms();
  let threads = [liveThread(initialTurnId)];
  let generation = 1;
  let claim: 'current' | 'other-tab' | 'recovering' | 'storage-error' = 'current';
  let setGenerationAfterRead: number | null = null;
  const resolveAccess = async () => ({
    connectionId: 'connection-A',
    generation,
    readStatus: async (targetId: string, id: string) => ({ targetId, threadId: id, state: 'in_progress',
      currentExecution: null, lastTurn: null, needsAttention: false }),
    readTargets: async () => [target],
    readRunningThreads: async (): Promise<CodexBridgeThreadPage> => {
      const page = { threads, nextCursor: null };
      if (setGenerationAfterRead !== null) { generation = setGenerationAfterRead; setGenerationAfterRead = null; }
      return page;
    },
  });
  let watchId = 0;
  const monitor = new CodexBridgeThreadMonitor(storage, alarms, resolveAccess, {
    now: () => 1_800_000_000_000, createWatchId: () => `watch-${++watchId}`,
  });
  const ownerLeases = { async claim() { return claim; }, async release() { return 'released' as const; } };
  const auto = new CodexBridgeAutoThreadRegistration(storage, alarms, monitor, resolveAccess,
    async () => ({ ok: true as const, muted: false, revision: 0 }), async () => true, async () => false,
    useOwnerLease ? ownerLeases : undefined);
  return {
    storage, monitor, auto,
    setTurn(turnId: string) { threads = [liveThread(turnId)]; },
    setThreads(value: readonly CodexBridgeThread[]) { threads = [...value]; },
    setClaim(value: typeof claim) { claim = value; },
    advanceGenerationAfterRead(value: number) { setGenerationAfterRead = value; },
  };
}

test('legacy null-turn manual skip binds to the observed live turn and expires for the next turn', async () => {
  const h = harness(turnOneId);
  await h.auto.setEnabled(target.id, ownerTabId, conversationId, true);
  const state = h.storage.values[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY] as {
    entries: Array<{ skippedExecutions: Array<{ threadId: string; turnId: string | null }> }>;
  };
  state.entries[0]!.skippedExecutions = [{ threadId, turnId: null }];
  await h.storage.set({ [CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY]: state });

  assert.deepEqual(await h.auto.registerCompletedAnswerWithDiagnostics(target.id, 'connection-A', ownerTabId, conversationId,
    'answer-one', 'assistant-one', [threadId]), {
    registeredCount: 0, outcomes: [{ reason: 'explicit-skip', count: 1 }],
  });
  const persisted = h.storage.values[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY] as typeof state;
  assert.deepEqual(persisted.entries[0]!.skippedExecutions, [{ threadId, turnId: turnOneId }]);

  h.setTurn(turnTwoId);
  assert.equal(await h.auto.registerCompletedAnswer(target.id, 'connection-A', ownerTabId, conversationId,
    'answer-two', 'assistant-two', [threadId]), 1);
  assert.equal((await h.monitor.list())[0]?.baselineTurnId, turnTwoId);
});

test('登録結果は候補のlive消失と既存watch ownerを件数だけで返す', async () => {
  const stale = harness(turnOneId);
  await stale.auto.setEnabled(target.id, ownerTabId, conversationId, true);
  stale.setThreads([]);
  assert.deepEqual(await stale.auto.registerCompletedAnswerWithDiagnostics(target.id, 'connection-A', ownerTabId,
    conversationId, 'stale-turn', 'stale-answer', [threadId]), {
    registeredCount: 0, outcomes: [{ reason: 'candidate-no-longer-live', count: 1 }],
  });

  for (const [owner, reason] of [
    [{ ownerTabId, ownerConversationId: conversationId, ownerMuted: false, ownerMuteRevision: 0 }, 'already-watching-same-owner'],
    [{ ownerTabId: 9, ownerConversationId: 'conversation-B', ownerMuted: false, ownerMuteRevision: 0 }, 'already-watching-different-owner'],
    [undefined, 'already-watching-ownerless'],
  ] as const) {
    const h = harness(turnOneId);
    await h.auto.setEnabled(target.id, ownerTabId, conversationId, true);
    await h.monitor.startWatch(target.id, threadId, owner);
    const response = await h.auto.registerCompletedAnswerWithDiagnostics(target.id, 'connection-A', ownerTabId,
      conversationId, `watch-${reason}`, 'assistant-watch', [threadId]);
    assert.equal(response.registeredCount, 0);
    assert.deepEqual(response.outcomes, [{ reason, count: 1 }]);
  }
});

test('Turn ID由来の候補は同じthreadでも登録前にturnが変われば拒否し、thread指定は現行意味を保つ', async () => {
  const expectedTurnId = turnOneId;
  const changed = harness(turnTwoId);
  await changed.auto.setEnabled(target.id, ownerTabId, conversationId, true);
  assert.deepEqual(await changed.auto.registerCompletedAnswerWithDiagnostics(target.id, 'connection-A', ownerTabId,
    conversationId, 'answer-changed-turn', 'assistant-changed-turn', [threadId], [{ threadId, turnId: expectedTurnId }]), {
    registeredCount: 0, outcomes: [{ reason: 'candidate-no-longer-live', count: 1 }],
  });
  assert.deepEqual(await changed.monitor.list(), []);

  const explicitThread = harness(turnTwoId);
  await explicitThread.auto.setEnabled(target.id, ownerTabId, conversationId, true);
  assert.equal(await explicitThread.auto.registerCompletedAnswer(target.id, 'connection-A', ownerTabId,
    conversationId, 'answer-explicit-thread', 'assistant-explicit-thread', [threadId]), 1);
});

test('owner claimと接続generationの早期終了を区別する', async () => {
  const claimed = harness(turnOneId, true);
  await claimed.auto.setEnabled(target.id, ownerTabId, conversationId, true);
  claimed.setClaim('other-tab');
  assert.deepEqual(await claimed.auto.registerCompletedAnswerWithDiagnostics(target.id, 'connection-A', ownerTabId,
    conversationId, 'owner-turn', 'owner-answer', [threadId]), {
    registeredCount: 0, outcomes: [{ reason: 'owner-claim-other-tab', count: 1 }],
  });
  assert.equal((await claimed.auto.getStatus(target.id, conversationId, ownerTabId)).state, 'conflict');
  claimed.setClaim('recovering');
  assert.deepEqual(await claimed.auto.registerCompletedAnswerWithDiagnostics(target.id, 'connection-A', ownerTabId,
    conversationId, 'recovering-turn', 'recovering-answer', [threadId]), {
    registeredCount: 0, outcomes: [{ reason: 'owner-claim-recovering', count: 1 }],
  });
  assert.equal((await claimed.auto.getStatus(target.id, conversationId, ownerTabId)).state, 'recovering');

  const generation = harness(turnOneId);
  await generation.auto.setEnabled(target.id, ownerTabId, conversationId, true);
  generation.advanceGenerationAfterRead(2);
  assert.deepEqual(await generation.auto.registerCompletedAnswerWithDiagnostics(target.id, 'connection-A', ownerTabId,
    conversationId, 'generation-turn', 'generation-answer', [threadId]), {
    registeredCount: 0, outcomes: [{ reason: 'generation-changed', count: 1 }],
  });
});

test('watch limitとstartWatch例外は異なる登録理由になる', async () => {
  for (const [mode, reason] of [
    ['limit', 'start-watch-watch-limit'], ['throw', 'start-watch-failed'],
  ] as const) {
    const h = harness(turnOneId);
    await h.auto.setEnabled(target.id, ownerTabId, conversationId, true);
    h.monitor.startWatch = (async () => mode === 'limit'
      ? { ok: false as const, reason: 'watch-limit' as const }
      : Promise.reject(new Error('private exception text'))) as typeof h.monitor.startWatch;
    const response = await h.auto.registerCompletedAnswerWithDiagnostics(target.id, 'connection-A', ownerTabId,
      conversationId, `start-${mode}`, 'assistant-start', [threadId]);
    assert.equal(response.registeredCount, 0);
    assert.deepEqual(response.outcomes, [{ reason, count: 1 }]);
    assert.equal(JSON.stringify(response).includes('private exception text'), false);
    assert.deepEqual(await h.auto.registerCompletedAnswerWithDiagnostics(target.id, 'connection-A', ownerTabId,
      conversationId, `start-${mode}`, 'assistant-start', [threadId]), {
      registeredCount: 0, outcomes: [{ reason: 'completion-already-processed', count: 1 }],
    });
  }
});

test('診断parserは許可済み理由と件数だけを受け入れ、ID等は拒否する', () => {
  const value = [{ reason: 'already-watching-different-owner', count: 2 }];
  assert.deepEqual(parseRegistrationOutcomes(value), value);
  assert.equal(formatRegistrationOutcomes(parseRegistrationOutcomes(value)!), 'already-watching-different-owner×2');
  assert.equal(registrationOutcomesHaveFailure(parseRegistrationOutcomes(value)!), true);
  assert.equal(registrationOutcomesHaveFailure([{ reason: 'explicit-skip', count: 1 }]), false);
  assert.equal(parseRegistrationOutcomes([{ reason: threadId, count: 1 }]), null);
  assert.equal(parseRegistrationOutcomes([{ reason: 'explicit-skip', count: 0 }]), null);
});
