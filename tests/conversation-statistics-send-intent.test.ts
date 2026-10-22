import assert from 'node:assert/strict';
import test from 'node:test';
import { createStatisticsStore, mergeConversationStatistics } from '../src/shared/conversation-statistics.ts';
import { isComposerSendButton } from '../src/content/conversation-statistics-send-intent.ts';
import { FakeElement, FakeMutationObserver, dispatchKeyDown, harness, settle, turn } from './conversation-statistics-controller-fixture.ts';

for (const source of ['Enter', 'button'] as const) {
  test(`新規会話の${source}送信はConversation ID確定後に1 Turnとして計測する`, async () => {
    const h = harness('/');
    h.controller.start();
    await settle();

    let button: FakeElement | undefined;
    if (source === 'Enter') {
      assert.equal(dispatchKeyDown(h.document.editor).defaultPrevented, false);
    } else {
      button = new FakeElement('button', { type: 'button', 'data-testid': 'send-button' });
      h.document.form.append(button);
      assert.equal(button.dispatchEvent(new Event('click', { bubbles: true, cancelable: true })), true);
    }
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    if (button) Object.defineProperty(submit, 'submitter', { value: button });
    assert.equal(h.document.form.dispatchEvent(submit), true);
    assert.equal(submit.defaultPrevented, false);

    const first = turn(`first-${source}`, 'hello', 'answer', `answer-${source}`);
    h.document.root.append(first);
    h.window.location.pathname = `/c/new-${source}`;
    h.window.dispatchEvent(new Event('popstate'));
    await settle();

    assert.deepEqual(h.latestState()?.aggregate, {
      turns: 1, inputChars: 5, outputChars: 6, totalChars: 11, partial: false,
    });
    h.controller.stop();
  });
}

test('ネイティブsubmitなしのEnter送信では初回INPUTが欠落しOUTPUTだけが残る', async () => {
  const h = harness('/'); h.controller.start(); await settle();
  let submitCount = 0;
  h.document.addEventListener('submit', () => { submitCount += 1; }, true);
  const enter = dispatchKeyDown(h.document.editor);
  assert.equal(enter.defaultPrevented, false); assert.equal(submitCount, 0); assert.equal(h.latestState()?.aggregate.turns, 0);

  h.window.location.pathname = '/c/enter-no-native-submit';
  const first = turn('enter-first-turn', 'テスト1', '', 'enter-first-answer', 'in_progress');
  h.document.root.append(first); h.window.dispatchEvent(new Event('popstate')); await settle();
  first.querySelectorAll('[data-talvt-turn-state]')[0]!.attributes['data-talvt-turn-state'] = 'complete';
  first.querySelectorAll('[data-dil-message-id]')[0]!.append(new FakeElement('span', {}, '回答です'));
  FakeMutationObserver.latest?.notify(first, first); await settle();

  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 1, inputChars: 4, outputChars: 4, totalChars: 8, partial: false,
  });
  for (const [target, options] of [
    [h.document.editor, { shiftKey: true }], [h.document.editor, { isComposing: true, keyCode: 229 }], [h.document.root, {}],
  ] as const) assert.equal(dispatchKeyDown(target, options).defaultPrevented, false);
  const unrelated = turn('unrelated-turn', '履歴の質問', '履歴の回答', 'unrelated-answer');
  h.document.root.append(unrelated); FakeMutationObserver.latest?.notify(h.document.root, unrelated); await settle();
  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 1, inputChars: 4, outputChars: 4, totalChars: 8, partial: false,
  });
  h.controller.stop();
});

test('send click後にComposer formと不一致のsubmitが発火しても既存会話の追加Turnを集計する', async () => {
  const store = mergeConversationStatistics(createStatisticsStore(), 'click-conversation', ['old-turn'], [
    { turnKey: 'old-turn', inputChars: 4, assistantMessageId: 'old-answer', outputChars: 5 },
  ], 'manual');
  const h = harness('/c/click-conversation', false, store);
  h.document.root.append(turn('old-turn', '質問', '回答', 'old-answer')); h.controller.start(); await settle();
  const button = new FakeElement('button', { type: 'button', 'data-testid': 'send-button' });
  h.document.form.append(button);
  let submitCount = 0;
  let submitTargetIsComposerForm = true;
  h.document.addEventListener('submit', (event) => {
    submitCount += 1;
    submitTargetIsComposerForm = event.target === h.document.form;
  }, true);
  assert.equal(button.dispatchEvent(new Event('click', { bubbles: true, cancelable: true })), true);
  const mismatchedForm = new FakeElement('form');
  h.document.root.append(mismatchedForm);
  const nativeSubmit = new Event('submit', { bubbles: true, cancelable: true });
  Object.defineProperty(nativeSubmit, 'submitter', { value: button });
  assert.equal(mismatchedForm.dispatchEvent(nativeSubmit), true);
  assert.equal(submitCount, 1); assert.equal(submitTargetIsComposerForm, false);

  const next = turn('click-next-turn', 'テスト2', '回答', 'click-next-answer');
  h.document.root.append(next); FakeMutationObserver.latest?.notify(h.document.root, next); await settle();
  assert.deepEqual(h.latestState()?.aggregate, {
    turns: 2, inputChars: 8, outputChars: 7, totalChars: 15, partial: true,
  });
  h.controller.stop();
});

test('同名の無関係なボタンは除外し、form関連付けされたComposer外ボタンは認識する', () => {
  const h = harness('/c/send-button-association');
  const unrelated = new FakeElement('button', { type: 'button', 'data-testid': 'send-button' });
  h.document.root.append(unrelated);

  assert.equal(isComposerSendButton(unrelated as unknown as EventTarget, h.document as unknown as Document), false);

  h.document.form.attributes.id = 'composer-form';
  const externalComposerButton = new FakeElement('button', {
    type: 'button',
    'data-testid': 'send-button',
    form: 'composer-form',
  });
  h.document.root.append(externalComposerButton);

  assert.equal(isComposerSendButton(externalComposerButton as unknown as EventTarget, h.document as unknown as Document), true);
});

test('button.formプロパティがComposer formを参照する外部send-buttonを認識する', () => {
  const h = harness('/c/send-button-form-property');
  const form = h.document.form;
  form.attributes.id = 'composer-form';
  const externalComposerButton = new FakeElement('button', {
    type: 'button',
    'data-testid': 'send-button',
  });
  // FakeElementにはブラウザのform owner計算がない。読み取り専用のformプロパティをスタブし、
  // 実DOMで独立したマークアップ経路が存在するという主張ではなく、判定の当該分岐を単独検証する。
  Object.defineProperty(externalComposerButton, 'form', { get: () => form });
  h.document.root.append(externalComposerButton);

  assert.equal(form.contains(externalComposerButton), false);
  assert.equal(externalComposerButton.getAttribute('form'), null);
  assert.equal((externalComposerButton as unknown as HTMLButtonElement).form, form);
  assert.equal(isComposerSendButton(externalComposerButton as unknown as EventTarget, h.document as unknown as Document), true);
});
