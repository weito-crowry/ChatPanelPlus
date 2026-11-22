import assert from 'node:assert/strict';
import test from 'node:test';
import { clearCodexBridgeEventIds } from '../src/content/codexbridge-event-clear.ts';

const ids = (count: number) => Array.from({ length: count }, (_, index) => `event-${index}`);

test('通知クリアは固定snapshotを129件以上でも128件ずつ直列処理する', async () => {
  const snapshot = ids(256);
  const batches: string[][] = [];
  const result = await clearCodexBridgeEventIds(snapshot, async (batch) => { batches.push([...batch]); return true; }, () => true);
  assert.deepEqual(batches.map((batch) => batch.length), [128, 128]);
  assert.deepEqual(batches.flat(), snapshot);
  assert.deepEqual(result, { status: 'complete', totalCount: 256, clearedCount: 256 });
});

test('途中失敗を部分削除として返し、新規通知をsnapshotへ混ぜない', async () => {
  const snapshot = ids(129);
  const cleared = new Set<string>();
  let calls = 0;
  const result = await clearCodexBridgeEventIds(snapshot, async (batch) => {
    calls += 1;
    if (calls === 1) { batch.forEach((id) => cleared.add(id)); return true; }
    return false;
  }, () => true);
  assert.deepEqual(result, { status: 'partial', totalCount: 129, clearedCount: 128 });
  assert.equal(cleared.size, 128);
  assert.equal(cleared.has('event-128'), false);
  assert.equal(calls, 2);
});

test('SPA route change stops before the next clear batch', async () => {
  let current = true;
  const batches: string[][] = [];
  const result = await clearCodexBridgeEventIds(ids(256), async (batch) => {
    batches.push([...batch]);
    current = false;
    return true;
  }, () => current);
  assert.deepEqual(batches.map((batch) => batch.length), [128]);
  assert.deepEqual(result, { status: 'partial', totalCount: 256, clearedCount: 128 });
});
