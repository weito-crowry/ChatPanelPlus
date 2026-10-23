import assert from 'node:assert/strict';
import test from 'node:test';
import { PROJECT_NAMES_STORAGE_KEY, ProjectNamesRepository } from '../src/shared/project-names-repository.ts';
import { PROJECT_ALPHA_ID, PROJECT_BETA_ID } from './project-dom-fixture.ts';

class FakeStorage {
  readonly data: Record<string, unknown>;
  constructor(data: Record<string, unknown> = {}) { this.data = data; }
  async get(keys: string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.filter((key) => key in this.data).map((key) => [key, this.data[key]]));
  }
  async set(items: Record<string, unknown>): Promise<void> { Object.assign(this.data, items); }
}

test('Project名を独立キーに保存し同じIDの名称変更と別IDの名称を保持する', async () => {
  const storage = new FakeStorage({ [PROJECT_NAMES_STORAGE_KEY]: { [PROJECT_BETA_ID]: 'Beta' } });
  const repository = new ProjectNamesRepository(storage);

  assert.deepEqual(await repository.saveName(PROJECT_ALPHA_ID, 'Alpha'), { ok: true });
  assert.deepEqual(await repository.saveName(PROJECT_ALPHA_ID, 'Alpha更新'), { ok: true });
  assert.deepEqual(storage.data[PROJECT_NAMES_STORAGE_KEY], {
    [PROJECT_ALPHA_ID]: 'Alpha更新', [PROJECT_BETA_ID]: 'Beta',
  });
});

test('旧URL slug付きIDのキャッシュをcanonical IDへ移行して再利用する', async () => {
  const legacyId = `${PROJECT_ALPHA_ID}-example-project`;
  const storage = new FakeStorage({
    [PROJECT_NAMES_STORAGE_KEY]: { [legacyId]: 'ExampleProject', [PROJECT_BETA_ID]: 'Beta' },
  });
  const repository = new ProjectNamesRepository(storage);

  assert.deepEqual(await repository.loadNames(), {
    ok: true,
    names: { [PROJECT_ALPHA_ID]: 'ExampleProject', [PROJECT_BETA_ID]: 'Beta' },
  });
  assert.deepEqual(storage.data[PROJECT_NAMES_STORAGE_KEY], {
    [PROJECT_ALPHA_ID]: 'ExampleProject', [PROJECT_BETA_ID]: 'Beta',
  });
});

test('canonical IDの既存名をslug付きlegacy keyより優先する', async () => {
  const legacyId = `${PROJECT_ALPHA_ID}-oldname`;
  const storage = new FakeStorage({
    [PROJECT_NAMES_STORAGE_KEY]: {
      [legacyId]: '古い名前',
      [PROJECT_ALPHA_ID]: '現在名',
    },
  });
  const repository = new ProjectNamesRepository(storage);

  assert.deepEqual(await repository.loadNames(), {
    ok: true,
    names: { [PROJECT_ALPHA_ID]: '現在名' },
  });
  assert.deepEqual(storage.data[PROJECT_NAMES_STORAGE_KEY], {
    [PROJECT_ALPHA_ID]: '現在名',
  });
});

test('異なるlegacy slug名は推測表示せず保持しDOM確定名の保存時に置き換える', async () => {
  const storage = new FakeStorage({
    [PROJECT_NAMES_STORAGE_KEY]: {
      [`${PROJECT_ALPHA_ID}-oldname`]: '旧名称',
      [`${PROJECT_ALPHA_ID}-newname`]: '別の旧名称',
      [PROJECT_BETA_ID]: 'Beta',
    },
  });
  const repository = new ProjectNamesRepository(storage);

  assert.deepEqual(await repository.loadNames(), {
    ok: true,
    names: { [PROJECT_BETA_ID]: 'Beta' },
  });
  assert.equal(Object.keys(storage.data[PROJECT_NAMES_STORAGE_KEY] as object).length, 3);

  assert.deepEqual(await repository.saveName(PROJECT_ALPHA_ID, '現在のDOM名'), { ok: true });
  assert.deepEqual(storage.data[PROJECT_NAMES_STORAGE_KEY], {
    [PROJECT_BETA_ID]: 'Beta',
    [PROJECT_ALPHA_ID]: '現在のDOM名',
  });
});

test('破損したキャッシュは読み込み・保存で上書きしない', async () => {
  const invalid = ['not a project map'];
  const storage = new FakeStorage({ [PROJECT_NAMES_STORAGE_KEY]: invalid });
  const repository = new ProjectNamesRepository(storage);

  assert.deepEqual(await repository.loadNames(), { ok: false, reason: 'corrupt-data' });
  assert.deepEqual(await repository.saveName(PROJECT_ALPHA_ID, 'Alpha'), { ok: false, reason: 'corrupt-data' });
  assert.equal(storage.data[PROJECT_NAMES_STORAGE_KEY], invalid);
});

test('不正ID・空のProject名はキャッシュに書き込まない', async () => {
  const storage = new FakeStorage();
  const repository = new ProjectNamesRepository(storage);

  assert.deepEqual(await repository.saveName('custom-gpt', 'GPT名'), { ok: false, reason: 'invalid-entry' });
  assert.deepEqual(await repository.saveName(PROJECT_ALPHA_ID, '  '), { ok: false, reason: 'invalid-entry' });
  assert.deepEqual(storage.data, {});
});
