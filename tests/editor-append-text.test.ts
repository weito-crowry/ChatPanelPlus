import assert from 'node:assert/strict';
import test from 'node:test';
import { isEditorComposing } from '../src/content/editor/adapter.ts';
import { appendTextAtEnd } from '../src/content/editor/append-text.ts';
import { fixture } from './editor-adapter-fixture.ts';

test('空欄には最終回答の生テキストだけを末尾挿入する', () => {
  const f = fixture('o', { nestedText: '' });
  assert.deepEqual(appendTextAtEnd('answer\r\nraw', f.environment), { ok: true });
  assert.deepEqual(f.commands, ['insertText:answer\r\nraw']);
  assert.equal(f.text, 'answer\r\nraw');
});

test('既存下書きの末尾に改行付きで追記し、選択範囲を置換・移動しない', () => {
  const f = fixture('o', { selectionStart: 1, selectionEnd: 4 });
  assert.deepEqual(appendTextAtEnd('final answer', f.environment), { ok: true });
  assert.equal(f.text, 'original\nfinal answer');
  assert.deepEqual(f.commands, ['insertText:\nfinal answer']);
  const restored = f.selectionState.ranges[0] as Range & { startOffset: number; endOffset: number };
  assert.equal(restored.startOffset, 1);
  assert.equal(restored.endOffset, 4);
});

test('既存末尾または回答先頭の改行を重ねず、送信操作を呼ばない', () => {
  const existingNewline = fixture('o', { nestedText: 'draft\n' });
  assert.deepEqual(appendTextAtEnd('answer', existingNewline.environment), { ok: true });
  assert.deepEqual(existingNewline.commands, ['insertText:answer']);
  const answerNewline = fixture();
  assert.deepEqual(appendTextAtEnd('\nanswer', answerNewline.environment), { ok: true });
  assert.deepEqual(answerNewline.commands, ['insertText:\nanswer']);
  assert.ok([...existingNewline.commands, ...answerNewline.commands].every((command) => command.startsWith('insertText:')));
});

test('IME中・添付等を含む複雑なcomposerでは変更しない', () => {
  const composing = fixture();
  isEditorComposing(composing.environment, composing.editor);
  composing.dispatch('compositionstart');
  assert.deepEqual(appendTextAtEnd('answer', composing.environment), { ok: false, reason: 'ime-composing' });
  assert.equal(composing.text, 'original');

  const attachment = fixture();
  attachment.addAttachment();
  assert.deepEqual(appendTextAtEnd('answer', attachment.environment), { ok: false, reason: 'complex-content' });
  assert.equal(attachment.text, 'original');
  assert.deepEqual(attachment.commands, []);
});

test('入力欄なし・編集不能では追記しない', () => {
  const absent = fixture();
  absent.selectors.set('#prompt-textarea[contenteditable="true"]', []);
  assert.deepEqual(appendTextAtEnd('answer', absent.environment), { ok: false, reason: 'editor-not-found' });
  const disabled = fixture();
  (disabled.editor as unknown as { isContentEditable: boolean }).isContentEditable = false;
  assert.deepEqual(appendTextAtEnd('answer', disabled.environment), { ok: false, reason: 'editor-not-found' });
  assert.deepEqual(disabled.commands, []);
});
