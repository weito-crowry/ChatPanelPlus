import assert from 'node:assert/strict';
import test from 'node:test';
import { pasteFromClipboard, replaceCurrentSelectionWithHTML } from '../src/content/editor/experimental-insertion.ts';
import type { ClipboardMetric } from '../src/content/clipboard-metrics.ts';
import { captureSelectionForPaste, replaceCurrentSelection } from '../src/content/editor/adapter.ts';
import { fixture } from './editor-adapter-fixture.ts';

test('insertHTMLはHTMLをエスケープし、空白と改行を含む範囲を一致確認する', async () => {
  const text = 'a & <b> "quote"\n  🙂';
  const f = fixture('o', { selectionStart: 1, selectionEnd: 3 });
  f.commandBehavior.mutationText = text;
  f.commandBehavior.data = null;
  const metrics: ClipboardMetric[] = [];

  assert.deepEqual(await replaceCurrentSelectionWithHTML(
    text,
    f.environment,
    captureSelectionForPaste(f.environment),
    (metric) => metrics.push(metric),
  ), { ok: true });
  assert.equal(f.commands[0], 'insertHTML:<span style="white-space: pre-wrap;">a &amp; &lt;b&gt; &quot;quote&quot;\n  🙂</span>');
  assert.equal(f.text, `original`.slice(0, 1) + text + `original`.slice(3));
  const validation = metrics.find((metric) => metric.stage === 'validation');
  assert.equal(validation?.strategy, 'insertHTML');
  assert.equal(validation?.contentMatches, true);
  assert.equal(validation?.verificationMethod, 'editor-range');
  assert.equal(JSON.stringify(metrics).includes(text), false);
});

test('ネイティブpasteはpaste/beforeinput/inputを本文なしで記録し、本文範囲一致を確認する', async () => {
  const text = 'private paste\n🙂';
  const f = fixture();
  f.commandBehavior.pasteText = text;
  f.commandBehavior.mutationText = text;
  const metrics: ClipboardMetric[] = [];

  assert.deepEqual(await pasteFromClipboard(
    f.environment,
    captureSelectionForPaste(f.environment),
    (metric) => metrics.push(metric),
  ), { edit: { ok: true }, characterCount: text.length, contentKind: 'plain-text' });
  assert.deepEqual(f.commands, ['paste:']);
  const validation = metrics.find((metric) => metric.stage === 'validation');
  assert.equal(validation?.strategy, 'execCommandPaste');
  assert.equal(validation?.inputType, 'insertFromPaste');
  assert.equal(validation?.inputEventCount, 1);
  assert.equal(validation?.contentMatches, true);
  assert.equal(validation?.pasteEventTrusted, true);
  assert.deepEqual(validation?.observedEvents?.map(({ type }) => type), ['paste', 'beforeinput', 'input']);
  assert.equal(validation?.composerMatchesEditor, true);
  assert.equal(JSON.stringify(metrics).includes(text), false);
});

test('新旧方式でHTML風テキスト・改行・Unicode・空白を同じ内容として挿入する', async () => {
  const cases = [
    { clipboardText: '<b>literal &amp;</b>', insertedText: '<b>literal &amp;</b>' },
    { clipboardText: 'first\r\n雪🙂\nlast', insertedText: 'first\n雪🙂\nlast' },
    { clipboardText: '  leading\tspace  \n\t ', insertedText: '  leading\tspace  \n\t ' },
  ];

  for (const { clipboardText, insertedText } of cases) {
    const native = fixture('b', { nestedText: 'before selected after', selectionStart: 7, selectionEnd: 15 });
    native.commandBehavior.pasteText = clipboardText;
    native.commandBehavior.mutationText = insertedText;
    const legacy = fixture('b', { nestedText: 'before selected after', selectionStart: 7, selectionEnd: 15 });
    legacy.commandBehavior.mutationText = insertedText;

    assert.deepEqual(await pasteFromClipboard(native.environment, captureSelectionForPaste(native.environment)), {
      edit: { ok: true },
      characterCount: insertedText.length,
      contentKind: 'plain-text',
    });
    assert.deepEqual(replaceCurrentSelection(
      insertedText,
      legacy.environment,
      captureSelectionForPaste(legacy.environment),
    ), { ok: true });
    assert.equal(native.text, `before ${insertedText} after`);
    assert.equal(native.text, legacy.text);
    assert.deepEqual(native.commands, ['paste:']);
    assert.deepEqual(legacy.commands, [`insertText:${insertedText}`]);
  }
});

