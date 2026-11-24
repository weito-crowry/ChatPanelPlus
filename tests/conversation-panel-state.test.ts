import assert from 'node:assert/strict';
import test from 'node:test';
import { VIEW_STATE_STORAGE_KEY } from '../src/shared/settings-repository.ts';
import {
  CONVERSATION_PANEL_STATE_STORAGE_KEY,
  ConversationPanelStateRepository,
  type PanelStateStorageAreaLike,
  type PanelStateLockManagerLike,
  type PanelStateStorageChangesLike,
} from '../src/shared/conversation-panel-state-repository.ts';

const LEGACY = { selectedTabId: 'control', minimized: true };

function storage(initial: Record<string, unknown> = {}) {
  const data = structuredClone(initial);
  const changes = new Set<Parameters<PanelStateStorageChangesLike['addListener']>[0]>();
  const area: PanelStateStorageAreaLike = {
    async get(keys) { return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]])); },
    async set(items) {
      const oldValues = Object.fromEntries(Object.keys(items).filter((key) => key in data).map((key) => [key, data[key]]));
      Object.assign(data, structuredClone(items));
      changes.forEach((listener) => listener(Object.fromEntries(Object.entries(items).map(([key, newValue]) => [key, {
        ...(key in oldValues ? { oldValue: oldValues[key] } : {}), newValue,
      }])), 'local'));
    },
  };
  const onChanged: PanelStateStorageChangesLike = {
    addListener(listener) { changes.add(listener); },
    removeListener(listener) { changes.delete(listener); },
  };
  return { data, area, onChanged };
}

