import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_BRIDGE_AUTO_WATCH_ALARM,
  CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY,
  deriveCodexBridgeWatchTurnState,
} from '../src/shared/codexbridge-thread-monitor-protocol.ts';
import type { CodexBridgeTarget, CodexBridgeThread, CodexBridgeThreadPage, CodexBridgeThreadStatus } from '../src/shared/codexbridge-mcp-protocol.ts';
import { CodexBridgeAutoThreadRegistration } from '../src/background/thread-monitor-auto-registration.ts';
import { CodexBridgeThreadMonitor } from '../src/background/thread-monitor.ts';
import {
  matchCompletedAnswerAfterBridgeCandidates,
  publishCodexBridgeAutoWatchCompletion,
  subscribeCodexBridgeAutoWatchCompletion,
} from '../src/content/codexbridge-auto-watch-completion.ts';
import { dispatchAnswerCompletionNotifications } from '../src/content/answer-completion-notifications.ts';
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

const ownerA = { ownerTabId: 4, ownerConversationId: 'conversation-A', ownerMuted: false, ownerMuteRevision: 0 } as const;
const target: CodexBridgeTarget = { id: 'target-1', name: 'Workstation', kind: 'local', available: true };
const threadOneId = '01a207cf-52ab-7900-a91d-3288982ab221';
const threadTwoId = '01a207d0-12ab-7c00-a911-3288982ab222';
const turnOneId = '01a207d1-12ab-7c00-a911-3288982ab223';
const turnTwoId = '01a207d2-12ab-7c00-a911-3288982ab224';

function liveThread(id: string, turnId: string, targetId = target.id): CodexBridgeThread {
  return {
    targetId, id, title: id, preview: null, cwd: null, updatedAt: null,
    currentExecution: { turnId, state: 'in_progress', evidence: 'live', reason: null, observedAt: null, needsAttention: false },
    lastTurn: { turnId, status: 'in_progress', category: null, evidence: 'live', reason: null, observedAt: null, needsAttention: false },
    needsAttention: false,
  };
}

function harness(initialThreads: readonly CodexBridgeThread[] = []) {
  const storage = new FakeStorage();
  const alarms = new FakeAlarms();
  let now = Date.parse('2026-11-23T00:00:00.000Z');
  let threads = [...initialThreads];
  let connectionId = 'connection-A';
  let runningOnlyCalls = 0;
  let targetCalls = 0;
  let statusOverride: CodexBridgeThreadStatus | null = null;
  let targets: readonly CodexBridgeTarget[] = [target];
  let fetchFailure: Error | null = null;
  let runningOnlyAvailable = true;
  let ownerTabMatches = true;
  let fetchBarrier: Promise<void> | null = null;
  const resolveAccess = async () => ({
    connectionId,
    readStatus: async (targetId: string, threadId: string) => statusOverride ?? ({
      targetId, threadId, state: 'in_progress', currentExecution: null,
      lastTurn: { turnId: turnOneId, status: 'in_progress' as const, category: null,
        evidence: 'live', reason: null, observedAt: null, needsAttention: false }, needsAttention: false,
    }),
    readTargets: async () => { targetCalls += 1; return targets; },
    ...(runningOnlyAvailable ? { readRunningThreads: async (targetId: string): Promise<CodexBridgeThreadPage> => {
      runningOnlyCalls += 1;
      if (fetchBarrier) await fetchBarrier;
      if (fetchFailure) throw fetchFailure;
      assert.equal(targetId, target.id);
      return { threads, nextCursor: null };
    } } : {}),
  });
  let watchId = 0;
  const monitor = new CodexBridgeThreadMonitor(storage, alarms, resolveAccess, {
    now: () => now, createWatchId: () => `watch-${++watchId}`,
  });
  const auto = new CodexBridgeAutoThreadRegistration(
    storage, alarms, monitor, resolveAccess,
    async () => ({ ok: true as const, muted: false, revision: 0 }),
    async (tabId, conversationId) => ownerTabMatches && tabId === ownerA.ownerTabId && conversationId === ownerA.ownerConversationId,
  );
  return {
    storage, alarms, monitor, auto,
    get runningOnlyCalls() { return runningOnlyCalls; },
    get targetCalls() { return targetCalls; },
    get currentThreads() { return [...threads]; },
    set connectionId(value: string) { connectionId = value; },
    set statusOverride(value: typeof statusOverride) { statusOverride = value; },
    set threads(value: readonly CodexBridgeThread[]) { threads = [...value]; },
    set targets(value: readonly CodexBridgeTarget[]) { targets = [...value]; },
    set fetchFailure(value: Error | null) { fetchFailure = value; },
    set runningOnlyAvailable(value: boolean) { runningOnlyAvailable = value; },
    set ownerTabMatches(value: boolean) { ownerTabMatches = value; },
    set fetchBarrier(value: Promise<void> | null) { fetchBarrier = value; },
    now: () => now,
    advance(milliseconds: number) { now += milliseconds; },
  };
}

