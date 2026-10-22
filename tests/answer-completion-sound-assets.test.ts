import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_SOUND_ASSETS,
  MAX_SOUND_ASSET_BYTES,
  SOUND_ASSETS_STORAGE_KEY,
  SoundAssetRepository,
  prepareSoundAsset,
  type SoundAssetStorageAreaLike,
} from '../src/shared/answer-completion-sound-assets.ts';

function wavBytes(size = 44): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8);
  return bytes;
}

function file(name: string, bytes: Uint8Array, type = 'audio/wav') {
  return { name, type, size: bytes.byteLength, async arrayBuffer() { return bytes.slice().buffer; } };
}

function fakeStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  const listeners = new Set<(changes: Record<string, { newValue?: unknown }>, area: string) => void>();
  let failWrites = false;
  let writes = 0;
  const area: SoundAssetStorageAreaLike = {
    async get(keys) { return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]])); },
    async set(items) {
      writes += 1;
      if (failWrites) throw new Error('quota');
      const changes = Object.fromEntries(Object.entries(items).map(([key, value]) => [key, { newValue: value }]));
      Object.assign(data, items);
      for (const listener of listeners) listener(changes, 'local');
    },
  };
  return {
    data,
    area,
    changes: {
      addListener(listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void) { listeners.add(listener); },
      removeListener(listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void) { listeners.delete(listener); },
    },
    set failWrites(value: boolean) { failWrites = value; },
    get writes() { return writes; },
  };
}

test('音源は拡張子、MIME、シグネチャ、デコード可否、再生時間を検証する', async () => {
  const decode = async () => ({ duration: 0.4 });
  const valid = await prepareSoundAsset(file('notice.WAV', wavBytes()), decode);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.asset.name, 'notice.WAV');
    assert.equal(valid.asset.mimeType, 'audio/wav');
    assert.equal(valid.asset.sizeBytes, 44);
  }

  assert.deepEqual(await prepareSoundAsset(file('notice.wav', new Uint8Array(44)), decode), {
    ok: false, reason: 'unsupported-format',
  });
  assert.deepEqual(await prepareSoundAsset(file('notice.txt', wavBytes()), decode), {
    ok: false, reason: 'unsupported-format',
  });
  assert.deepEqual(await prepareSoundAsset(file('notice.wav', wavBytes(), 'audio/ogg'), decode), {
    ok: false, reason: 'unsupported-format',
  });
  assert.deepEqual(await prepareSoundAsset(file('notice.wav', wavBytes(), 'audio/wav'), async () => { throw new Error('decode'); }), {
    ok: false, reason: 'unplayable-audio',
  });
  for (const duration of [5.1, 10]) {
    const accepted = await prepareSoundAsset(file('long.wav', wavBytes(), 'audio/wav'), async () => ({ duration }));
    assert.equal(accepted.ok, true, `${duration}秒の音源を受け入れる`);
    if (accepted.ok) assert.equal(accepted.asset.durationSeconds, duration);
  }
  assert.deepEqual(await prepareSoundAsset(file('long.wav', wavBytes(), 'audio/wav'), async () => ({ duration: 10.1 })), {
    ok: false, reason: 'duration-limit',
  });
  for (const duration of [0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.deepEqual(await prepareSoundAsset(file('invalid.wav', wavBytes(), 'audio/wav'), async () => ({ duration })), {
      ok: false, reason: 'unplayable-audio',
    });
  }

  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);
  const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00]);
  assert.equal((await prepareSoundAsset(file('notice.mp3', mp3, 'audio/mpeg'), decode)).ok, true);
  assert.equal((await prepareSoundAsset(file('notice.ogg', ogg, 'audio/ogg'), decode)).ok, true);
});