test('inputイベント0件でも信頼済みpasteと本文範囲の完全一致で成功にする', async () => {
  const text = '実測と同じ貼り付け本文🙂';
  const f = fixture();
  f.commandBehavior.pasteText = text;
  f.commandBehavior.mutationText = text;
  f.commandBehavior.events = [];
  const metrics: ClipboardMetric[] = [];

  assert.deepEqual(await pasteFromClipboard(
    f.environment,
    captureSelectionForPaste(f.environment),
    (metric) => metrics.push(metric),
  ), { edit: { ok: true }, characterCount: text.length, contentKind: 'plain-text' });
  const validation = metrics.find((metric) => metric.stage === 'validation');
  assert.equal(validation?.commandAccepted, true);
  assert.equal(validation?.inputEventCount, 0);
  assert.equal(validation?.inputTrusted, false);
  assert.equal(validation?.pasteEventCount, 1);
  assert.equal(validation?.pasteEventReceived, true);
  assert.equal(validation?.pasteEventTrusted, true);
  assert.equal(validation?.observedEvents?.[0]?.targetMatchesEditor, true);
  assert.equal(validation?.observedEvents?.[0]?.trusted, true);
  assert.equal(validation?.pasteTextCharacterCount, text.length);
  assert.equal(validation?.editorChanged, true);
  assert.equal(validation?.contentMatches, true);
  assert.equal(validation?.composerMatchesEditor, true);
  assert.equal(validation?.postCaretMatchesEditor, true);
  assert.equal(validation?.verificationMethod, 'editor-range');
  assert.equal(validation?.outcome, 'verified');
  assert.deepEqual(f.commands, ['paste:']);
  assert.equal(JSON.stringify(metrics).includes(text), false);
});

test('paste本文と挿入範囲が一致しない場合は成功にしない', async () => {
  const text = 'requested text';
  const f = fixture();
  f.commandBehavior.pasteText = text;
  f.commandBehavior.mutationText = 'different text';
  f.commandBehavior.events = [];
  const attempt = await pasteFromClipboard(f.environment, captureSelectionForPaste(f.environment));

  assert.deepEqual(attempt, {
    edit: { ok: false, reason: 'edit-unconfirmed' },
    characterCount: text.length,
    contentKind: 'plain-text',
  });
});

test('pasteイベントの対象がComposer外なら成功にしない', async () => {
  const text = 'paste text';
  const f = fixture();
  f.commandBehavior.pasteText = text;
  f.commandBehavior.mutationText = text;
  f.commandBehavior.pasteTargetMatches = false;
  f.commandBehavior.events = [];
  const metrics: ClipboardMetric[] = [];

  assert.equal((await pasteFromClipboard(
    f.environment,
    captureSelectionForPaste(f.environment),
    (metric) => metrics.push(metric),
  )).edit.ok, false);
  assert.equal(metrics.find((metric) => metric.stage === 'validation')?.observedEvents?.[0]?.targetMatchesEditor, false);
});

test('非信頼pasteイベントでは成功にしない', async () => {
  const text = 'paste text';
  const f = fixture();
  f.commandBehavior.pasteText = text;
  f.commandBehavior.mutationText = text;
  f.commandBehavior.trusted = false;
  f.commandBehavior.events = [];
  const metrics: ClipboardMetric[] = [];

  assert.equal((await pasteFromClipboard(
    f.environment,
    captureSelectionForPaste(f.environment),
    (metric) => metrics.push(metric),
  )).edit.ok, false);
  assert.equal(metrics.find((metric) => metric.stage === 'validation')?.pasteEventTrusted, false);
});

test('挿入範囲の全文読み戻しが不一致なら成功にしない', async () => {
  const text = 'paste text';
  const f = fixture();
  f.commandBehavior.pasteText = text;
  f.commandBehavior.mutationText = text;
  f.commandBehavior.rangeText = 'only part';
  f.commandBehavior.events = [];
  const metrics: ClipboardMetric[] = [];

  assert.equal((await pasteFromClipboard(
    f.environment,
    captureSelectionForPaste(f.environment),
    (metric) => metrics.push(metric),
  )).edit.ok, false);
  assert.equal(metrics.find((metric) => metric.stage === 'validation')?.contentMatches, false);
});