async function enable(h: ReturnType<typeof harness>) {
  return h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, true);
}

async function register(h: ReturnType<typeof harness>, threadIds: readonly string[], completion = {
  turnKey: 'answer-turn', assistantMessageId: 'assistant-message',
}) {
  return h.auto.registerCompletedAnswer(target.id, 'connection-A', ownerA.ownerTabId, ownerA.ownerConversationId,
    completion.turnKey, completion.assistantMessageId, threadIds);
}

async function getCandidates(h: ReturnType<typeof harness>, completion = {
  turnKey: 'answer-turn', assistantMessageId: 'assistant-message',
}) {
  return h.auto.getRunningCandidates(target.id, ownerA.ownerTabId, ownerA.ownerConversationId,
    completion.turnKey, completion.assistantMessageId);
}

test('ONは設定だけを保存し、すでに実行中のthreadを検索も登録もしない', async () => {
  const h = harness([liveThread(threadOneId, turnOneId), liveThread(threadTwoId, turnTwoId)]);
  assert.equal((await enable(h)).ok, true);
  assert.equal(h.runningOnlyCalls, 0);
  assert.deepEqual(await h.monitor.list(), []);
  assert.equal(h.alarms.names.has(CODEX_BRIDGE_AUTO_WATCH_ALARM), false);
  assert.ok(CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY in h.storage.values);
  const stored = h.storage.values[CODEX_BRIDGE_AUTO_WATCH_STORAGE_KEY] as { version: number; entries: unknown[] };
  assert.equal(stored.version, 1);
  assert.equal(stored.entries.length, 1);
});

test('Bridge候補取得は明示ON後だけ行い、応答中のlive thread.idだけを返す', async () => {
  const finishedId = 'finished-candidate';
  const estimatedId = 'estimated-candidate';
  const h = harness([
    liveThread(threadOneId, turnOneId),
    { ...liveThread(finishedId, turnTwoId), currentExecution: null },
    { ...liveThread(estimatedId, turnTwoId), currentExecution: {
      ...liveThread(estimatedId, turnTwoId).currentExecution!, state: 'estimated_running', evidence: 'inferred',
    } },
  ]);
  assert.deepEqual(await getCandidates(h), { ok: true, data: { connectionId: null, threadIds: [] } });
  assert.equal(h.runningOnlyCalls, 0);
  assert.equal((await enable(h)).ok, true);
  assert.deepEqual(await getCandidates(h), { ok: true, data: { connectionId: 'connection-A', threadIds: [threadOneId] } });
  assert.equal(h.runningOnlyCalls, 1);
});

test('完了turn/message identityはthread ID上限512文字ではなくschema上限1024文字まで受け入れる', async () => {
  const h = harness([liveThread(threadOneId, turnOneId)]);
  await enable(h);
  const turnKey = 'turn'.repeat(150);
  const assistantMessageId = 'assistant'.repeat(100);
  assert.equal(turnKey.length, 600);
  assert.equal(assistantMessageId.length, 900);
  assert.deepEqual(await h.auto.getRunningCandidates(target.id, ownerA.ownerTabId, ownerA.ownerConversationId,
    turnKey, assistantMessageId), {
    ok: true, data: { connectionId: 'connection-A', threadIds: [threadOneId] },
  });
  assert.equal(h.runningOnlyCalls, 1);
});

