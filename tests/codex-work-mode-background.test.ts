import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_WORK_MODE_SESSION_KEY_PREFIX,
  createCodexWorkModeMessageHandler,
  removeCodexWorkModeEntriesForTab,
} from '../src/background/codex-work-mode.ts';

function createSession(initial: Record<string, unknown> = {}) {
  const values = { ...initial };
  let writes = 0;
  let removed: string[] = [];
  let failWrites = false;
  return {
    values,
    get writes() { return writes; },
    get removed() { return removed; },
    set failWrites(value: boolean) { failWrites = value; },
    area: {
      async get(keys: string | null) {
        if (keys === null) return { ...values };
        return keys in values ? { [keys]: values[keys] } : {};
      },
      async set(items: Record<string, unknown>) {
        writes += 1;
        if (failWrites) throw new Error('write failed');
        Object.assign(values, items);
      },
      async remove(keys: string | string[]) {
        removed = Array.isArray(keys) ? keys : [keys];
        removed.forEach((key) => delete values[key]);
      },
    },
  };
}

const sender = (tabId: number, origin = 'https://chatgpt.com') => ({
  id: 'extension-id',
  origin,
  url: `${origin}/c/conversation-one`,
  tab: { id: tabId },
  frameId: 0,
});

test('session state is isolated by browser sender tab id and conversation id', async () => {
  const session = createSession();
  const notifications: { tabId: number; message: unknown }[] = [];
  const handler = createCodexWorkModeMessageHandler(session.area, 'extension-id', (tabId, message) => {
    notifications.push({ tabId, message });
  });
  const set = await handler({ type: 'SET_CODEX_WORK_MODE', conversationId: 'conversation-one', enabled: true }, sender(41));

  assert.deepEqual(set, { ok: true, value: { schemaVersion: 1, enabled: true } });
  assert.deepEqual(await handler({ type: 'GET_CODEX_WORK_MODE', conversationId: 'conversation-one' }, sender(41)), {
    ok: true, value: { schemaVersion: 1, enabled: true }, saved: true,
  });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.tabId, 41);
  assert.deepEqual(notifications[0]?.message, {
    type: 'CODEX_WORK_MODE_UPDATED',
    conversationId: 'conversation-one',
    result: { ok: true, value: { schemaVersion: 1, enabled: true }, saved: true },
  });
  assert.deepEqual(await handler({ type: 'GET_CODEX_WORK_MODE', conversationId: 'conversation-two' }, sender(41)), {
    ok: true, value: { schemaVersion: 1, enabled: false }, saved: false,
  });
  assert.deepEqual(await handler({ type: 'GET_CODEX_WORK_MODE', conversationId: 'conversation-one' }, sender(42)), {
    ok: true, value: { schemaVersion: 1, enabled: false }, saved: false,
  });
});

test('untrusted senders and malformed conversation ids cannot read or write session state', async () => {
  const session = createSession();
  const handler = createCodexWorkModeMessageHandler(session.area, 'extension-id');

  assert.equal(await handler({ type: 'SET_CODEX_WORK_MODE', conversationId: 'one', enabled: true }, sender(41, 'https://example.com')), null);
  assert.equal(await handler({ type: 'SET_CODEX_WORK_MODE', conversationId: '../one', enabled: true }, sender(41)), null);
  assert.equal(await handler({ type: 'GET_CODEX_WORK_MODE', conversationId: 'one' }, { ...sender(41), tab: undefined }), null);
  assert.equal(session.writes, 0);
  assert.deepEqual(session.values, {});
});

test('invalid session data is preserved and tab removal clears only that tab entries', async () => {
  const key = `${CODEX_WORK_MODE_SESSION_KEY_PREFIX}41.conversation-one`;
  const otherKey = `${CODEX_WORK_MODE_SESSION_KEY_PREFIX}42.conversation-one`;
  const malformed = { schemaVersion: 8, enabled: true };
  const session = createSession({ [key]: malformed, [otherKey]: { schemaVersion: 1, enabled: true } });
  const handler = createCodexWorkModeMessageHandler(session.area, 'extension-id');

  assert.deepEqual(await handler({ type: 'GET_CODEX_WORK_MODE', conversationId: 'conversation-one' }, sender(41)), {
    ok: false, reason: 'invalid-data',
  });
  assert.equal(session.values[key], malformed);
  assert.equal(session.writes, 0);

  await removeCodexWorkModeEntriesForTab(session.area, 41);
  assert.deepEqual(session.removed, [key]);
  assert.deepEqual(session.values[otherKey], { schemaVersion: 1, enabled: true });
});

test('storage write errors are returned without reporting success or notifying content', async () => {
  const session = createSession();
  session.failWrites = true;
  const notifications: unknown[] = [];
  const handler = createCodexWorkModeMessageHandler(session.area, 'extension-id', (_tabId, message) => { notifications.push(message); });

  assert.deepEqual(await handler({ type: 'SET_CODEX_WORK_MODE', conversationId: 'conversation-one', enabled: true }, sender(41)), {
    ok: false, reason: 'storage-error',
  });
  assert.deepEqual(session.values, {});
  assert.deepEqual(notifications, []);
});
