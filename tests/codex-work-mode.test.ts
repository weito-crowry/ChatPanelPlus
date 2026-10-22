import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CodexWorkModeRepository,
  type CodexWorkModeRuntimeLike,
} from '../src/shared/codex-work-mode-repository.ts';

function runtime(response: unknown = { ok: true, value: { schemaVersion: 1, enabled: false }, saved: false }) {
  const messages: unknown[] = [];
  const listeners = new Set<(message: unknown, sender: { readonly id?: string }) => void>();
  const api: CodexWorkModeRuntimeLike = {
    id: 'extension-id',
    async sendMessage(message) {
      messages.push(message);
      return typeof response === 'function' ? response(message) : response;
    },
    onMessage: {
      addListener(listener) { listeners.add(listener); },
      removeListener(listener) { listeners.delete(listener); },
    },
  };
  return {
    api,
    messages,
    emit(message: unknown, sender = { id: 'extension-id' }) { listeners.forEach((listener) => listener(message, sender)); },
    get listenerCount() { return listeners.size; },
  };
}

test('repository uses conversation-scoped background messages and leaves the legacy local key untouched', async () => {
  const fake = runtime((message: { readonly type?: string }) => message.type === 'SET_CODEX_WORK_MODE'
    ? { ok: true, value: { schemaVersion: 1, enabled: true } }
    : { ok: true, value: { schemaVersion: 1, enabled: false }, saved: false });
  const legacyLocal = { 'chatPanelPlus.codexWorkMode': { schemaVersion: 1, enabled: true } };
  const repository = new CodexWorkModeRepository(fake.api);

  assert.deepEqual(await repository.load('conversation-one'), {
    ok: true, value: { schemaVersion: 1, enabled: false }, saved: false,
  });
  assert.deepEqual(await repository.setEnabled('conversation-two', true), {
    ok: true, value: { schemaVersion: 1, enabled: true },
  });
  assert.deepEqual(fake.messages, [
    { type: 'GET_CODEX_WORK_MODE', conversationId: 'conversation-one' },
    { type: 'SET_CODEX_WORK_MODE', conversationId: 'conversation-two', enabled: true },
  ]);
  assert.deepEqual(legacyLocal['chatPanelPlus.codexWorkMode'], { schemaVersion: 1, enabled: true });
});

test('invalid conversation ids and malformed background replies become storage errors', async () => {
  const fake = runtime({ unexpected: true });
  const repository = new CodexWorkModeRepository(fake.api);
  assert.deepEqual(await repository.load('bad/id'), { ok: false, reason: 'storage-error' });
  assert.deepEqual(await repository.load('conversation-one'), { ok: false, reason: 'storage-error' });
  assert.deepEqual(await repository.setEnabled('conversation-one', true), { ok: false, reason: 'storage-error' });
  assert.deepEqual(fake.messages, [
    { type: 'GET_CODEX_WORK_MODE', conversationId: 'conversation-one' },
    { type: 'SET_CODEX_WORK_MODE', conversationId: 'conversation-one', enabled: true },
  ]);
});

test('tab-local change notifications are validated and subscriptions are removed', () => {
  const fake = runtime();
  const repository = new CodexWorkModeRepository(fake.api);
  const received: unknown[] = [];
  const unsubscribe = repository.subscribe((change) => received.push(change));
  fake.emit({ type: 'CODEX_WORK_MODE_UPDATED', conversationId: 'conversation-one', result: {
    ok: true, value: { schemaVersion: 1, enabled: true }, saved: true,
  } });
  fake.emit({ type: 'CODEX_WORK_MODE_UPDATED', conversationId: 'conversation-two', result: {
    ok: false, reason: 'invalid-data',
  } });
  fake.emit({ type: 'CODEX_WORK_MODE_UPDATED', conversationId: 'conversation-one', result: {
    ok: true, value: { schemaVersion: 2, enabled: true }, saved: true,
  } });

  assert.deepEqual(received, [{
    conversationId: 'conversation-one',
    result: { ok: true, value: { schemaVersion: 1, enabled: true }, saved: true },
  }, {
    conversationId: 'conversation-two',
    result: { ok: false, reason: 'invalid-data' },
  }]);
  assert.equal(fake.listenerCount, 1);
  unsubscribe();
  assert.equal(fake.listenerCount, 0);
});