test('Bridge候補IDの合計文字数上限を超えた応答は部分的に返さない', async () => {
  const tooManyCharacters = Array.from({ length: 130 }, (_, index) =>
    liveThread(`${String(index).padStart(3, '0')}-${'x'.repeat(508)}`, turnOneId));
  const h = harness(tooManyCharacters);
  await enable(h);
  assert.deepEqual(await getCandidates(h), { ok: false, reason: 'protocol-error' });
  assert.equal(h.runningOnlyCalls, 1);
});

test('candidate running_only応答中にowner routeが変わればID候補を返さない', async () => {
  const h = harness([liveThread(threadOneId, turnOneId)]);
  await enable(h);
  let release!: () => void;
  h.fetchBarrier = new Promise<void>((resolve) => { release = resolve; });
  const reading = getCandidates(h);
  await settle();
  h.ownerTabMatches = false;
  release();
  const result = await reading;
  assert.deepEqual(result, { ok: false, reason: 'owner-tab-unavailable' });
  assert.equal(h.runningOnlyCalls, 1);
});

test('candidate running_only応答中にconnectionが変わればID候補を返さない', async () => {
  const h = harness([liveThread(threadOneId, turnOneId)]);
  await enable(h);
  let release!: () => void;
  h.fetchBarrier = new Promise<void>((resolve) => { release = resolve; });
  const reading = getCandidates(h);
  await settle();
  h.connectionId = 'connection-B';
  release();
  assert.deepEqual(await reading, { ok: false, reason: 'connection-changed' });
  assert.equal(h.runningOnlyCalls, 1);
});

test('回答完了時に一度だけ取得し、本文候補と完全一致するlive threadだけ登録する', async () => {
  const terminal = { ...liveThread('01a207d3-12ab-7c00-a911-3288982ab225', turnOneId), currentExecution: null };
  const estimated = { ...liveThread(threadTwoId, turnTwoId),
    currentExecution: { ...liveThread(threadTwoId, turnTwoId).currentExecution!, state: 'estimated_running', evidence: 'live' } };
  const h = harness([liveThread(threadOneId, turnOneId), liveThread(threadTwoId, turnTwoId), terminal, estimated]);
  await enable(h);
  const registered = await register(h, [threadOneId, `${threadOneId}x`, turnOneId]);
  assert.equal(registered, 1);
  assert.equal(h.runningOnlyCalls, 1);
  assert.deepEqual((await h.monitor.list()).map((item) => item.threadId), [threadOneId]);
  assert.equal((await h.monitor.list())[0]?.baselineTurnId, turnOneId);
});

test('回答完了本文IDがあってもfinished・estimated・Bridge応答外のthreadは登録しない', async () => {
  const finishedId = 'finished-thread-id';
  const estimatedId = 'estimated-thread-id';
  const finished = { ...liveThread(finishedId, turnOneId), currentExecution: null,
    lastTurn: { turnId: turnOneId, status: 'completed' as const, category: null, evidence: 'live' as const,
      reason: null, observedAt: null, needsAttention: false } };
  const estimated = { ...liveThread(estimatedId, turnTwoId), currentExecution: {
    ...liveThread(estimatedId, turnTwoId).currentExecution!, state: 'estimated_running', evidence: 'inferred',
  } };
  const h = harness([finished, estimated]);
  await enable(h);
  assert.equal(await register(h, [finishedId, estimatedId, 'absent-short-lived-thread']), 0);
  assert.equal(h.runningOnlyCalls, 1);
  assert.deepEqual(await h.monitor.list(), []);
});

