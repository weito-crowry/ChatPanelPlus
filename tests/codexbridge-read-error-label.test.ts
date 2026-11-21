import assert from 'node:assert/strict';
import test from 'node:test';
import { codexBridgeReadErrorLabel } from '../src/content/codexbridge-read-error-label.ts';

test('旧Bridgeの実行中API未対応を更新待ちとして伝え、通常一覧を案内する', () => {
  const label = codexBridgeReadErrorLabel('running-only-unsupported');
  assert.match(label, /Bridge更新待ち/);
  assert.match(label, /通常一覧は利用できます/);
});

test('未知のエラー理由から内部情報を表示しない', () => {
  assert.equal(codexBridgeReadErrorLabel({ detail: 'private' }), 'Bridgeから不正な応答が返りました。');
});
