import assert from 'node:assert/strict';
import test from 'node:test';
import type { CodexBridgeThread } from '../src/shared/codexbridge-mcp-protocol.ts';
import { CodexBridgeRequestTracker, mergeCodexBridgeThreads } from '../src/content/codexbridge-request-tracker.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function thread(id: string, title: string): CodexBridgeThread {
  return {
    targetId: 'machine-A', id, title, preview: null, cwd: null, updatedAt: null,
    currentExecution: null, lastTurn: null, needsAttention: null,
  };
}

test('late thread response for target A is ignored after selecting target B', async () => {
  const tracker = new CodexBridgeRequestTracker();
  tracker.selectTarget('machine-A');
  const requestA = tracker.beginThreads('machine-A');
  const responseA = deferred<string>();
  let visibleTarget = '';
  const applyA = responseA.promise.then((value) => {
    if (tracker.isCurrentThreads(requestA)) visibleTarget = value;
  });

  tracker.selectTarget('machine-B');
  const requestB = tracker.beginThreads('machine-B');
  const responseB = deferred<string>();
  const applyB = responseB.promise.then((value) => {
    if (tracker.isCurrentThreads(requestB) && tracker.setNextCursor(requestB, null)) visibleTarget = value;
  });

  responseB.resolve('machine-B');
  await applyB;
  responseA.resolve('machine-A');
  await applyA;
  assert.equal(visibleTarget, 'machine-B');
});

test('late running_only response is ignored after switching to normal mode', async () => {
  const tracker = new CodexBridgeRequestTracker();
  tracker.selectTarget('machine-A');
  const runningRequest = tracker.beginThreads('machine-A');
  let visibleMode = '';
  const delayedRunningResponse = Promise.resolve().then(() => {
    if (tracker.isCurrentThreads(runningRequest)) visibleMode = 'running';
  });

  tracker.selectMode('normal');
  const normalRequest = tracker.beginThreads('machine-A');
  if (tracker.isCurrentThreads(normalRequest) && tracker.setNextCursor(normalRequest, 'cursor-2')) visibleMode = 'normal';
  await delayedRunningResponse;
  assert.equal(visibleMode, 'normal');
});

test('normal page response appends under its cursor and a newer refresh invalidates pending pages', () => {
  const merged = mergeCodexBridgeThreads(
    [thread('thread-1', 'old title')],
    [thread('thread-2', 'page two'), thread('thread-1', 'updated title')],
  );
  assert.deepEqual(merged.map((row) => row.id), ['thread-1', 'thread-2']);
  assert.equal(merged[0]?.title, 'updated title');

  const tracker = new CodexBridgeRequestTracker();
  tracker.selectTarget('machine-A');
  const firstPage = tracker.beginThreads('machine-A');
  assert.equal(tracker.isCurrentThreads(firstPage), true);
  assert.equal(tracker.setNextCursor(firstPage, 'cursor-2'), true);

  const nextPage = tracker.beginThreads('machine-A', 'cursor-2');
  assert.equal(tracker.isCurrentThreads(nextPage), true);
  assert.equal(tracker.setNextCursor(nextPage, 'cursor-3'), true);
  assert.equal(tracker.isCurrentThreads(nextPage), false);

  const refresh = tracker.beginThreads('machine-A');
  assert.equal(tracker.isCurrentThreads(refresh), true);
  assert.equal(tracker.isCurrentThreads(nextPage), false);
});

test('status response for a previous selected thread is ignored after selection changes', async () => {
  const tracker = new CodexBridgeRequestTracker();
  tracker.selectTarget('machine-A');
  tracker.selectThread('machine-A', 'thread-A');
  const requestA = tracker.beginStatus('machine-A', 'thread-A');
  const responseA = deferred<string>();
  let visibleStatus = '';
  const applyA = responseA.promise.then((value) => {
    if (tracker.isCurrentStatus(requestA)) visibleStatus = value;
  });

  tracker.selectThread('machine-A', 'thread-B');
  const requestB = tracker.beginStatus('machine-A', 'thread-B');
  const responseB = deferred<string>();
  const applyB = responseB.promise.then((value) => {
    if (tracker.isCurrentStatus(requestB)) visibleStatus = value;
  });
  responseB.resolve('thread-B');
  await applyB;
  responseA.resolve('thread-A');
  await applyA;
  assert.equal(visibleStatus, 'thread-B');
});