test('空候補、無効owner、別target、別connectionではBridgeを取得しない', async () => {
  const h = harness([liveThread(threadOneId, turnOneId)]);
  await enable(h);
  assert.equal(await register(h, []), 0);
  assert.equal(await h.auto.registerCompletedAnswer(target.id, 'connection-A', 8, ownerA.ownerConversationId,
    'wrong-tab-turn', 'wrong-tab-message', [threadOneId]), 0);
  assert.equal(await h.auto.registerCompletedAnswer('target-2', 'connection-A', ownerA.ownerTabId, ownerA.ownerConversationId,
    'wrong-target-turn', 'wrong-target-message', [threadOneId]), 0);
  h.connectionId = 'connection-B';
  assert.equal(await register(h, [threadOneId], { turnKey: 'stale-turn', assistantMessageId: 'stale-message' }), 0);
  assert.equal(h.runningOnlyCalls, 0);
  assert.deepEqual(await h.monitor.list(), []);
});

test('remote target prefixは同じtarget内のnative IDだけを完全一致で対応する', async () => {
  const nativeId = 'native_thread-7';
  const h = harness([liveThread(nativeId, turnOneId)]);
  await enable(h);
  assert.equal(await register(h, [`${target.id}::${nativeId}`]), 1);
  assert.deepEqual((await h.monitor.list()).map((item) => item.threadId), [nativeId]);
});

test('複数IDと重複IDは一度ずつ登録し、同じ完了messageの再送では再取得しない', async () => {
  const h = harness([liveThread(threadOneId, turnOneId), liveThread(threadTwoId, turnTwoId)]);
  await enable(h);
  const completion = { turnKey: 'multi-turn', assistantMessageId: 'multi-message' };
  assert.equal(await register(h, [threadOneId, threadOneId, threadTwoId], completion), 2);
  assert.equal(await register(h, [threadOneId, threadTwoId], completion), 0);
  assert.equal(h.runningOnlyCalls, 1);
  assert.deepEqual((await h.monitor.list()).map((item) => item.threadId).sort(), [threadOneId, threadTwoId].sort());
});

test('登録処理の例外後も同じ完了messageの再送は抑止する', async () => {
  const h = harness([liveThread(threadOneId, turnOneId)]);
  await enable(h);
  const originalStartWatch = h.monitor.startWatch.bind(h.monitor);
  h.monitor.startWatch = (async (...args: Parameters<typeof h.monitor.startWatch>) => {
    if (args[1] === threadOneId) throw new Error('injected watch failure');
    return originalStartWatch(...args);
  }) as typeof h.monitor.startWatch;
  const completion = { turnKey: 'exception-turn', assistantMessageId: 'exception-message' };
  await assert.rejects(register(h, [threadOneId], completion), /injected watch failure/);
  assert.equal(await register(h, [threadOneId], completion), 0);
  assert.equal(h.runningOnlyCalls, 1);
});

test('turn IDだけ、他targetの同名ID、substring候補は登録されない', async () => {
  const h = harness([liveThread(threadOneId, turnOneId), liveThread('remote-native', turnTwoId, 'target-2')]);
  await enable(h);
  assert.equal(await register(h, [turnOneId, `prefix-${threadOneId}-suffix`, 'target-2::remote-native']), 0);
  assert.deepEqual(await h.monitor.list(), []);
});

test('Bridge失敗とrunning_only未対応は0件扱いせず状態に診断を残す', async () => {
  const h = harness([liveThread(threadOneId, turnOneId)]);
  await enable(h);
  h.fetchFailure = Object.assign(new Error('unsupported'), { code: 'running-only-unsupported' });
  assert.equal(await register(h, [threadOneId]), 0);
  const failed = await h.auto.getStatus(target.id, ownerA.ownerConversationId, ownerA.ownerTabId);
  assert.equal(failed.state, 'error');
  assert.equal(failed.failure, 'running-only-unsupported');
  assert.equal(failed.watchingThreadCount, 0);
  h.fetchFailure = null;
  h.runningOnlyAvailable = false;
  assert.equal(await register(h, [threadOneId], { turnKey: 'unsupported-turn', assistantMessageId: 'unsupported-message' }), 0);
  assert.equal((await h.auto.getStatus(target.id, ownerA.ownerConversationId, ownerA.ownerTabId)).state, 'error');
});

