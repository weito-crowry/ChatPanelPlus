import assert from 'node:assert/strict';
import test from 'node:test';
import { debugPasteStrategy } from '../src/content/clipboard-debug.ts';

test('通常は高速貼り付けを選び、デバッグ指定時だけ挿入方式を切り替える', () => {
  assert.equal(debugPasteStrategy(''), 'execCommandPaste');
  assert.equal(debugPasteStrategy('?cppDebugPaste=insertHTML'), 'execCommandPaste');
  assert.equal(debugPasteStrategy('?cppDebugClipboard=1'), 'insertText');
  assert.equal(debugPasteStrategy('?cppDebugClipboard=1&cppDebugPaste=insertText'), 'insertText');
  assert.equal(debugPasteStrategy('?cppDebugClipboard=1&cppDebugPaste=insertHTML'), 'insertHTML');
  assert.equal(debugPasteStrategy('?cppDebugClipboard=1&cppDebugPaste=execCommandPaste'), 'execCommandPaste');
  assert.equal(debugPasteStrategy('?cppDebugClipboard=1&cppDebugPaste=unknown'), 'insertText');
});
