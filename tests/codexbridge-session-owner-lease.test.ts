import assert from 'node:assert/strict';
import test from 'node:test';
import { codexBridgeOwnerLeaseSessionKey, CodexBridgeSessionOwnerLeases } from '../src/background/thread-monitor-owner-lease.ts';

const identity = { connectionId: 'connection-A', targetId: 'target-A', conversationId: 'conversation-A' } as const;

class FakeSession {
  readonly values: Record<string, unknown> = {};
  failRead = false;
  failWrite = false;

  async get(keys: string[] | null): Promise<Record<string, unknown>> {
    if (this.failRead) throw new Error('session read failed');
    const selected = keys ?? Object.keys(this.values);
    return Object.fromEntries(selected.filter((key) => key in this.values).map((key) => [key, structuredClone(this.values[key])]));
  }

  async set(items: Record<string, unknown>): Promise<void> {
    if (this.failWrite) throw new Error('session write failed');
    Object.assign(this.values, structuredClone(items));
  }
  async remove(keys: string[]): Promise<void> { for (const key of keys) delete this.values[key]; }
}

function leases(session: FakeSession, identities = new Map<number, string>(), timeout = 1_000) {
  return new CodexBridgeSessionOwnerLeases(session, async (tabId) => {
    if (!identities.has(tabId)) return { kind: 'closed' as const };
    const conversationId = identities.get(tabId)!;
    return conversationId === 'unknown' ? { kind: 'unknown' as const }
      : { kind: 'identity' as const, conversationId };
  }, () => `epoch-${timeout}`);
}

test('worker再起動を越えてsession leaseを維持し、同一会話の別tabは所有を奪わない', async () => {
  const session = new FakeSession();
  const tabIdentities = new Map<number, string>([[4, identity.conversationId], [9, identity.conversationId]]);
  assert.equal(await leases(session, tabIdentities).claim(identity, 4), 'claimed');
  const key = codexBridgeOwnerLeaseSessionKey(identity);
  const persistedEpoch = (session.values[key] as { epoch: string }).epoch;

  const restartedWorker = leases(session, tabIdentities);
  assert.equal(await restartedWorker.claim(identity, 4), 'current');
  assert.equal((session.values[key] as { epoch: string }).epoch, persistedEpoch);
  assert.equal(await restartedWorker.claim(identity, 9), 'other-tab');
  assert.deepEqual(await restartedWorker.resolveOwner(identity), { kind: 'owner', tabId: 4 });
});

test('session reset後は旧local tab IDを参照せず、現在の検証済みtabがclaimする', async () => {
  const session = new FakeSession();
  const oldSession = leases(session, new Map([[4, identity.conversationId]]));
  assert.equal(await oldSession.claim(identity, 4), 'claimed');

  const restartedBrowserSession = new FakeSession();
  const inspectCalls: number[] = [];
  const current = new CodexBridgeSessionOwnerLeases(restartedBrowserSession, async (tabId) => {
    inspectCalls.push(tabId);
    return { kind: 'identity', conversationId: identity.conversationId };
  }, () => 'new-epoch');
  assert.equal(await current.claim(identity, 9), 'claimed');
  assert.deepEqual(inspectCalls, []);
  assert.deepEqual(await current.resolveOwner(identity), { kind: 'owner', tabId: 9 });
});

test('owner閉鎖または別会話への遷移はrebindし、一時無応答では復旧待ちにする', async () => {
  const session = new FakeSession();
  const tabIdentities = new Map<number, string>([[4, identity.conversationId], [9, identity.conversationId]]);
  const manager = leases(session, tabIdentities);
  assert.equal(await manager.claim(identity, 4), 'claimed');
  tabIdentities.set(4, 'conversation-B');
  assert.equal(await manager.claim(identity, 9), 'claimed');

  tabIdentities.set(9, 'unknown');
  assert.equal(await manager.claim(identity, 4), 'recovering');
  assert.deepEqual(await manager.resolveOwner(identity), { kind: 'recovering' });

  const closedSession = new FakeSession();
  const closedIdentities = new Map<number, string>([[4, identity.conversationId], [9, identity.conversationId]]);
  const closedManager = leases(closedSession, closedIdentities);
  assert.equal(await closedManager.claim(identity, 4), 'claimed');
  closedIdentities.delete(4);
  assert.equal(await closedManager.claim(identity, 9), 'claimed');
});