test('貼り付け中にComposerが交換された場合は成功にしない', async () => {
  const text = 'paste text';
  const f = fixture();
  f.commandBehavior.pasteText = text;
  f.commandBehavior.mutationText = text;
  f.commandBehavior.composerChanged = true;
  f.commandBehavior.events = [];

  const metrics: ClipboardMetric[] = [];
  assert.equal((await pasteFromClipboard(
    f.environment,
    captureSelectionForPaste(f.environment),
    (metric) => metrics.push(metric),
  )).edit.ok, false);
  assert.equal(metrics.find((metric) => metric.stage === 'validation')?.composerMatchesEditor, false);
});

test('pasteコマンドが拒否された場合は本文が一致しても成功にしない', async () => {
  const text = 'paste text';
  const f = fixture();
  f.commandBehavior.pasteText = text;
  f.commandBehavior.mutationText = text;
  f.commandBehavior.events = [];
  f.commandBehavior.accepted = false;

  assert.equal((await pasteFromClipboard(
    f.environment,
    captureSelectionForPaste(f.environment),
  )).edit.ok, false);
});

test('pasteコマンドが未対応で例外になり変更もなければ拒否として返す', async () => {
  const f = fixture();
  f.environment.document.execCommand = () => { throw new Error('unsupported'); };

  assert.deepEqual(await pasteFromClipboard(
    f.environment,
    captureSelectionForPaste(f.environment),
  ), { edit: { ok: false, reason: 'edit-rejected' }, contentKind: 'unknown' });
});

test('ClipboardDataを持つpasteイベントが観測できなければ本文一致にせず未確認にする', async () => {
  const text = 'private paste';
  const f = fixture();
  f.commandBehavior.emitPaste = false;
  f.commandBehavior.mutationText = text;
  const metrics: ClipboardMetric[] = [];

  const attempt = await pasteFromClipboard(
    f.environment,
    captureSelectionForPaste(f.environment),
    (metric) => metrics.push(metric),
  );
  assert.deepEqual(attempt, { edit: { ok: false, reason: 'edit-unconfirmed' }, contentKind: 'unknown' });
  const validation = metrics.find((metric) => metric.stage === 'validation');
  assert.equal(validation?.contentMatches, null);
  assert.equal(validation?.pasteEventReceived, false);
  assert.equal(f.text, `original${text}`);
  assert.deepEqual(f.commands, ['paste:']);
});

test('9,000文字を超える通常テキストを従来どおり完全一致で確認する', async () => {
  const text = 'x'.repeat(9_162);
  const f = fixture();
  f.commandBehavior.pasteText = text;
  f.commandBehavior.mutationText = text;
  f.commandBehavior.events = [];

  const attempt = await pasteFromClipboard(f.environment, captureSelectionForPaste(f.environment));

  assert.deepEqual(attempt.edit, { ok: true });
  assert.equal(attempt.characterCount, text.length);
  assert.equal(attempt.contentKind, 'plain-text');
  assert.equal(f.text, `original${text}`);
});

test('HTMLとプレーンテキストを含むリッチテキストは文字列が正規化されたら未確認にする', async () => {
  const f = fixture();
  f.commandBehavior.pasteTypes = ['text/plain', 'text/html'];
  f.commandBehavior.pasteText = 'Bold link';
  f.commandBehavior.mutationText = 'Bold link!';
  f.commandBehavior.events = [];

  const attempt = await pasteFromClipboard(f.environment, captureSelectionForPaste(f.environment));

  assert.deepEqual(attempt.edit, { ok: false, reason: 'edit-unconfirmed' });
  assert.equal(attempt.contentKind, 'rich-text');
  assert.notEqual(attempt.contentKind, 'plain-text');
});

test('HTMLとプレーンテキストが併存しても既定のpasteコマンドでブラウザへ選択を任せる', async () => {
  const text = 'Bold link';
  const f = fixture();
  f.commandBehavior.pasteTypes = ['text/plain', 'text/html'];
  f.commandBehavior.pasteText = text;
  f.commandBehavior.mutationText = text;

  const attempt = await pasteFromClipboard(f.environment, captureSelectionForPaste(f.environment));

  assert.deepEqual(attempt.edit, { ok: true });
  assert.equal(attempt.contentKind, 'rich-text');
  assert.deepEqual(f.commands, ['paste:']);
});

