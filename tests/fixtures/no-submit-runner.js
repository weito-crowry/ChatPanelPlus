/* global URLSearchParams, location, document, performance, setTimeout, window, HTMLButtonElement, history */

const params = new URLSearchParams(location.search);
if (params.get('cppRunNoSubmitTests') === '1') {
  const output = document.querySelector('#fixture-result');
  const checks = [];
  const wait = (condition, label) => new Promise((resolve, reject) => {
    const deadline = performance.now() + 3000;
    const poll = () => {
      if (condition()) resolve();
      else if (performance.now() >= deadline) reject(new Error(`${label}: timeout`));
      else setTimeout(poll, 10);
    };
    poll();
  });
  const editor = document.querySelector('#prompt-textarea');
  const fixture = window.cppNoSubmitFixture;
  const panel = document.querySelector('#chatpanelplus-extension-root');

  function record(name, passed) {
    checks.push({ name, passed });
    render();
    if (!passed) throw new Error(`FAIL: ${name}`);
  }

  function render() {
    const snapshot = fixture.snapshot();
    output.textContent = JSON.stringify({ checks, ...snapshot });
  }

  function resetEvents() {
    document.querySelector('#reset-events').click();
  }

  function setEditor(text, start = text.length, end = start) {
    editor.replaceChildren(document.createTextNode(text));
    const range = document.createRange();
    const textNode = editor.firstChild;
    if (textNode) {
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
    } else {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function extensionButton(id) {
    const button = panel.shadowRoot.querySelector(`[data-button-id="${id}"]`);
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing panel button: ${id}`);
    return button;
  }

  async function paste(text) {
    fixture.setClipboardText(text);
    extensionButton('paste-btn').click();
    await wait(() => editor.textContent.includes(text), 'paste insertion');
  }

  async function run() {
    await wait(() => panel?.shadowRoot?.querySelector('[data-button-id="clear-btn"]'), 'panel mount');
    history.replaceState(null, '', '?cppDebugClipboard=1&cppDebugPaste=insertText&cppDebugInteraction=1&cppRunNoSubmitTests=1');

    const buttons = [...panel.shadowRoot.querySelectorAll('button')];
    record('Panelボタンはすべてtype=buttonでフォームに所属しない',
      buttons.length > 0 && buttons.every((button) => button.type === 'button' && button.form === null));

    resetEvents();
    const outsideAction = document.querySelector('#outside-action');
    const insideAction = document.querySelector('#inside-action');
    outsideAction.click();
    insideAction.click();
    record('フォーム内外のtype=button操作でsubmitしない',
      fixture.snapshot().submitCount === 0 && outsideAction.form === null && insideAction.form === document.querySelector('#composer-form'));

    resetEvents();
    setEditor('既存の下書き');
    extensionButton('clear-btn').click();
    await wait(() => editor.textContent === '', 'clear command');
    record('クリア単独でsubmitせずComposerへフォーカスを戻す',
      fixture.snapshot().submitCount === 0 && document.activeElement === editor);

    resetEvents();
    setEditor('left TARGET right', 5, 11);
    await paste('paste-only');
    const selection = document.getSelection();
    record('コピペ単独で既存選択だけを置換しsubmitしない',
      editor.textContent === 'left paste-only right' && fixture.snapshot().submitCount === 0
        && document.activeElement === editor && selection.rangeCount === 1
        && selection.getRangeAt(0).collapsed && editor.contains(selection.anchorNode));

    resetEvents();
    extensionButton('clear-btn').click();
    await wait(() => editor.textContent === '', 'paste then clear');
    record('コピペ後のクリアでもsubmitしない', fixture.snapshot().submitCount === 0);

    resetEvents();
    setEditor('draft before clear');
    extensionButton('clear-btn').click();
    await wait(() => editor.textContent === '', 'clear before paste');
    await paste('paste-after-clear');
    record('クリア後のコピペでもsubmitしない',
      editor.textContent === 'paste-after-clear' && fixture.snapshot().submitCount === 0);

    resetEvents();
    setEditor('rapid draft');
    fixture.setClipboardText('rapid paste');
    extensionButton('paste-btn').click();
    extensionButton('clear-btn').click();
    await wait(() => editor.textContent.includes('rapid paste'), 'rapid paste and clear');
    extensionButton('clear-btn').click();
    await wait(() => editor.textContent === '', 'rapid alternating clear');
    record('短時間のコピペ・クリア交互操作でsubmitしない', fixture.snapshot().submitCount === 0);

    resetEvents();
    setEditor('long draft');
    const longText = 'x'.repeat(12000);
    await paste(longText);
    extensionButton('clear-btn').click();
    await wait(() => editor.textContent === '', 'long paste then clear');
    record('長文コピペ直後のクリアでsubmitしない', fixture.snapshot().submitCount === 0);

    resetEvents();
    history.replaceState(null, '', '?cppDebugClipboard=1&cppDebugPaste=execCommandPaste&cppDebugInteraction=1&cppRunNoSubmitTests=1');
    fixture.setClipboardText('fast paste probe');
    extensionButton('paste-btn').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    record('execCommandPaste経路でsubmitイベントを発生させない', fixture.snapshot().submitCount === 0);

    resetEvents();
    document.querySelector('#normal-submit').click();
    const manualSend = fixture.snapshot();
    record('通常の手動送信submitは拡張により抑止されない',
      manualSend.submitCount === 1 && manualSend.defaultPreventedAtForm[0] === false);
    render();
  }

  run().catch((error) => {
    checks.push({ name: 'fixture実行', passed: false, error: error.message });
    render();
  });
}