test('同一identityの並行claimは一つのsession ownerに直列化する', async () => {
  const session = new FakeSession();
  const tabIdentities = new Map<number, string>([[4, identity.conversationId], [9, identity.conversationId]]);
  const manager = leases(session, tabIdentities);
  const results = await Promise.all([manager.claim(identity, 4), manager.claim(identity, 9)]);
  assert.deepEqual(results, ['claimed', 'other-tab']);
  assert.deepEqual(await manager.resolveOwner(identity), { kind: 'owner', tabId: 4 });
});

test('別会話のclaimは同一会話owner応答待ちに巻き込まれない', async () => {
  const session = new FakeSession();
  let releaseProbe!: () => void;
  let reportProbe!: () => void;
  const probeGate = new Promise<void>((resolve) => { releaseProbe = resolve; });
  const probeStarted = new Promise<void>((resolve) => { reportProbe = resolve; });
  const otherIdentity = { ...identity, conversationId: 'conversation-B' };
  const tabConversations = new Map([[4, identity.conversationId], [9, otherIdentity.conversationId]]);
  const manager = new CodexBridgeSessionOwnerLeases(session, async (tabId) => {
    if (tabId === 4) { reportProbe(); await probeGate; }
    return { kind: 'identity', conversationId: tabConversations.get(tabId) ?? identity.conversationId };
  }, () => 'epoch-parallel');
  assert.equal(await manager.claim(identity, 4), 'claimed');
  const waitingSameConversation = manager.claim(identity, 9);
  await probeStarted;
  assert.equal(await manager.claim(otherIdentity, 9), 'claimed');
  releaseProbe();
  assert.equal(await waitingSameConversation, 'other-tab');
  assert.deepEqual(await manager.resolveOwner(otherIdentity), { kind: 'owner', tabId: 9 });
});

test('session read/write failureはlease不在としてclaimせずstorage-errorを返す', async () => {
  const session = new FakeSession();
  session.failRead = true;
  const manager = leases(session, new Map([[4, identity.conversationId]]));
  assert.equal(await manager.claim(identity, 4), 'storage-error');
  assert.deepEqual(await manager.resolveOwner(identity), { kind: 'storage-error' });

  session.failRead = false;
  session.failWrite = true;
  assert.equal(await manager.claim(identity, 4), 'storage-error');
  assert.deepEqual(await manager.resolveOwner(identity), { kind: 'none' });
});

test('tab closeはそのtabのleaseだけをsession stateから解放する', async () => {
  const session = new FakeSession();
  const tabIdentities = new Map<number, string>([[4, identity.conversationId], [9, 'conversation-B']]);
  const manager = leases(session, tabIdentities);
  assert.equal(await manager.claim(identity, 4), 'claimed');
  assert.equal(await manager.claim({ ...identity, conversationId: 'conversation-B' }, 9), 'claimed');
  await manager.releaseTab(4);
  assert.deepEqual(await manager.resolveOwner(identity), { kind: 'none' });
  assert.deepEqual(await manager.resolveOwner({ ...identity, conversationId: 'conversation-B' }), { kind: 'owner', tabId: 9 });
});

test('閉鎖event時に同じtab IDが再利用済みなら新しいleaseを削除しない', async () => {
  const session = new FakeSession();
  const tabIdentities = new Map<number, string>([[4, identity.conversationId]]);
  const manager = leases(session, tabIdentities);
  assert.equal(await manager.claim(identity, 4), 'claimed');
  await manager.releaseTab(4, async () => false);
  assert.deepEqual(await manager.resolveOwner(identity), { kind: 'owner', tabId: 4 });
});
