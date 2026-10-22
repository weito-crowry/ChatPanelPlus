import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureSelectionForPaste,
  clearComposer,
  findActiveEditor,
  insertAtBeginning,
  replaceCurrentSelection,
} from '../src/content/editor/adapter.ts';
import type { ClipboardMetric } from '../src/content/clipboard-metrics.ts';
import { fixture } from './editor-adapter-fixture.ts';

test('候補は優先順位を守り、曖昧または不可視なComposerを選ばない', () => {
  const f = fixture();
  const preferred = { ...f.editor } as HTMLElement;
  f.selectors.set('[data-testid="prompt-textarea"][contenteditable="true"]', [preferred]);
  assert.equal(findActiveEditor(f.environment), f.editor);
  f.selectors.set('#prompt-textarea[contenteditable="true"]', [f.editor, preferred]);
  assert.equal(findActiveEditor(f.environment), null);
  f.selectors.set('#prompt-textarea[contenteditable="true"]', []);
  f.environment.isVisible = () => false;
  assert.equal(findActiveEditor(f.environment), null);
  const outsideForm = fixture('o', { hasForm: false });
  assert.equal(findActiveEditor(outsideForm.environment), null);
});

test('先頭挿入は本文を再構築せず、境界改行を一つだけ補う', () => {
  const f = fixture();
  assert.deepEqual(insertAtBeginning('全文出力してください', f.environment), { ok: true });
  assert.deepEqual(f.commands, ['insertText:全文出力してください\n']);
  assert.deepEqual(insertAtBeginning('', f.environment), { ok: true });
  assert.deepEqual(f.commands, ['insertText:全文出力してください\n']);
  const newline = fixture('\n');
  assert.deepEqual(insertAtBeginning('指示', newline.environment), { ok: true });
  assert.deepEqual(newline.commands, ['insertText:指示']);
  const nestedNewline = fixture('\n', { nestedText: '\nrest' });
  assert.deepEqual(insertAtBeginning('指示', nestedNewline.environment), { ok: true });
  assert.deepEqual(nestedNewline.commands, ['insertText:指示']);
  const alreadyEnded = fixture();
  assert.deepEqual(insertAtBeginning('指示\n', alreadyEnded.environment), { ok: true });
  assert.deepEqual(alreadyEnded.commands, ['insertText:指示\n']);
});

test('Composer同一性を確認し、保存Rangeで選択を置換する', () => {
  const f = fixture();
  const snapshot = captureSelectionForPaste(f.environment);
  assert.ok(snapshot.range);
  assert.deepEqual(replaceCurrentSelection('clip', f.environment, snapshot), { ok: true });
  assert.equal(f.text, 'originalclip');
  assert.equal((snapshot.range as Range & { startOffset?: number }).startOffset, 8);
  assert.deepEqual(f.commands, ['insertText:clip']);
  const changed = { ...f.editor } as HTMLElement;
  f.selectors.set('#prompt-textarea[contenteditable="true"]', [changed]);
  assert.deepEqual(replaceCurrentSelection('clip', f.environment, snapshot), { ok: false, reason: 'composer-changed' });
  assert.deepEqual(f.commands, ['insertText:clip']);
  assert.equal(f.text, 'originalclip');
});

test('明示クリアのみ削除を実行し、コマンド拒否を失敗として返す', () => {
  const f = fixture();
  assert.deepEqual(clearComposer(f.environment), { ok: true });
  assert.deepEqual(f.commands, ['delete:']);
  assert.equal(f.text, '');
  const fallback = fixture();
  fallback.environment.document.execCommand = () => false;
  assert.deepEqual(clearComposer(fallback.environment), { ok: false, reason: 'edit-rejected' });
  assert.equal(fallback.text, 'original');
  assert.equal(fallback.dispatchedInputs.length, 0);
});

test('insertText拒否時はRangeを直接変更せず本文を保持する', () => {
  const f = fixture();
  f.environment.document.execCommand = () => false;
  assert.deepEqual(insertAtBeginning('先頭', f.environment), { ok: false, reason: 'edit-rejected' });
  assert.equal(f.insertedNodes.length, 0);
  assert.equal(f.text, 'original');
  assert.equal(f.dispatchedInputs.length, 0);
  assert.equal((f.selectionState.ranges[0] as Range & { startOffset: number }).startOffset, 8);
  const selected = fixture();
  selected.environment.document.execCommand = () => false;
  const snapshot = captureSelectionForPaste(selected.environment);
  assert.deepEqual(replaceCurrentSelection('選択置換', selected.environment, snapshot), { ok: false, reason: 'edit-rejected' });
  assert.equal(selected.insertedNodes.length, 0);
  assert.equal(selected.text, 'original');
});