test('画像のみの信頼済みpasteは遅延した添付UIの追加を確認する', async () => {
  const f = fixture();
  f.commandBehavior.pasteTypes = ['Files'];
  f.commandBehavior.pasteItems = [{ kind: 'file', type: 'image/png' }];
  f.commandBehavior.pasteFiles = 1;
  f.commandBehavior.mutate = false;
  f.commandBehavior.events = [];
  f.commandBehavior.afterCommand = () => {
    globalThis.setTimeout(() => f.addAttachment(), 20);
  };
  const metrics: ClipboardMetric[] = [];

  const attempt = await pasteFromClipboard(
    f.environment,
    captureSelectionForPaste(f.environment),
    (metric) => metrics.push(metric),
  );

  assert.deepEqual(attempt.edit, { ok: true });
  assert.equal(attempt.contentKind, 'files');
  assert.equal(attempt.attachmentUiChanged, true);
  const validation = metrics.find((metric) => metric.stage === 'validation');
  assert.equal(validation?.inputEventCount, 0);
  assert.equal(validation?.contentMatches, null);
  assert.equal(validation?.attachmentUiChanged, true);
  assert.equal(f.activeObserverCount, 0);
  assert.equal(f.activeTimerCount, 0);
});

test('画像とテキストが併存する場合も添付UIを確認し、文字列一致を添付成功根拠にしない', async () => {
  const f = fixture();
  const text = 'caption';
  f.commandBehavior.pasteTypes = ['text/plain', 'Files'];
  f.commandBehavior.pasteItems = [
    { kind: 'string', type: 'text/plain' },
    { kind: 'file', type: 'image/png' },
  ];
  f.commandBehavior.pasteFiles = 1;
  f.commandBehavior.pasteText = text;
  f.commandBehavior.mutationText = text;
  f.commandBehavior.afterCommand = () => f.addAttachment();
  const metrics: ClipboardMetric[] = [];

  const attempt = await pasteFromClipboard(
    f.environment,
    captureSelectionForPaste(f.environment),
    (metric) => metrics.push(metric),
  );

  assert.deepEqual(attempt.edit, { ok: true });
  assert.equal(attempt.contentKind, 'files');
  assert.equal(attempt.attachmentUiChanged, true);
  assert.equal(metrics.find((metric) => metric.stage === 'validation')?.contentMatches, null);
});

test('画像のpaste後に添付UIが変化しなければ未確認とし監視を解除する', async () => {
  const f = fixture();
  f.commandBehavior.pasteTypes = ['Files'];
  f.commandBehavior.pasteItems = [{ kind: 'file', type: 'image/png' }];
  f.commandBehavior.pasteFiles = 1;
  f.commandBehavior.mutate = false;
  f.commandBehavior.events = [];

  const attempt = await pasteFromClipboard(f.environment, captureSelectionForPaste(f.environment));

  assert.deepEqual(attempt.edit, { ok: false, reason: 'edit-unconfirmed' });
  assert.equal(attempt.contentKind, 'files');
  assert.equal(attempt.attachmentUiChanged, false);
  assert.equal(f.activeObserverCount, 0);
  assert.equal(f.activeTimerCount, 0);
});

test('信頼性・対象・Composerを確認できない画像pasteはUIが変わっても成功にしない', async () => {
  const cases = [
    { trusted: false },
    { pasteTargetMatches: false },
    { composerChanged: true },
  ];

  for (const behavior of cases) {
    const f = fixture();
    Object.assign(f.commandBehavior, behavior, {
      pasteTypes: ['Files'],
      pasteItems: [{ kind: 'file', type: 'image/png' }],
      pasteFiles: 1,
      mutate: false,
      events: [],
      afterCommand: () => f.addAttachment(),
    });

    const attempt = await pasteFromClipboard(f.environment, captureSelectionForPaste(f.environment));

    assert.deepEqual(attempt.edit, { ok: false, reason: 'edit-unconfirmed' });
    assert.equal(attempt.contentKind, 'files');
    assert.equal(attempt.attachmentUiChanged, true);
    assert.equal(f.activeObserverCount, 0);
    assert.equal(f.activeTimerCount, 0);
  }
});
