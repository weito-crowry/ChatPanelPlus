import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClipboardPasteController,
  requiresManualPasteDialog,
  type ClipboardMetric,
  type ClipboardPasteResult,
} from '../src/content/clipboard.ts';
import { captureSelectionForPaste, replaceCurrentSelection } from '../src/content/editor/adapter.ts';
import type { EditorEnvironment } from '../src/content/editor/adapter.ts';

test('手動貼り付けダイアログは安全なテキスト代替結果だけで表示する', () => {
  assert.equal(requiresManualPasteDialog({ kind: 'manual-required', reason: 'unavailable' }), true);
  assert.equal(requiresManualPasteDialog({ kind: 'attachment-unconfirmed' }), false);
  assert.equal(requiresManualPasteDialog({ kind: 'attachment-accepted', scope: 'composer-ui' }), false);
  assert.equal(requiresManualPasteDialog({ kind: 'edit-unconfirmed', reason: 'edit-unconfirmed' }), false);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function clipboardForTypes(types: string[]) {
  return {
    types,
  } as unknown as ClipboardItem;
}

function harness(readText: () => Promise<string>, types = ['text/plain']) {
  const snapshot = { editor: null, range: null };
  const inserted: Array<{ text: string; snapshot: unknown }> = [];
  let captures = 0;
  const metrics: ClipboardMetric[] = [];
  const controller = new ClipboardPasteController({
    clipboard: { readText, read: async () => [clipboardForTypes(types)] },
    captureSelection: () => { captures += 1; return snapshot; },
    insert: (text, selection) => {
      inserted.push({ text, snapshot: selection });
      return { ok: true };
    },
    onMetric: (metric) => metrics.push(metric),
    now: () => 10,
  });
  return { controller, snapshot, inserted, metrics, get captures() { return captures; } };
}

test('成功したClipboard読取はCRLFだけLFへ変換し、保存Rangeで一度挿入する', async () => {
  const h = harness(async () => 'a\r\nb\r\n');
  const result = await h.controller.start(h.snapshot, 'insertText');
  assert.deepEqual(result, { kind: 'inserted', edit: { ok: true } });
  assert.deepEqual(h.inserted, [{ text: 'a\nb\n', snapshot: h.snapshot }]);
  assert.equal(h.captures, 0);
  assert.equal(h.controller.isBusy, false);
});

test('Clipboard拒否・空文字でテキスト形式を確認できれば手動入力を求める', async () => {
  const rejected = harness(async () => { throw new Error('permission denied'); });
  assert.deepEqual(await rejected.controller.start(rejected.snapshot, 'insertText'), { kind: 'manual-required', reason: 'read-failed' });
  assert.equal(rejected.controller.isBusy, true);
  assert.deepEqual(await rejected.controller.start(rejected.snapshot), { kind: 'busy' });
  assert.deepEqual(await rejected.controller.insertManual(' 手入力\n'), { kind: 'inserted', edit: { ok: true } });
  assert.equal(rejected.inserted[0]?.text, ' 手入力\n');
  assert.deepEqual(await rejected.controller.insertManual('duplicate'), { kind: 'busy' });

  const empty = harness(async () => '');
  assert.deepEqual(await empty.controller.start(empty.snapshot, 'insertText'), { kind: 'manual-required', reason: 'empty' });
  assert.deepEqual(await empty.controller.insertManual(''), { kind: 'cancelled' });
  assert.equal(empty.inserted.length, 0);
  assert.ok(empty.metrics.some((metric) => metric.stage === 'complete' && metric.outcome === 'cancelled'));

  const unavailable = new ClipboardPasteController({
    clipboard: undefined,
    captureSelection: () => null,
    insert: () => ({ ok: false, reason: 'editor-not-found' }),
  });
  assert.deepEqual(await unavailable.start(undefined, 'insertText'), { kind: 'edit-unconfirmed', reason: 'edit-unconfirmed' });
  assert.equal(unavailable.isBusy, false);
});

test('読取中と手動ダイアログ中の二重起動・多重挿入を拒む', async () => {
  const pending = deferred<string>();
  const h = harness(() => pending.promise);
  const first = h.controller.start(h.snapshot, 'insertText');
  assert.deepEqual(await h.controller.start(h.snapshot), { kind: 'busy' });
  pending.resolve('once');
  assert.deepEqual(await first, { kind: 'inserted', edit: { ok: true } });
  assert.equal(h.inserted.length, 1);
});

test('既定の貼り付けはexecCommandPasteを同期実行し、Clipboard読取やinsertTextへ移らない', async () => {
  let readCalls = 0;
  let pasteCalls = 0;
  let insertCalls = 0;
  const controller = new ClipboardPasteController({
    clipboard: {
      readText: async () => { readCalls += 1; return 'clipboard'; },
      read: async () => [clipboardForTypes(['text/plain'])],
    },
    captureSelection: () => null,
    insert: () => { insertCalls += 1; return { ok: true }; },
    paste: () => {
      pasteCalls += 1;
      return { edit: { ok: true }, characterCount: 9 };
    },
  });

  const operation = controller.start();
  assert.equal(pasteCalls, 1);
  assert.equal(readCalls, 0);
  assert.equal(insertCalls, 0);
  assert.deepEqual(await operation, { kind: 'inserted', edit: { ok: true } });
});

test('execCommandPasteが無変更で拒否された場合は手動入力を待ち、自動でinsertTextしない', async () => {
  let readCalls = 0;
  let metadataReads = 0;
  let pasteCalls = 0;
  let insertCalls = 0;
  const controller = new ClipboardPasteController({
    clipboard: {
      readText: async () => { readCalls += 1; return 'clipboard'; },
      read: async () => { metadataReads += 1; return [clipboardForTypes(['text/plain'])]; },
    },
    captureSelection: () => null,
    insert: (text) => { insertCalls += 1; assert.equal(text, 'manual text'); return { ok: true }; },
    paste: () => { pasteCalls += 1; return { edit: { ok: false, reason: 'edit-rejected' } }; },
  });

  assert.deepEqual(await controller.start(), { kind: 'manual-required', reason: 'unavailable' });
  assert.equal(controller.isBusy, true);
  assert.deepEqual([readCalls, metadataReads, pasteCalls, insertCalls], [0, 1, 1, 0]);
  assert.deepEqual(await controller.insertManual('manual text'), { kind: 'inserted', edit: { ok: true } });
  assert.deepEqual([readCalls, metadataReads, pasteCalls, insertCalls], [0, 1, 1, 1]);
});

test('insertHTML実験は同じClipboard本文を一度だけ渡し、未確認時にinsertTextへ戻らない', async () => {
  let htmlCalls = 0;
  let textCalls = 0;
  const metrics: ClipboardMetric[] = [];
  const controller = new ClipboardPasteController({
    clipboard: { readText: async () => 'private\nclipboard' },
    captureSelection: () => null,
    insert: () => { textCalls += 1; return { ok: true }; },
    insertHTML: (text) => {
      htmlCalls += 1;
      assert.equal(text, 'private\nclipboard');
      return { ok: false, reason: 'edit-unconfirmed' };
    },
    onMetric: (metric) => metrics.push(metric),
    now: () => 1,
  });

  assert.deepEqual(await controller.start(null, 'insertHTML'), { kind: 'edit-unconfirmed', reason: 'edit-unconfirmed' });
  assert.equal(htmlCalls, 1);
  assert.equal(textCalls, 0);
  assert.ok(metrics.every((metric) => metric.strategy === 'insertHTML'));
  assert.equal(JSON.stringify(metrics).includes('private'), false);
});

test('ネイティブ貼り付けが未確認なら読取とinsertTextへ戻らず一度で終了する', async () => {
  let readCalls = 0;
  let pasteCalls = 0;
  let insertCalls = 0;
  const controller = new ClipboardPasteController({
    clipboard: { readText: async () => { readCalls += 1; return 'private'; } },
    captureSelection: () => null,
    insert: () => { insertCalls += 1; return { ok: true }; },
    paste: () => {
      pasteCalls += 1;
      return { edit: { ok: false, reason: 'edit-unconfirmed' }, characterCount: 7 };
    },
  });

  assert.deepEqual(await controller.start(null, 'execCommandPaste'), { kind: 'edit-unconfirmed', reason: 'edit-unconfirmed' });
  assert.deepEqual([readCalls, pasteCalls, insertCalls], [0, 1, 0]);
});

test('ファイル形式のpaste結果未確認は手動テキストダイアログを開かない', async () => {
  let insertCalls = 0;
  const controller = new ClipboardPasteController({
    clipboard: {
      readText: async () => { throw new Error('unused'); },
      read: async () => [clipboardForTypes(['image/png'])],
    },
    captureSelection: () => null,
    insert: () => { insertCalls += 1; return { ok: true }; },
    paste: () => ({ edit: { ok: false, reason: 'edit-rejected' }, contentKind: 'files' }),
  });

  assert.deepEqual(await controller.start(), { kind: 'attachment-unconfirmed' });
  assert.equal(insertCalls, 0);
  assert.equal(controller.isBusy, false);
});

test('添付UIが追加されたファイルpasteはアップロード完了と区別して受け付ける', async () => {
  const controller = new ClipboardPasteController({
    clipboard: undefined,
    captureSelection: () => null,
    insert: () => ({ ok: true }),
    paste: () => ({
      edit: { ok: true },
      contentKind: 'files',
      attachmentUiChanged: true,
    }),
  });

  assert.deepEqual(await controller.start(), { kind: 'attachment-accepted', scope: 'composer-ui' });
  assert.equal(controller.isBusy, false);
});

test('HTML形式を含む未確認pasteは手動テキストダイアログへ変換しない', async () => {
  let readCalls = 0;
  const controller = new ClipboardPasteController({
    clipboard: {
      readText: async () => { throw new Error('unused'); },
      read: async () => { readCalls += 1; return [clipboardForTypes(['text/plain', 'text/html'])]; },
    },
    captureSelection: () => null,
    insert: () => ({ ok: true }),
    paste: () => ({ edit: { ok: false, reason: 'edit-rejected' }, contentKind: 'rich-text' }),
  });

  assert.deepEqual(await controller.start(), { kind: 'edit-unconfirmed', reason: 'edit-unconfirmed' });
  assert.equal(readCalls, 0);
});

test('readTextが空でClipboard形式が画像のみなら手動テキストダイアログを開かない', async () => {
  const h = harness(async () => '', ['image/png']);

  assert.deepEqual(await h.controller.start(h.snapshot, 'insertText'), { kind: 'edit-unconfirmed', reason: 'edit-unconfirmed' });
  assert.equal(h.controller.isBusy, false);
  assert.equal(h.inserted.length, 0);
});

test('Keyboard起動時にスナップショットを取得し、キャンセル後は再利用しない', async () => {
  const h = harness(async () => { throw new Error('denied'); });
  assert.deepEqual(await h.controller.start(undefined, 'insertText'), { kind: 'manual-required', reason: 'read-failed' });
  assert.equal(h.captures, 1);
  h.controller.cancel();
  assert.deepEqual(await h.controller.insertManual('stale'), { kind: 'busy' });
  assert.equal(h.inserted.length, 0);
});

test('Composer同一性の失敗を成功に変換せず、計測値に本文を含めない', async () => {
  const inserted: string[] = [];
  const metrics: ClipboardMetric[] = [];
  const controller = new ClipboardPasteController({
    clipboard: { readText: async () => 'private clipboard text' },
    captureSelection: () => ({ editor: null, range: null }),
    insert: (text) => {
      inserted.push(text);
      return { ok: false, reason: 'composer-changed' };
    },
    onMetric: (metric) => metrics.push(metric),
    now: () => 1,
  });
  const result: ClipboardPasteResult = await controller.start(undefined, 'insertText');
  assert.deepEqual(result, { kind: 'edit-failed', reason: 'composer-changed' });
  assert.deepEqual(inserted, ['private clipboard text']);
  assert.equal(metrics.some((metric) => JSON.stringify(metric).includes('private clipboard text')), false);
  assert.ok(metrics.some(({ stage }) => stage === 'click-to-read'));
  assert.ok(metrics.some(({ stage }) => stage === 'read'));
  assert.ok(metrics.some(({ stage }) => stage === 'edit'));
  assert.ok(metrics.some(({ stage }) => stage === 'complete'));
  assert.equal(controller.isBusy, false);
});

test('成功計測は読取・編集・クリック全体の境界と所要時間を分ける', async () => {
  let clock = 0;
  const metrics: ClipboardMetric[] = [];
  const controller = new ClipboardPasteController({
    clipboard: { readText: async () => { clock = 4; return 'private'; } },
    captureSelection: () => null,
    insert: () => { clock = 9; return { ok: true }; },
    onMetric: (metric) => metrics.push(metric),
    now: () => clock,
  });

  assert.deepEqual(await controller.start(undefined, 'insertText'), { kind: 'inserted', edit: { ok: true } });
  const read = metrics.find((metric) => metric.stage === 'read');
  const edit = metrics.find((metric) => metric.stage === 'edit' && metric.outcome === 'success');
  const complete = metrics.find((metric) => metric.stage === 'complete');
  assert.deepEqual([read?.startedAtMs, read?.endedAtMs, read?.durationMs, read?.outcome], [0, 4, 4, 'success']);
  assert.deepEqual([edit?.startedAtMs, edit?.endedAtMs, edit?.durationMs, edit?.outcome], [4, 9, 5, 'success']);
  assert.deepEqual([complete?.startedAtMs, complete?.endedAtMs, complete?.durationMs, complete?.outcome], [0, 9, 9, 'inserted']);
  assert.equal(JSON.stringify(metrics).includes('private'), false);
});

test('クリックから読取開始を測り、文字数だけを計測情報へ含める', async () => {
  let clock = 0;
  const metrics: ClipboardMetric[] = [];
  const controller = new ClipboardPasteController({
    clipboard: { readText: async () => { clock = 7; return 'private'; } },
    captureSelection: () => { clock = 3; return null; },
    insert: () => { clock = 12; return { ok: true }; },
    onMetric: (metric) => metrics.push(metric),
    now: () => clock,
  });

  assert.deepEqual(await controller.start(undefined, 'insertText'), { kind: 'inserted', edit: { ok: true } });
  const clickToRead = metrics.find((metric) => metric.stage === 'click-to-read');
  const read = metrics.find((metric) => metric.stage === 'read');
  assert.deepEqual([clickToRead?.startedAtMs, clickToRead?.endedAtMs, clickToRead?.durationMs], [0, 3, 3]);
  assert.deepEqual([read?.startedAtMs, read?.endedAtMs, read?.durationMs, read?.characterCount], [3, 7, 4, 7]);
  assert.equal(JSON.stringify(metrics).includes('private'), false);
});

test('変更済みで結果未確認の編集は失敗と区別し、二重挿入しない', async () => {
  const metrics: ClipboardMetric[] = [];
  let insertCalls = 0;
  const controller = new ClipboardPasteController({
    clipboard: { readText: async () => 'private clipboard text' },
    captureSelection: () => null,
    insert: () => {
      insertCalls += 1;
      return { ok: false, reason: 'edit-unconfirmed' };
    },
    onMetric: (metric) => metrics.push(metric),
    now: () => 1,
  });

  assert.deepEqual(await controller.start(undefined, 'insertText'), { kind: 'edit-unconfirmed', reason: 'edit-unconfirmed' });
  assert.equal(insertCalls, 1);
  assert.ok(metrics.some((metric) => metric.stage === 'complete' && metric.outcome === 'edit-unconfirmed'));
  assert.equal(JSON.stringify(metrics).includes('private clipboard text'), false);
});

test('手動入力計測はダイアログ待機・編集時間・取消結果を区別する', async () => {
  let clock = 0;
  const metrics: ClipboardMetric[] = [];
  const controller = new ClipboardPasteController({
    clipboard: {
      readText: async () => { clock = 2; return ''; },
      read: async () => [clipboardForTypes(['text/plain'])],
    },
    captureSelection: () => null,
    insert: () => { clock += 3; return { ok: true }; },
    onMetric: (metric) => metrics.push(metric),
    now: () => clock,
  });

  assert.deepEqual(await controller.start(undefined, 'insertText'), { kind: 'manual-required', reason: 'empty' });
  clock = 8;
  assert.deepEqual(await controller.insertManual('manual private'), { kind: 'inserted', edit: { ok: true } });
  const manual = metrics.find((metric) => metric.stage === 'manual' && metric.outcome === 'submitted');
  const edit = metrics.find((metric) => metric.stage === 'edit' && metric.outcome === 'success');
  const complete = metrics.find((metric) => metric.stage === 'complete');
  assert.deepEqual([manual?.startedAtMs, manual?.endedAtMs, manual?.durationMs], [2, 8, 6]);
  assert.deepEqual([edit?.startedAtMs, edit?.endedAtMs, edit?.durationMs], [8, 11, 3]);
  assert.deepEqual([complete?.startedAtMs, complete?.endedAtMs, complete?.durationMs, complete?.outcome], [0, 11, 11, 'inserted']);
  assert.equal(JSON.stringify(metrics).includes('manual private'), false);

  const cancelledMetrics: ClipboardMetric[] = [];
  const cancelled = new ClipboardPasteController({
    clipboard: {
      readText: async () => '',
      read: async () => [clipboardForTypes(['text/plain'])],
    },
    captureSelection: () => null,
    insert: () => ({ ok: true }),
    onMetric: (metric) => cancelledMetrics.push(metric),
    now: () => clock,
  });
  await cancelled.start(undefined, 'insertText');
  clock += 7;
  cancelled.cancel();
  assert.ok(cancelledMetrics.some((metric) => metric.stage === 'manual' && metric.outcome === 'cancelled' && metric.durationMs === 7));
  assert.ok(cancelledMetrics.some((metric) => metric.stage === 'complete' && metric.outcome === 'cancelled'));
});

test('計測コールバック未指定なら注入時計を呼ばない', async () => {
  let clockCalls = 0;
  const controller = new ClipboardPasteController({
    clipboard: undefined,
    captureSelection: () => null,
    insert: () => ({ ok: true }),
    now: () => { clockCalls += 1; return 0; },
  });

  assert.deepEqual(await controller.start(undefined, 'insertText'), { kind: 'edit-unconfirmed', reason: 'edit-unconfirmed' });
  assert.equal(clockCalls, 0);
});

test('Clipboard読取待機中のComposer再生成ではAdapterが新Composerへの挿入を中止する', async () => {
  const pending = deferred<string>();
  const makeEditor = () => {
    const form = { contains: (element: Element) => element === editor };
    const editor = {
      isConnected: true,
      isContentEditable: true,
      getAttribute: () => null,
      hasAttribute: () => false,
      closest: (selector: string) => selector === 'form' ? form : null,
    } as unknown as HTMLElement;
    return editor;
  };
  const oldEditor = makeEditor();
  const newEditor = makeEditor();
  let activeEditor = oldEditor;
  let insertCalls = 0;
  const selection = { rangeCount: 0 } as unknown as Selection;
  const environment = {
    document: {
      querySelectorAll: () => [activeEditor],
      getSelection: () => selection,
      addEventListener() {},
    } as unknown as Document,
    isVisible: () => true,
  } as EditorEnvironment;
  const controller = new ClipboardPasteController({
    clipboard: { readText: () => pending.promise },
    captureSelection: () => captureSelectionForPaste(environment),
    insert: (text, snapshot) => {
      insertCalls += 1;
      return replaceCurrentSelection(text, environment, snapshot!);
    },
  });
  const operation = controller.start(undefined, 'insertText');
  activeEditor = newEditor;
  pending.resolve('do not move this');
  assert.deepEqual(await operation, { kind: 'edit-failed', reason: 'composer-changed' });
  assert.equal(insertCalls, 1);
});