test('execCommandのtrueだけでは成功にせず、false時は安全性未確認のRange編集をしない', () => {
  const unverified = fixture();
  unverified.environment.document.execCommand = () => {
    unverified.emitInput({
      isTrusted: false,
      inputType: 'insertText',
      data: '挿入',
    } as unknown as Event);
    return true;
  };
  assert.deepEqual(insertAtBeginning('挿入', unverified.environment), { ok: false, reason: 'edit-rejected' });
  assert.equal(unverified.insertedNodes.length, 0);

  const rejected = fixture();
  rejected.environment.document.execCommand = () => false;
  assert.deepEqual(insertAtBeginning('挿入', rejected.environment), { ok: false, reason: 'edit-rejected' });
  assert.equal(rejected.insertedNodes.length, 0);
  assert.equal(rejected.dispatchedInputs.length, 0);
});

test('delete拒否時にRange全削除へ進まず元のComposerを保つ', () => {
  const f = fixture();
  f.environment.document.execCommand = () => false;
  assert.deepEqual(clearComposer(f.environment), { ok: false, reason: 'edit-rejected' });
  assert.equal(f.editor.childNodes.length, 1);
  assert.equal(f.dispatchedInputs.length, 0);
});

test('空挿入・空白改行の先頭挿入・途中カーソル・選択置換で本文の残りを保持する', () => {
  const blank = fixture();
  assert.deepEqual(insertAtBeginning('', blank.environment), { ok: true });
  assert.equal(blank.commands.length, 0);
  assert.equal(blank.text, 'original');

  const emptyComposer = fixture('', { nestedText: '' });
  assert.deepEqual(insertAtBeginning('全文', emptyComposer.environment), { ok: true });
  assert.equal(emptyComposer.text, '全文');

  const spaced = fixture(' ', { nestedText: ' \n  original' });
  assert.deepEqual(insertAtBeginning('指示', spaced.environment), { ok: true });
  assert.equal(spaced.text, '指示\n \n  original');

  const middle = fixture('o', { selectionStart: 4 });
  const middleSnapshot = captureSelectionForPaste(middle.environment);
  assert.deepEqual(replaceCurrentSelection('X', middle.environment, middleSnapshot), { ok: true });
  assert.equal(middle.text, 'origXinal');

  const selected = fixture('o', { selectionStart: 1, selectionEnd: 4 });
  const selectedSnapshot = captureSelectionForPaste(selected.environment);
  assert.deepEqual(replaceCurrentSelection('XYZ', selected.environment, selectedSnapshot), { ok: true });
  assert.equal(selected.text, 'oXYZinal');
});

test('Range作成例外ではComposerを変更せず失敗する', () => {
  const f = fixture();
  f.environment.document.createRange = () => { throw new Error('range unavailable'); };
  assert.deepEqual(insertAtBeginning('x', f.environment), { ok: false, reason: 'unexpected-error' });
  assert.deepEqual(clearComposer(f.environment), { ok: false, reason: 'unexpected-error' });
  assert.equal(f.text, 'original');
  assert.equal(f.commands.length, 0);
});

test('selectRange途中でaddRangeが例外でも本文を保ち、execCommandへ進まない', () => {
  const f = fixture();
  const addRange = f.selection.addRange.bind(f.selection);
  let attempts = 0;
  f.selection.addRange = (range: Range) => {
    attempts += 1;
    if (attempts === 1) throw new Error('range rejected');
    addRange(range);
  };

  assert.deepEqual(insertAtBeginning('前置き', f.environment), { ok: false, reason: 'unexpected-error' });
  assert.equal(f.commands.length, 0);
  assert.equal(f.text, 'original');
  assert.equal((f.selectionState.ranges[0] as Range & { startOffset: number }).startOffset, 8);
});