test('別ownerまたはownerlessの既存watchを移管せず、manual watchは維持する', async () => {
  const h = harness([liveThread(threadOneId, turnOneId), liveThread(threadTwoId, turnTwoId)]);
  await h.monitor.startWatch(target.id, threadOneId, {
    ownerTabId: 8, ownerConversationId: 'conversation-B', ownerMuted: false, ownerMuteRevision: 0,
  });
  await h.monitor.startWatch(target.id, threadTwoId);
  await enable(h);
  assert.equal(await register(h, [threadOneId, threadTwoId]), 0);
  const items = await h.monitor.list();
  assert.equal(items.length, 2);
  assert.equal(items.find((item) => item.threadId === threadOneId)?.ownerConversationId, 'conversation-B');
  assert.equal(items.find((item) => item.threadId === threadTwoId)?.ownerConversationId, undefined);
});

test('手動解除したlive executionはskipし、新しいturnは再登録する', async () => {
  const h = harness([liveThread(threadOneId, turnOneId)]);
  await enable(h);
  assert.equal(await register(h, [threadOneId]), 1);
  assert.equal(await h.auto.stopWatch('connection-A', target.id, threadOneId, ownerA.ownerConversationId), true);
  assert.equal(await register(h, [threadOneId], { turnKey: 'same-live-turn', assistantMessageId: 'next-answer-1' }), 0);
  h.threads = [liveThread(threadOneId, turnTwoId)];
  assert.equal(await register(h, [threadOneId], { turnKey: 'new-live-turn', assistantMessageId: 'next-answer-2' }), 1);
  assert.equal((await h.monitor.list())[0]?.baselineTurnId, turnTwoId);
});

test('OFFはwatchを削除せず、worker restoreは旧alarmだけを解除して発見を再開しない', async () => {
  const h = harness([liveThread(threadOneId, turnOneId)]);
  await enable(h);
  assert.equal(await register(h, [threadOneId]), 1);
  const watchId = (await h.monitor.list())[0]?.watchId;
  h.alarms.names.add(CODEX_BRIDGE_AUTO_WATCH_ALARM);
  const requests = h.runningOnlyCalls;
  await h.auto.restore();
  assert.equal(h.alarms.names.has(CODEX_BRIDGE_AUTO_WATCH_ALARM), false);
  assert.equal(h.runningOnlyCalls, requests);
  assert.equal((await h.monitor.list())[0]?.watchId, watchId);
  assert.equal((await h.auto.setEnabled(target.id, ownerA.ownerTabId, ownerA.ownerConversationId, false)).ok, true);
  assert.equal((await h.monitor.list())[0]?.watchId, watchId);
  assert.equal(await register(h, [threadOneId], { turnKey: 'after-off-turn', assistantMessageId: 'after-off-answer' }), 0);
  assert.equal(h.runningOnlyCalls, requests);
});

test('running_only応答を待つ間にconnectionまたはowner routeが変われば登録しない', async () => {
  const h = harness([liveThread(threadOneId, turnOneId)]);
  await enable(h);
  let release!: () => void;
  h.fetchBarrier = new Promise<void>((resolve) => { release = resolve; });
  const result = register(h, [threadOneId], { turnKey: 'racing-turn', assistantMessageId: 'racing-message' });
  while (h.runningOnlyCalls === 0) await new Promise((resolve) => setImmediate(resolve));
  h.connectionId = 'connection-B';
  release();
  assert.equal(await result, 0);
  assert.deepEqual(await h.monitor.list(), []);

  const second = harness([liveThread(threadOneId, turnOneId)]);
  await enable(second);
  let releaseOwner!: () => void;
  second.fetchBarrier = new Promise<void>((resolve) => { releaseOwner = resolve; });
  const ownerResult = register(second, [threadOneId], { turnKey: 'owner-race-turn', assistantMessageId: 'owner-race-message' });
  while (second.runningOnlyCalls === 0) await new Promise((resolve) => setImmediate(resolve));
  second.ownerTabMatches = false;
  releaseOwner();
  assert.equal(await ownerResult, 0);
  assert.deepEqual(await second.monitor.list(), []);
});

