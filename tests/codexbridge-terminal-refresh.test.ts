import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexBridgeTerminalRefreshCoordinator } from '../src/content/codexbridge-terminal-refresh.ts';

const currentRunning = { targetId: 'target-A', mode: 'running' as const, connected: true, routeCurrent: true, threadsBusy: false };
const event = (eventId: string, targetId = 'target-A') => ({ connectionId: 'connection-A', eventId, targetId });

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
