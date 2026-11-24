import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY,
  AnswerCompletionOutputDeviceRepository,
  DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION,
  MAX_ANSWER_COMPLETION_OUTPUT_DEVICES,
  normalizeAnswerCompletionOutputDeviceSelection,
  type OutputDeviceStorageAreaLike,
} from '../src/shared/answer-completion-output-device.ts';

function device(deviceId: string, label: string) { return { deviceId, label }; }

function makeStorage(initial: unknown) {
  let value = initial;
  const area: OutputDeviceStorageAreaLike = {
    async get() { return value === undefined ? {} : { [ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY]: value }; },
    async set(items) { value = items[ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY]; },
  };
  return { area, read: () => value };
}

function serialLocks() {
  let tail = Promise.resolve();
  const names: string[] = [];
  return {
    names,
    request<T>(name: string, callback: () => Promise<T>): Promise<T> {
      names.push(name);
      const result = tail.then(callback);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

test('旧単一出力値をschema 2配列へ読み替え、defaultは空配列にする', () => {
  assert.deepEqual(normalizeAnswerCompletionOutputDeviceSelection(device('usb-64', 'USB')),
    { schemaVersion: 2, devices: [device('usb-64', 'USB')] });
  assert.deepEqual(normalizeAnswerCompletionOutputDeviceSelection(device('default', '既定')),
    DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION);
});

test('出力設定キーがない場合は既定出力の空選択を返す', async () => {
  const fake = makeStorage(undefined);
  const repository = new AnswerCompletionOutputDeviceRepository(fake.area);
  assert.deepEqual(await repository.load(), { ok: true, selection: DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION });
});

test('schema 2はIDだけで重複を除き、default混在を破損扱いにし、同名labelの別IDを保つ', () => {
  assert.deepEqual(normalizeAnswerCompletionOutputDeviceSelection({ schemaVersion: 2, devices: [
    device('default', '既定'), device('usb-1', '同じスピーカー'), device('usb-1', '古い表示名'), device('usb-2', '同じスピーカー'),
  ] }), null);
  assert.deepEqual(normalizeAnswerCompletionOutputDeviceSelection({ schemaVersion: 2, devices: [
    device('usb-1', '同じスピーカー'), device('usb-1', '古い表示名'), device('usb-2', '同じスピーカー'),
  ] }), { schemaVersion: 2, devices: [device('usb-1', '同じスピーカー'), device('usb-2', '同じスピーカー')] });
  assert.deepEqual(normalizeAnswerCompletionOutputDeviceSelection({ schemaVersion: 2, devices: [device('default', '既定')] }),
    DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION);
});

test('未知schema・不正値・上限超過を破損扱いにし、上限を明示する', () => {
  assert.equal(MAX_ANSWER_COMPLETION_OUTPUT_DEVICES, 8);
  for (const value of [null, { schemaVersion: 3, devices: [] }, { schemaVersion: 2, devices: 'bad' },
    { schemaVersion: 2, extra: true, devices: [] }, { schemaVersion: 2, devices: [{ deviceId: 'bad id', label: 'USB' }] },
    { schemaVersion: 2, devices: Array.from({ length: 9 }, (_, index) => device(`usb-${index}`, `USB ${index}`)) }]) {
    assert.equal(normalizeAnswerCompletionOutputDeviceSelection(value), null);
  }
});

test('legacy保存値とstorage changeは同じ配列へ正規化し、新形式で保存する', async () => {
  const fake = makeStorage(device('usb-64', 'USB'));
  const listeners: Array<(changes: Record<string, { newValue?: unknown }>, areaName: string) => void> = [];
  const repository = new AnswerCompletionOutputDeviceRepository(fake.area, {
    addListener(listener) { listeners.push(listener); },
    removeListener(listener) { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1); },
  });
  assert.deepEqual(await repository.load(), { ok: true, selection: { schemaVersion: 2, devices: [device('usb-64', 'USB')] } });
  const changed: unknown[] = [];
  const unsubscribe = repository.subscribe((result) => changed.push(result));
  for (const listener of listeners) listener({ [ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY]: { newValue: device('default', 'default') } }, 'local');
  assert.deepEqual(changed, [{ ok: true, selection: DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION }]);
  assert.equal((await repository.setDeviceSelected(device('usb-65', 'USB 2'), true)).ok, true);
  assert.deepEqual(fake.read(), { schemaVersion: 2, devices: [device('usb-64', 'USB'), device('usb-65', 'USB 2')] });
  unsubscribe();
  assert.equal(listeners.length, 0);
});

test('toggle時に破損値を上書きしない', async () => {
  for (const corrupt of [
    { schemaVersion: 9, devices: [device('usb-old', '古い')] },
    { schemaVersion: 2, devices: [device('default', '既定'), device('usb-old', '古い')] },
  ]) {
    const fake = makeStorage(corrupt);
    const repository = new AnswerCompletionOutputDeviceRepository(fake.area);
    assert.deepEqual(await repository.load(), { ok: false, reason: 'corrupt-selection' });
    assert.deepEqual(await repository.setDeviceSelected(device('usb-new', '新しい'), true), { ok: false, reason: 'corrupt-selection' });
    assert.deepEqual(fake.read(), corrupt);
  }
});

test('異なるOptionsからの同時toggleは共通lockで最新配列へ両方を反映する', async () => {
  const fake = makeStorage(DEFAULT_ANSWER_COMPLETION_OUTPUT_DEVICE_SELECTION);
  const locks = serialLocks();
  const first = new AnswerCompletionOutputDeviceRepository(fake.area, undefined, locks);
  const second = new AnswerCompletionOutputDeviceRepository(fake.area, undefined, locks);
  const [a, b] = await Promise.all([
    first.setDeviceSelected(device('usb-1', 'USB 1'), true),
    second.setDeviceSelected(device('usb-2', 'USB 2'), true),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.deepEqual(await first.load(), { ok: true, selection: {
    schemaVersion: 2, devices: [device('usb-1', 'USB 1'), device('usb-2', 'USB 2')],
  } });
  assert.equal(locks.names.length, 2);
  assert.equal(new Set(locks.names).size, 1);
});
