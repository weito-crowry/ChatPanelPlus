import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginSavedDataRefresh,
  finishSavedDataRefresh,
  initialSavedDataRefreshState,
  isSavedDataDeletionAllowed,
  noteSavedDataChanged,
} from '../options/src/saved-data-refresh-state.ts';

test('初回の保存データ読込失敗は削除を許可しない', () => {
  const request = beginSavedDataRefresh(initialSavedDataRefreshState);
  const result = finishSavedDataRefresh(request.state, request.generation, request.changeGenerationAtStart, false);
  assert.equal(result.outcome, 'failed');
  assert.equal(result.state.loaded, false);
  assert.equal(result.state.stale, true);
  assert.equal(isSavedDataDeletionAllowed(result.state), false);
});

test('正常読込後の再読込失敗は古い選択対象を削除可能にしない', () => {
  const first = beginSavedDataRefresh(initialSavedDataRefreshState);
  const loaded = finishSavedDataRefresh(first.state, first.generation, first.changeGenerationAtStart, true).state;
  assert.equal(isSavedDataDeletionAllowed(loaded), true);

  const reload = beginSavedDataRefresh(loaded);
  const failed = finishSavedDataRefresh(reload.state, reload.generation, reload.changeGenerationAtStart, false);
  assert.equal(failed.state.loaded, true);
  assert.equal(failed.state.stale, true);
  assert.equal(isSavedDataDeletionAllowed(failed.state), false);
});

test('失敗後は新しい成功読込でのみ削除を再開する', () => {
  const first = beginSavedDataRefresh(initialSavedDataRefreshState);
  const failed = finishSavedDataRefresh(first.state, first.generation, first.changeGenerationAtStart, false).state;
  assert.equal(isSavedDataDeletionAllowed(failed), false);

  const retry = beginSavedDataRefresh(failed);
  const loaded = finishSavedDataRefresh(retry.state, retry.generation, retry.changeGenerationAtStart, true);
  assert.equal(loaded.outcome, 'fresh');
  assert.equal(loaded.state.stale, false);
  assert.equal(isSavedDataDeletionAllowed(loaded.state), true);
});

test('より新しい成功が終わった後の古い失敗は世代判定で無視する', () => {
  const older = beginSavedDataRefresh(initialSavedDataRefreshState);
  const newer = beginSavedDataRefresh(older.state);
  const loaded = finishSavedDataRefresh(newer.state, newer.generation, newer.changeGenerationAtStart, true).state;
  const ignored = finishSavedDataRefresh(loaded, older.generation, older.changeGenerationAtStart, false);
  assert.equal(ignored.outcome, 'superseded');
  assert.equal(ignored.state, loaded);
  assert.equal(isSavedDataDeletionAllowed(ignored.state), true);
});

test('読込中と保存変更と同時進行した読込では削除できない', () => {
  const request = beginSavedDataRefresh(initialSavedDataRefreshState);
  assert.equal(isSavedDataDeletionAllowed(request.state), false);

  const changed = noteSavedDataChanged(request.state);
  const completed = finishSavedDataRefresh(changed, request.generation, request.changeGenerationAtStart, true);
  assert.equal(completed.outcome, 'changed-during-read');
  assert.equal(completed.state.stale, true);
  assert.equal(isSavedDataDeletionAllowed(completed.state), false);
});
