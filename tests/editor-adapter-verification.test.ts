import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSelectionForPaste, replaceCurrentSelection } from '../src/content/editor/adapter.ts';
import type { ClipboardMetric } from '../src/content/clipboard-metrics.ts';
import { fixture } from './editor-adapter-fixture.ts';

test('input.dataがnullでも対象範囲の読み戻しで完全な挿入を確認する', () => {
  const f = fixture();
  const metrics: ClipboardMetric[] = [];
  f.commandBehavior.data = null;
  const snapshot = captureSelectionForPaste(f.environment);

  assert.deepEqual(replaceCurrentSelection('貼り付け本文', f.environment, snapshot, (metric) => metrics.push(metric)), { ok: true });
  const validation = metrics.find((metric) => metric.stage === 'validation');
  assert.equal(validation?.dataMatches, false);
  assert.equal(validation?.inputEvents?.[0]?.dataIsNull, true);
  assert.equal(validation?.inputDataCharacterCount, 0);
  assert.equal(validation?.contentMatches, true);
  assert.equal(f.text, 'original貼り付け本文');
  assert.equal(f.commands.length, 1);
  assert.equal(f.insertedNodes.length, 0);
});

test('改行・Unicodeを含む対象範囲を本文走査なしで確認する', () => {
  const text = '先頭🙂\n\n全角　空白\n末尾';
  const f = fixture();
  f.commandBehavior.data = null;

  assert.deepEqual(replaceCurrentSelection(text, f.environment), { ok: true });
  assert.equal(f.text, `original${text}`);
});

test('段落DOMでtoStringが改行境界を省いてもcloneContentsで範囲を確認する', () => {
  const f = fixture();
  f.commandBehavior.data = null;
  f.commandBehavior.rangeText = '段落前段落後';
  const textNode = (data: string) => ({ nodeType: 3, data, textContent: data, childNodes: [] });
  const paragraph = (data: string) => ({ nodeType: 1, tagName: 'P', childNodes: [textNode(data)] });
  f.commandBehavior.rangeContents = {
    nodeType: 11,
    childNodes: [paragraph('段落前'), paragraph('段落後')],
  } as unknown as DocumentFragment;
  const metrics: ClipboardMetric[] = [];

  const result = replaceCurrentSelection('段落前\n段落後', f.environment, undefined, (metric) => metrics.push(metric));
  assert.equal(metrics.find((metric) => metric.stage === 'validation')?.contentMatches, true);
  assert.deepEqual(result, { ok: true });
});

test('分割された複数inputイベントは全文順に集約し計測する', () => {
  const f = fixture();
  const text = '先頭\n中間🙂末尾';
  const metrics: ClipboardMetric[] = [];
  f.commandBehavior.events = [
    { trusted: true, inputType: 'insertText', data: '先頭\n' },
    { trusted: true, inputType: 'insertText', data: '中間🙂末尾' },
  ];

  assert.deepEqual(replaceCurrentSelection(text, f.environment, captureSelectionForPaste(f.environment), (metric) => metrics.push(metric)), { ok: true });
  const validation = metrics.find((metric) => metric.stage === 'validation');
  assert.equal(validation?.inputEventCount, 2);
  assert.deepEqual(validation?.inputEvents?.map((event) => event.inputType), ['insertText', 'insertText']);
  assert.equal(validation?.inputDataCharacterCount, text.length);
  assert.equal(validation?.dataMatches, true);
});

test('改行の段落イベントを含む複数inputも対象Rangeが一致すれば確認する', () => {
  const f = fixture();
  const metrics: ClipboardMetric[] = [];
  f.commandBehavior.events = [
    { trusted: true, inputType: 'insertText', data: '先頭' },
    { trusted: true, inputType: 'insertParagraph', data: null },
    { trusted: true, inputType: 'insertText', data: '後半🙂' },
  ];

  assert.deepEqual(replaceCurrentSelection('先頭\n後半🙂', f.environment, undefined, (metric) => metrics.push(metric)), { ok: true });
  const validation = metrics.find((metric) => metric.stage === 'validation');
  assert.equal(validation?.inputEventCount, 3);
  assert.deepEqual(validation?.inputEvents?.map((event) => event.inputType), ['insertText', 'insertParagraph', 'insertText']);
  assert.equal(validation?.inputDataCharacterCount, '先頭後半🙂'.length);
  assert.equal(validation?.dataMatches, false);
  assert.equal(validation?.contentMatches, true);
});

test('部分的なinput.dataは対象Rangeの完全読み戻しで確認する', () => {
  const f = fixture();
  f.commandBehavior.data = '先頭だけ';
  const metrics: ClipboardMetric[] = [];

  assert.deepEqual(replaceCurrentSelection('先頭だけではない本文', f.environment, captureSelectionForPaste(f.environment), (metric) => metrics.push(metric)), { ok: true });
  const validation = metrics.find((metric) => metric.stage === 'validation');
  assert.equal(validation?.dataMatches, false);
  assert.equal(validation?.inputDataCharacterCount, '先頭だけ'.length);
  assert.equal(validation?.contentMatches, true);
  assert.equal(validation?.verificationMethod, 'editor-range');
});

test('9000文字を超える挿入はdata不一致でも対象範囲を確認する', () => {
  const text = `${'日本語🙂abc\n'.repeat(920)}end`;
  const f = fixture();
  f.commandBehavior.data = null;

  assert.deepEqual(replaceCurrentSelection(text, f.environment), { ok: true });
  assert.equal(f.text, `original${text}`);
  assert.equal(f.commands.length, 1);
});

test('入力イベントなしでDOMだけ変わった場合は未確認に留める', () => {
  const f = fixture();
  const metrics: ClipboardMetric[] = [];
  f.commandBehavior.events = [];

  assert.deepEqual(replaceCurrentSelection('本文', f.environment, undefined, (metric) => metrics.push(metric)), { ok: false, reason: 'edit-unconfirmed' });
  assert.equal(metrics.find((metric) => metric.stage === 'validation')?.dataMatches, null);
  assert.equal(f.text, 'original本文');
  assert.equal(f.commands.length, 1);
});

test('成功確認でもブラウザの単一insertTextだけを使いDOM直接編集や合成入力を行わない', () => {
  const f = fixture('o', { selectionStart: 1, selectionEnd: 4 });
  const snapshot = captureSelectionForPaste(f.environment);

  assert.deepEqual(replaceCurrentSelection('置換🙂\n本文', f.environment, snapshot), { ok: true });
  assert.deepEqual(f.commands, ['insertText:置換🙂\n本文']);
  assert.equal(f.insertedNodes.length, 0);
  assert.equal(f.dispatchedInputs.length, 0);
  assert.equal(f.text, 'o置換🙂\n本文inal');
});