test('32件上限を守り、C45 terminal eventとwatch自動解除を継続する', async () => {
  const h = harness([liveThread(threadOneId, turnOneId)]);
  for (let index = 0; index < 32; index += 1) {
    assert.equal((await h.monitor.startWatch(target.id, `existing-${index}`, ownerA)).ok, true);
  }
  await enable(h);
  assert.equal(await register(h, [threadOneId]), 0);
  assert.equal((await h.auto.getStatus(target.id, ownerA.ownerConversationId, ownerA.ownerTabId)).failure, 'watch-limit');
  assert.equal((await h.monitor.list()).length, 32);

  const terminal = harness([liveThread(threadOneId, turnOneId)]);
  await enable(terminal);
  assert.equal(await register(terminal, [threadOneId]), 1);
  terminal.statusOverride = {
    targetId: target.id, threadId: threadOneId, state: 'idle', currentExecution: null,
    lastTurn: { turnId: turnOneId, status: 'completed', category: null, evidence: 'live', reason: null,
      observedAt: null, needsAttention: false }, needsAttention: false,
  };
  terminal.advance(5_000);
  await terminal.monitor.refreshForeground();
  assert.deepEqual(await terminal.monitor.list(), []);
  const events = await terminal.monitor.listEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.turnId, turnOneId);
  assert.equal(deriveCodexBridgeWatchTurnState({
    ...events[0]!, watchId: events[0]!.watchId, enabled: true, baselineCaptured: true, baselineTurnKind: 'turn',
    baselineTurnId: turnOneId, baselineTurnStatus: 'in_progress', lastObservedTurnId: turnOneId,
    statusState: 'idle', lastTurnStatus: 'completed', lastTurnEvidence: 'live', currentExecutionState: null,
    currentExecutionEvidence: null, currentExecutionTurnId: null, turnChange: 'advanced', observedAt: events[0]!.detectedAt,
    needsAttention: false, lastSuccessAt: events[0]!.detectedAt, fetchOutcome: 'ok', nextPollAt: terminal.now(), failureCount: 0,
  }), 'completed');
});

test('AnswerCompletionTrackerから実サービスまで、音声状態に関係なく回答中のIDだけを登録する', async () => {
  for (const [suffix, soundEnabled, volume, playbackFails] of [
    ['off', false, 100, false], ['failed', true, 100, true], ['silent', true, 0, false],
  ] as const) {
    const auto = harness([liveThread(threadOneId, turnOneId), liveThread(threadTwoId, turnTwoId)]);
    await enable(auto);
    const active = turn(`completion-${suffix}`, '質問', '', `assistant-${suffix}`, 'in_progress');
    let registration: Promise<number> | null = null;
    const unsubscribe = subscribeCodexBridgeAutoWatchCompletion((notice) => {
      registration = (async () => {
        const candidateResponse = await auto.auto.getRunningCandidates(target.id, ownerA.ownerTabId, notice.conversationId,
          notice.turnKey, notice.assistantMessageId);
        if (!candidateResponse.ok) return 0;
        const match = await matchCompletedAnswerAfterBridgeCandidates(async () => {
          assert.equal(auto.runningOnlyCalls, 1);
          return { ok: true, data: candidateResponse.data };
        }, () => {
          assert.equal(auto.runningOnlyCalls, 1);
          return { document: stats.document as unknown as Document, pathname: stats.window.location.pathname,
            targetId: target.id, conversationId: notice.conversationId };
        }, target.id, notice.conversationId, {
          turnKey: notice.turnKey, assistantMessageId: notice.assistantMessageId,
        });
        if (match.status !== 'ready') return 0;
        return auto.auto.registerCompletedAnswer(target.id, match.connectionId, ownerA.ownerTabId, notice.conversationId,
          notice.turnKey, notice.assistantMessageId, match.threadIds);
      })();
    });
    const stats = statisticsHarness(`/c/${ownerA.ownerConversationId}`, false, undefined, {
      onAnswerCompleted: (event, conversationId) => {
        publishCodexBridgeAutoWatchCompletion(stats.window.location.pathname, event, conversationId);
        dispatchAnswerCompletionNotifications({ notifyTab() {}, soundEnabled, soundVolumePercent: volume,
          playSound() { if (playbackFails) throw new Error('playback failed or muted'); } });
      },
    });
    stats.document.root.append(active);
    stats.controller.start();
    await settle();
    assert.equal(registration, null);
    assert.deepEqual(await auto.monitor.list(), []);
    active.querySelectorAll('[data-talvt-turn-state]')[0]!.attributes['data-talvt-turn-state'] = 'complete';
    active.querySelectorAll('[data-dil-message-id]')[0]!.text = `Target thread ${threadOneId}`;
    FakeMutationObserver.latest?.notify(active, active);
    await settle();
    assert.equal(await registration, 1);
    assert.equal(auto.runningOnlyCalls, 2);
    assert.deepEqual((await auto.monitor.list()).map((item) => item.threadId), [threadOneId]);
    stats.controller.stop();
    unsubscribe();
  }
});