test('Composer不在は構造化失敗になる', () => {
  const f = fixture();
  f.selectors.clear();
  assert.deepEqual(insertAtBeginning('x', f.environment), { ok: false, reason: 'editor-not-found' });
});

test('IME変換中は編集せず、compositionend後の編集は受け付ける', () => {
  const f = fixture();
  assert.equal(findActiveEditor(f.environment), f.editor);
  f.dispatch('compositionstart');
  assert.deepEqual(insertAtBeginning('x', f.environment), { ok: false, reason: 'ime-composing' });
  assert.deepEqual(replaceCurrentSelection('x', f.environment), { ok: false, reason: 'ime-composing' });
  assert.deepEqual(clearComposer(f.environment), { ok: false, reason: 'ime-composing' });
  assert.deepEqual(f.commands, []);
  f.dispatch('compositionend');
  assert.deepEqual(insertAtBeginning('x', f.environment), { ok: true });
  assert.equal(f.commands.length, 1);
});

test('変更済みならコマンド戻り値や信頼済みイベントの不一致を実際の失敗と区別する', () => {
  const scenarios = [
    { accepted: false, trusted: true, inputType: 'insertText', data: '本文', reason: 'edit-unconfirmed' },
    { accepted: true, trusted: false, inputType: 'insertText', data: '本文', reason: 'edit-unconfirmed' },
    { accepted: true, trusted: true, inputType: 'insertFromPaste', data: '本文', reason: 'edit-unconfirmed' },
    { accepted: true, trusted: true, inputType: 'insertText', data: '本文', mutationText: '別の値', reason: 'edit-unconfirmed' },
  ] as const;

  for (const scenario of scenarios) {
    const f = fixture();
    Object.assign(f.commandBehavior, scenario);
    const snapshot = captureSelectionForPaste(f.environment);
    assert.deepEqual(replaceCurrentSelection('本文', f.environment, snapshot), {
      ok: false,
      reason: scenario.reason,
    });
    assert.equal(f.text, `original${('mutationText' in scenario ? scenario.mutationText : undefined) ?? '本文'}`);
    assert.equal(f.commands.length, 1);
    if ('mutationText' in scenario) {
      const currentRange = f.selectionState.ranges.at(-1) as Range & { startOffset: number };
      assert.equal(currentRange.startOffset, 'original別の値'.length);
    }
  }
});

test('入力欄に変更がなければコマンド受付やイベント一致だけで成功にしない', () => {
  const f = fixture();
  f.commandBehavior.mutate = false;
  const snapshot = captureSelectionForPaste(f.environment);

  assert.deepEqual(replaceCurrentSelection('本文', f.environment, snapshot), {
    ok: false,
    reason: 'edit-rejected',
  });
  assert.equal(f.text, 'original');
});

test('編集計測はComposer検出・選択準備・execCommand・入力検証を本文なしで記録する', () => {
  const f = fixture();
  const metrics: ClipboardMetric[] = [];
  const privateText = 'private paste body';
  const snapshot = captureSelectionForPaste(f.environment);

  assert.deepEqual(replaceCurrentSelection(privateText, f.environment, snapshot, (metric) => metrics.push(metric)), { ok: true });
  assert.deepEqual(metrics.map(({ stage }) => stage), ['composer', 'selection', 'command', 'validation']);
  assert.ok(metrics.every(({ durationMs }) => typeof durationMs === 'number' && durationMs >= 0));
  assert.deepEqual(
    Object.fromEntries(Object.entries(metrics.at(-1) ?? {}).filter(([key]) => key !== 'startedAtMs' && key !== 'endedAtMs' && key !== 'durationMs' && key !== 'stage')),
    {
      outcome: 'verified',
      strategy: 'insertText',
      commandAccepted: true,
      inputEventReceived: true,
      inputTrusted: true,
      inputType: 'insertText',
      dataMatches: true,
      editorChanged: true,
      inputEventCount: 1,
      inputEvents: [{
        inputType: 'insertText',
        trusted: true,
        targetMatchesEditor: true,
        dataIsNull: false,
        dataCharacterCount: privateText.length,
      }],
      inputDataCharacterCount: privateText.length,
      contentMatches: true,
      postCaretMatchesEditor: true,
      verificationMethod: 'editor-range',
      characterCount: privateText.length,
    },
  );
  assert.equal(JSON.stringify(metrics).includes(privateText), false);
});
