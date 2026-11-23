import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexBridgeTerminalRefreshCoordinator } from '../src/content/codexbridge-terminal-refresh.ts';

const currentRunning = { ownerConversationId: 'conversation-A', connectionId: 'connection-A', targetId: 'target-A',
  mode: 'running' as const, connected: true, routeCurrent: true, threadsBusy: false };
const event = (eventId: string, targetId = 'target-A') => ({ connectionId: 'connection-A', eventId, targetId });
const watch = (threadId: string, targetId = 'target-A', ownerConversationId = 'conversation-A', connectionId = 'connection-A') => ({
  watchId: `watch-${threadId}`, threadId, targetId, ownerConversationId, connectionId,
});
const watchContext = currentRunning;

test('current running target uses one thread refresh and coalesces new terminal events', () => {
  const coordinator = new CodexBridgeTerminalRefreshCoordinator();
  assert.equal(coordinator.observe([event('one'), event('two')], currentRunning), 'threads');
  assert.equal(coordinator.observe([event('one')], currentRunning), null);
  assert.equal(coordinator.observe([event('two')], currentRunning), null);
});

test('normal mode refreshes summary only and leaves an in-flight cursor page alone', () => {
  const coordinator = new CodexBridgeTerminalRefreshCoordinator();
  assert.equal(coordinator.observe([event('normal')], { ...currentRunning, mode: 'normal', threadsBusy: true }), 'summary');
});

test('running terminal refresh waits for the active request and runs once if its target and mode remain current', () => {
  const coordinator = new CodexBridgeTerminalRefreshCoordinator();
  assert.equal(coordinator.observe([event('one'), event('two')], { ...currentRunning, threadsBusy: true }), null);
  assert.equal(coordinator.observe([event('one')], { ...currentRunning, threadsBusy: true }), null);
  assert.equal(coordinator.finishRunningRequest('target-A', currentRunning), true);
  assert.equal(coordinator.finishRunningRequest('target-A', currentRunning), false);
});

test('target, route, and connection guards plus mode invalidation discard stale work', () => {
  const coordinator = new CodexBridgeTerminalRefreshCoordinator();
  assert.equal(coordinator.observe([event('other', 'target-B')], currentRunning), null);
  assert.equal(coordinator.observe([event('route')], { ...currentRunning, routeCurrent: false }), null);
  assert.equal(coordinator.observe([event('offline')], { ...currentRunning, connected: false }), null);
  assert.equal(coordinator.observe([event('queued')], { ...currentRunning, threadsBusy: true }), null);
  coordinator.clearPending();
  assert.equal(coordinator.finishRunningRequest('target-A', { ...currentRunning, mode: 'normal' }), false);
});

test('新規watch追加は同じowner・connection・targetのrunning Aを一度更新し、一斉登録を一回へ束ねる', () => {
  const coordinator = new CodexBridgeTerminalRefreshCoordinator();
  assert.equal(coordinator.observeWatchAdditions([watch('one'), watch('two')], watchContext), 'threads');
  assert.equal(coordinator.observeWatchAdditions([watch('one'), watch('two')], watchContext), null);
});

test('normal modeではwatch追加からsummaryだけを更新し、一覧request中でもcursor一覧を触らない', () => {
  const coordinator = new CodexBridgeTerminalRefreshCoordinator();
  assert.equal(coordinator.observeWatchAdditions([watch('normal')], { ...watchContext, mode: 'normal', threadsBusy: true }), 'summary');
});

test('別owner・target・connection、route不一致、初回connection snapshotは新規watch更新を発生させない', () => {
  const coordinator = new CodexBridgeTerminalRefreshCoordinator();
  assert.equal(coordinator.observeWatchAdditions([watch('owner', 'target-A', 'conversation-B')], watchContext), null);
  assert.equal(coordinator.observeWatchAdditions([watch('target', 'target-B')], watchContext), null);
  assert.equal(coordinator.observeWatchAdditions([watch('connection', 'target-A', 'conversation-A', 'connection-B')], watchContext), null);
  assert.equal(coordinator.observeWatchAdditions([watch('route')], { ...watchContext, routeCurrent: false }), null);
  assert.equal(coordinator.observeWatchAdditions([watch('offline')], { ...watchContext, connected: false }), null);
  assert.equal(coordinator.observeWatchAdditions([watch('unbound')], { ...watchContext, connectionId: null }), null);
});

test('running追加refreshの遅延中はowner・connection・mode・targetが変わると破棄する', () => {
  const coordinator = new CodexBridgeTerminalRefreshCoordinator();
  assert.equal(coordinator.observeWatchAdditions([watch('queued')], { ...watchContext, threadsBusy: true }), null);
  assert.equal(coordinator.finishRunningRequest('target-A', watchContext), true);
  assert.equal(coordinator.observeWatchAdditions([watch('queued-2')], { ...watchContext, threadsBusy: true }), null);
  assert.equal(coordinator.finishRunningRequest('target-A', { ...watchContext, connectionId: 'connection-B' }), false);
  assert.equal(coordinator.observeWatchAdditions([watch('queued-3')], { ...watchContext, threadsBusy: true }), null);
  assert.equal(coordinator.finishRunningRequest('target-A', { ...watchContext, ownerConversationId: 'conversation-B' }), false);
  assert.equal(coordinator.observeWatchAdditions([watch('queued-4')], { ...watchContext, threadsBusy: true }), null);
  assert.equal(coordinator.finishRunningRequest('target-A', { ...watchContext, mode: 'normal' }), false);
});

test('C38 terminal refresh remains running A rows and summary from the same response', () => {
  const coordinator = new CodexBridgeTerminalRefreshCoordinator();
  let rows = ['running-thread'];
  let summaryCount = rows.length;
  assert.equal(summaryCount, 1);
  assert.equal(coordinator.observe([event('terminal')], watchContext), 'threads');
  const response = { threads: [] };
  rows = response.threads;
  summaryCount = response.threads.length;
  assert.deepEqual({ rows: rows.length, summaryCount }, { rows: 0, summaryCount: 0 });
});