test('保存音源は10秒を受け入れ、10秒超過や不正な再生時間を壊れたデータとして拒否する', async () => {
  const prepared = await prepareSoundAsset(file('notice.wav', wavBytes(), 'audio/wav'), async () => ({ duration: 10 }));
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;

  const asset = { id: 'user-00000000-0000-4000-8000-000000000001', ...prepared.asset };
  const validStorage = fakeStorage({ [SOUND_ASSETS_STORAGE_KEY]: [asset] });
  assert.deepEqual(await new SoundAssetRepository(validStorage.area).loadAssets(), { ok: true, assets: [asset] });

  for (const durationSeconds of [0, 10.1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const corruptStorage = fakeStorage({ [SOUND_ASSETS_STORAGE_KEY]: [{ ...asset, durationSeconds }] });
    assert.deepEqual(await new SoundAssetRepository(corruptStorage.area).loadAssets(), {
      ok: false, reason: 'corrupt-assets',
    });
  }
});

test('サイズ上限超過ファイルはデコード前に拒否する', async () => {
  let decodeCalls = 0;
  const oversized = await prepareSoundAsset(file('large.wav', wavBytes(MAX_SOUND_ASSET_BYTES + 1)), async () => {
    decodeCalls += 1;
    return { duration: 1 };
  });
  assert.deepEqual(oversized, { ok: false, reason: 'file-too-large' });
  assert.equal(decodeCalls, 0);
});

test('専用storage keyで追加・購読・読込・削除し、上限を守る', async () => {
  const fake = fakeStorage();
  const repository = new SoundAssetRepository(fake.area, fake.changes, { randomUUID: () => '00000000-0000-4000-8000-000000000001' });
  const prepared = await prepareSoundAsset(file('notice.wav', wavBytes()), async () => ({ duration: 0.4 }));
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const observed: number[] = [];
  const unsubscribe = repository.subscribeAssets((result) => observed.push(result.ok ? result.assets.length : -1));

  const added = await repository.addAsset(prepared.asset);
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.ok(added.asset);
  assert.equal(added.asset.id, 'user-00000000-0000-4000-8000-000000000001');
  assert.deepEqual(await repository.loadAssets(), { ok: true, assets: [added.asset] });
  assert.equal(SOUND_ASSETS_STORAGE_KEY in fake.data, true);
  assert.deepEqual(observed, [1]);

  const removed = await repository.removeAsset(added.asset.id);
  assert.deepEqual(removed, { ok: true });
  assert.deepEqual(await repository.loadAssets(), { ok: true, assets: [] });
  assert.deepEqual(observed, [1, 0]);
  unsubscribe();

  assert.equal(MAX_SOUND_ASSETS, 5);
});

test('件数と総容量を超えず、storage容量超過時は既存音源を維持する', async () => {
  const fake = fakeStorage();
  const repository = new SoundAssetRepository(fake.area, undefined, { randomUUID: (() => {
    let id = 0;
    return () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`;
  })() });
  const prepared = await prepareSoundAsset(file('notice.wav', wavBytes()), async () => ({ duration: 0.4 }));
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;

  for (let i = 0; i < MAX_SOUND_ASSETS; i += 1) assert.equal((await repository.addAsset(prepared.asset)).ok, true);
  const writesBeforeLimit = fake.writes;
  assert.deepEqual(await repository.addAsset(prepared.asset), { ok: false, reason: 'asset-limit' });
  assert.equal(fake.writes, writesBeforeLimit);

  const largeData = {
    ...prepared.asset,
    data: 'A'.repeat(Math.ceil(MAX_SOUND_ASSET_BYTES / 3) * 4),
    sizeBytes: MAX_SOUND_ASSET_BYTES,
  };
  const isolated = fakeStorage();
  let generatedId = 0;
  const capacity = new SoundAssetRepository(isolated.area, undefined, {
    randomUUID: () => `00000000-0000-4000-8000-${String(++generatedId).padStart(12, '0')}`,
  });
  assert.equal((await capacity.addAsset(largeData)).ok, true);
  assert.equal((await capacity.addAsset(largeData)).ok, true);
  const writesBeforeTotalLimit = isolated.writes;
  const tooLarge = await capacity.addAsset(largeData);
  assert.equal(tooLarge.ok, false);
  if (!tooLarge.ok) assert.equal(tooLarge.reason, 'total-size-limit');
  assert.equal(isolated.writes, writesBeforeTotalLimit);

  const quotaStorage = fakeStorage();
  const quotaRepository = new SoundAssetRepository(quotaStorage.area, undefined, { randomUUID: () => '00000000-0000-4000-8000-000000000009' });
  assert.equal((await quotaRepository.addAsset(prepared.asset)).ok, true);
  const before = structuredClone(quotaStorage.data[SOUND_ASSETS_STORAGE_KEY]);
  quotaStorage.failWrites = true;
  const failed = await quotaRepository.addAsset(prepared.asset);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.reason, 'storage-failed');
  assert.deepEqual(quotaStorage.data[SOUND_ASSETS_STORAGE_KEY], before);
});

test('storage読込失敗・壊れた専用データを検出し、修復を装った上書きをしない', async () => {
  const readFailure: SoundAssetStorageAreaLike = {
    async get() { throw new Error('read failed'); },
    async set() { throw new Error('must not write'); },
  };
  const repository = new SoundAssetRepository(readFailure);
  assert.deepEqual(await repository.loadAssets(), { ok: false, reason: 'storage-failed' });

  const corruptStorage = fakeStorage({ [SOUND_ASSETS_STORAGE_KEY]: [{ id: 'not-a-sound', data: 'x' }] });
  const corruptRepository = new SoundAssetRepository(corruptStorage.area);
  assert.deepEqual(await corruptRepository.loadAssets(), { ok: false, reason: 'corrupt-assets' });
  const result = await corruptRepository.removeAsset('not-a-sound');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'corrupt-assets');
  assert.equal(corruptStorage.writes, 0);
  assert.deepEqual(corruptStorage.data[SOUND_ASSETS_STORAGE_KEY], [{ id: 'not-a-sound', data: 'x' }]);
});