test('会話別状態をversioned local keyへ保存し、旧共有view stateを読まず書き換えない', async () => {
  const fake = storage({ [VIEW_STATE_STORAGE_KEY]: LEGACY });
  const repository = new ConversationPanelStateRepository(fake.area, fake.onChanged);
  const result = await repository.save('conversation-A', {
    schemaVersion: 1, selectedTabId: 'control', minimized: true, bridgeExpanded: true,
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(fake.data[VIEW_STATE_STORAGE_KEY], LEGACY);
  assert.deepEqual(await repository.load('conversation-A'), {
    ok: true, state: {
      schemaVersion: 1, selectedTabId: 'control', minimized: true, bridgeExpanded: true,
      bridgeWatchSelection: null, bridgeEventSelection: null, autoReflectTerminalAnswer: false, autoReflectTerminalAnswerEnabledAt: null,
    }, saved: true,
  });
  assert.ok(CONVERSATION_PANEL_STATE_STORAGE_KEY in fake.data);
});

test('同じ会話は保存状態を共有し、別会話は分離する', async () => {
  const fake = storage();
  const repository = new ConversationPanelStateRepository(fake.area);
  const state = {
    schemaVersion: 1 as const, selectedTabId: 'wall' as const, minimized: false, bridgeExpanded: true,
    bridgeWatchSelection: null, bridgeEventSelection: null, autoReflectTerminalAnswer: false, autoReflectTerminalAnswerEnabledAt: null,
  };
  assert.deepEqual(await repository.save('conversation-A', state), { ok: true });
  const loaded = await repository.load('conversation-A');
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.deepEqual(loaded.state, state);
  assert.deepEqual(await repository.load('conversation-B'), {
    ok: true, state: {
      schemaVersion: 1, selectedTabId: null, minimized: false, bridgeExpanded: false,
      bridgeWatchSelection: null, bridgeEventSelection: null, autoReflectTerminalAnswer: false, autoReflectTerminalAnswerEnabledAt: null,
    }, saved: false,
  });
});

test('監視終了時の回答自動反映は既定OFFで会話別に保存されreload後も維持する', async () => {
  const fake = storage();
  const repository = new ConversationPanelStateRepository(fake.area, fake.onChanged);
  const initial = await repository.load('conversation-A');
  assert.equal(initial.ok && initial.state.autoReflectTerminalAnswer, false);
  assert.deepEqual(await repository.update('conversation-A', {
    autoReflectTerminalAnswer: true, autoReflectTerminalAnswerEnabledAt: 1_795_515_600_000,
  }), { ok: true });
  const reloaded = await new ConversationPanelStateRepository(fake.area, fake.onChanged).load('conversation-A');
  assert.equal(reloaded.ok && reloaded.state.autoReflectTerminalAnswer, true);
  assert.equal(reloaded.ok && reloaded.state.autoReflectTerminalAnswerEnabledAt, 1_795_515_600_000);
  const other = await repository.load('conversation-B');
  assert.equal(other.ok && other.state.autoReflectTerminalAnswer, false);
});

test('同じ会話の複数タブが別項目を同時更新しても相互に保持する', async () => {
  const fake = storage();
  const queues = new Map<string, Promise<void>>();
  const locks: PanelStateLockManagerLike = {
    async request<T>(name: string, callback: () => Promise<T>): Promise<T> {
      const previous = queues.get(name) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => { release = resolve; });
      queues.set(name, current);
      await previous;
      try { return await callback(); }
      finally { release(); if (queues.get(name) === current) queues.delete(name); }
    },
  };
  const tabA = new ConversationPanelStateRepository(fake.area, undefined, locks);
  const tabB = new ConversationPanelStateRepository(fake.area, undefined, locks);
  const results = await Promise.all([
    tabA.update('conversation-A', {
      selectedTabId: 'wall', bridgeWatchSelection: { connectionId: 'connection-A', targetId: 'target-A', threadId: 'thread-A' },
    }),
    tabB.update('conversation-A', { minimized: true, bridgeEventSelection: 'event-A' }),
  ]);
  assert.deepEqual(results, [{ ok: true }, { ok: true }]);
  const loaded = await tabA.load('conversation-A');
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.deepEqual(loaded.state, {
    schemaVersion: 1, selectedTabId: 'wall', minimized: true, bridgeExpanded: false,
    bridgeWatchSelection: { connectionId: 'connection-A', targetId: 'target-A', threadId: 'thread-A' },
    bridgeEventSelection: 'event-A', autoReflectTerminalAnswer: false, autoReflectTerminalAnswerEnabledAt: null,
  });
});

test('B watch identityとC event選択を同一会話で共有し、別会話と分離する', async () => {
  const fake = storage();
  const repository = new ConversationPanelStateRepository(fake.area, fake.onChanged);
  const stateA = {
    schemaVersion: 1 as const, selectedTabId: 'control' as const, minimized: false, bridgeExpanded: true,
    bridgeWatchSelection: { connectionId: 'connection-A', targetId: 'target-A', threadId: 'thread-A' },
    bridgeEventSelection: 'event-A', autoReflectTerminalAnswer: false, autoReflectTerminalAnswerEnabledAt: null,
  };
  const stateB = {
    schemaVersion: 1 as const, selectedTabId: 'wall' as const, minimized: false, bridgeExpanded: true,
    bridgeWatchSelection: { connectionId: 'connection-B', targetId: 'target-B', threadId: 'thread-B' },
    bridgeEventSelection: 'event-B', autoReflectTerminalAnswer: false, autoReflectTerminalAnswerEnabledAt: null,
  };
  assert.deepEqual(await repository.save('conversation-A', stateA), { ok: true });
  assert.deepEqual(await repository.save('conversation-B', stateB), { ok: true });
  assert.deepEqual(await repository.load('conversation-A'), { ok: true, state: stateA, saved: true });
  assert.deepEqual(await repository.load('conversation-B'), { ok: true, state: stateB, saved: true });
});

test('既存schemaVersion 1状態は選択フィールドを既定値に補完して読み込む', async () => {
  const legacyConversationState = { schemaVersion: 1, selectedTabId: 'control', minimized: true, bridgeExpanded: false };
  const fake = storage({ [CONVERSATION_PANEL_STATE_STORAGE_KEY]: {
    schemaVersion: 1, conversations: { 'conversation-A': legacyConversationState },
  } });
  const repository = new ConversationPanelStateRepository(fake.area);
  assert.deepEqual(await repository.load('conversation-A'), {
    ok: true,
    state: {
      ...legacyConversationState, bridgeWatchSelection: null, bridgeEventSelection: null,
      autoReflectTerminalAnswer: false, autoReflectTerminalAnswerEnabledAt: null,
    },
    saved: true,
  });
});

test('壊れた新規選択値だけを既定値へ戻し、既存conversation状態を保つ', async () => {
  const fake = storage({ [CONVERSATION_PANEL_STATE_STORAGE_KEY]: {
    schemaVersion: 1,
    conversations: { 'conversation-A': {
      schemaVersion: 1, selectedTabId: 'control', minimized: true, bridgeExpanded: true,
      bridgeWatchSelection: { connectionId: 'connection-A', targetId: 'target-A' },
      bridgeEventSelection: 'x'.repeat(97),
    } },
  } });
  const repository = new ConversationPanelStateRepository(fake.area);
  assert.deepEqual(await repository.load('conversation-A'), {
    ok: true,
    state: {
      schemaVersion: 1, selectedTabId: 'control', minimized: true, bridgeExpanded: true,
      bridgeWatchSelection: null, bridgeEventSelection: null,
      autoReflectTerminalAnswer: false, autoReflectTerminalAnswerEnabledAt: null,
    },
    saved: true,
  });
});

test('conversation ID不明・不正ならlocal storageをread/writeしない', async () => {
  let reads = 0;
  let writes = 0;
  const area: PanelStateStorageAreaLike = {
    async get() { reads += 1; return {}; },
    async set() { writes += 1; },
  };
  const repository = new ConversationPanelStateRepository(area);
  assert.deepEqual(await repository.load(null), { ok: false, reason: 'invalid-conversation-id' });
  assert.deepEqual(await repository.save('bad/id', {
    schemaVersion: 1, selectedTabId: null, minimized: false, bridgeExpanded: false,
  }), { ok: false, reason: 'invalid-conversation-id' });
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});

test('同じconversation IDのstorage変更だけをsubscriberへ通知する', async () => {
  const fake = storage();
  const repository = new ConversationPanelStateRepository(fake.area, fake.onChanged);
  const received: unknown[] = [];
  const unsubscribe = repository.subscribe('conversation-A', (result) => received.push(result));
  await repository.save('conversation-B', {
    schemaVersion: 1, selectedTabId: 'wall', minimized: false, bridgeExpanded: false,
  });
  assert.deepEqual(received, []);
  await repository.save('conversation-A', {
    schemaVersion: 1, selectedTabId: 'control', minimized: true, bridgeExpanded: true,
  });
  assert.equal(received.length, 1);
  unsubscribe();
});

test('未知schemaは保持し、conversation stateで上書きしない', async () => {
  const invalid = { schemaVersion: 8, conversations: {} };
  const fake = storage({ [CONVERSATION_PANEL_STATE_STORAGE_KEY]: invalid });
  const repository = new ConversationPanelStateRepository(fake.area);
  assert.deepEqual(await repository.load('conversation-A'), { ok: false, reason: 'unsupported-version' });
  assert.deepEqual(await repository.save('conversation-A', {
    schemaVersion: 1, selectedTabId: null, minimized: false, bridgeExpanded: false,
  }), { ok: false, reason: 'unsupported-version' });
  assert.deepEqual(fake.data[CONVERSATION_PANEL_STATE_STORAGE_KEY], invalid);
});