test('Bridge応答前に現在本文から候補IDが消えた場合は監視登録しない', async () => {
  const auto = harness([liveThread(threadOneId, turnOneId)]);
  await enable(auto);
  let releaseCandidates!: () => void;
  auto.fetchBarrier = new Promise<void>((resolve) => { releaseCandidates = resolve; });
  let registration: Promise<number> | null = null;
  const unsubscribe = subscribeCodexBridgeAutoWatchCompletion((notice) => {
    registration = (async () => {
      const candidateResponse = await auto.auto.getRunningCandidates(target.id, ownerA.ownerTabId, notice.conversationId,
        notice.turnKey, notice.assistantMessageId);
      if (!candidateResponse.ok) return 0;
      const match = await matchCompletedAnswerAfterBridgeCandidates(async () => ({
        ok: true, data: candidateResponse.data,
      }), () => ({ document: stats.document as unknown as Document, pathname: stats.window.location.pathname,
        targetId: target.id, conversationId: notice.conversationId }), target.id, notice.conversationId, notice);
      if (match.status !== 'ready') return 0;
      return auto.auto.registerCompletedAnswer(target.id, match.connectionId, ownerA.ownerTabId, notice.conversationId,
        notice.turnKey, notice.assistantMessageId, match.threadIds);
    })();
  });
  const stats = statisticsHarness(`/c/${ownerA.ownerConversationId}`, false, undefined, {
    onAnswerCompleted: (event, conversationId) => {
      publishCodexBridgeAutoWatchCompletion(stats.window.location.pathname, event, conversationId);
    },
  });
  const active = turn('current-answer-turn', '質問', '', 'current-assistant-message', 'in_progress');
  stats.document.root.append(active);
  stats.controller.start();
  await settle();
  const body = active.querySelectorAll('[data-dil-message-id]')[0]!;
  active.querySelectorAll('[data-talvt-turn-state]')[0]!.attributes['data-talvt-turn-state'] = 'complete';
  body.text = `Bridge候補ID ${threadOneId}`;
  FakeMutationObserver.latest?.notify(active, active);
  while (auto.runningOnlyCalls === 0) await new Promise((resolve) => setImmediate(resolve));
  body.text = '現在の本文に候補IDはない';
  releaseCandidates();

  assert.ok(registration);
  assert.equal(await registration, 0);
  assert.equal(auto.runningOnlyCalls, 1);
  assert.deepEqual(await auto.monitor.list(), []);
  stats.controller.stop();
  unsubscribe();
});
