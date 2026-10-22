const editor = document.querySelector('#editor');
const status = document.querySelector('#status');
const log = document.querySelector('#log');
const buttons = [...document.querySelectorAll('button')];
let savedRange = null;
let busy = false;

function captureSelection() {
  const selection = document.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return range.commonAncestorContainer === editor || editor.contains(range.commonAncestorContainer)
    ? range.cloneRange()
    : null;
}

function prepareSelection() {
  const selection = document.getSelection();
  const range = savedRange ?? captureSelection();
  if (!selection) return null;
  selection.removeAllRanges();
  if (range) selection.addRange(range);
  else {
    const end = document.createRange();
    end.selectNodeContents(editor);
    end.collapse(false);
    selection.addRange(end);
  }
  const start = selection.getRangeAt(0).cloneRange();
  start.collapse(true);
  savedRange = null;
  editor.focus();
  return start;
}

function projectText(node) {
  if (node.nodeType === 3) return node.textContent ?? '';
  const element = node.nodeType === 1 ? node : null;
  if (element?.tagName === 'BR') return '\n';
  const blockTags = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE', 'PRE']);
  const children = [...node.childNodes];
  let output = '';
  let previousBlock = false;
  children.forEach((child, index) => {
    const isBlock = child.nodeType === 1 && blockTags.has(child.tagName);
    if (index > 0 && (previousBlock || isBlock)) output += '\n';
    output += projectText(child);
    previousBlock = isBlock;
  });
  return output;
}

function insertedText(start) {
  const selection = document.getSelection();
  if (!start || !selection?.rangeCount) return null;
  try {
    const caret = selection.getRangeAt(0);
    if (!caret.collapsed || !editor.contains(caret.startContainer)) return null;
    const inserted = start.cloneRange();
    inserted.setEnd(caret.startContainer, caret.startOffset);
    return projectText(inserted.cloneContents());
  } catch {
    return null;
  }
}

function escapeHTML(text) {
  return text.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function observeEvents() {
  const events = [];
  let pasteText = null;
  const summarize = (type, event, data) => {
    events.push({
      type,
      inputType: typeof event.inputType === 'string' ? event.inputType : null,
      trusted: event.isTrusted === true,
      targetMatchesEditor: event.target === editor || editor.contains(event.target),
      dataIsNull: data === null,
      dataCharacterCount: data === null ? null : data.length,
    });
  };
  const paste = (event) => {
    let data = null;
    try { data = event.clipboardData?.getData('text/plain') ?? null; } catch { /* Log only event metadata. */ }
    if (data !== null) pasteText = data.replace(/\r\n/g, '\n');
    summarize('paste', event, data);
  };
  const beforeinput = (event) => summarize('beforeinput', event, typeof event.data === 'string' ? event.data : null);
  const input = (event) => summarize('input', event, typeof event.data === 'string' ? event.data : null);
  editor.addEventListener('paste', paste);
  editor.addEventListener('beforeinput', beforeinput);
  editor.addEventListener('input', input);
  return {
    events,
    get pasteText() { return pasteText; },
    stop() {
      editor.removeEventListener('paste', paste);
      editor.removeEventListener('beforeinput', beforeinput);
      editor.removeEventListener('input', input);
    },
  };
}

function publish(result) {
  log.textContent = JSON.stringify(result, null, 2);
  console.info('[ChatPanelPlus clipboard probe]', result);
  status.textContent = `結果: ${result.outcome}`;
}

function setBusy(next) {
  busy = next;
  buttons.forEach((button) => { button.disabled = next; });
}

function finish({ strategy, startedAt, expectedText, commandAccepted, commandStarted, commandEnded, observer, events }) {
  events.stop();
  let editorChanged = null;
  if (observer) {
    try { editorChanged = observer.takeRecords().length > 0; }
    catch { /* Treat unavailable mutation readback as unknown. */ }
    finally { observer.disconnect(); }
  }
  const actualText = insertedText(startedAt.selection);
  const comparisonText = strategy === 'execCommandPaste' ? events.pasteText : expectedText;
  const contentMatches = actualText === null || comparisonText === null ? null : actualText === comparisonText;
  const inputEvents = events.events.filter((event) => event.type === 'input');
  const trustedInput = inputEvents.length > 0 && inputEvents.every((event) => event.trusted && event.targetMatchesEditor);
  const trustedPaste = events.events.filter((event) => event.type === 'paste');
  const pasteEventTrusted = trustedPaste.length === 0 ? null : trustedPaste.every((event) => event.trusted);
  const pasteValid = strategy !== 'execCommandPaste'
    || trustedPaste.length === 1 && trustedPaste[0].trusted && trustedPaste[0].targetMatchesEditor && comparisonText !== null;
  const verified = commandAccepted && editorChanged === true && contentMatches === true && trustedInput && pasteValid;
  publish({
    strategy,
    characterCount: comparisonText?.length ?? null,
    totalMs: Math.max(0, performance.now() - startedAt.time),
    commandMs: Math.max(0, commandEnded - commandStarted),
    inputEventCount: inputEvents.length,
    trustedInput,
    contentMatches,
    commandAccepted,
    editorChanged,
    pasteEventCount: trustedPaste.length,
    pasteEventTrusted,
    beforeInputEventCount: events.events.filter((event) => event.type === 'beforeinput').length,
    events: events.events,
    outcome: verified ? 'verified' : commandAccepted ? 'unconfirmed' : 'rejected',
  });
}

function runNativePaste() {
  if (busy) return;
  setBusy(true);
  const startedAt = { time: performance.now(), selection: prepareSelection() };
  const events = observeEvents();
  const Observer = window.MutationObserver;
  const observer = Observer ? new Observer(() => {}) : null;
  observer?.observe(editor, { childList: true, characterData: true, subtree: true });
  const commandStarted = performance.now();
  let commandAccepted = false;
  try { commandAccepted = document.execCommand('paste'); } catch { /* Report as rejected. */ }
  const commandEnded = performance.now();
  finish({ strategy: 'execCommandPaste', startedAt, commandAccepted, commandStarted, commandEnded, observer, events });
  setBusy(false);
}

async function runInsertHTML() {
  if (busy) return;
  setBusy(true);
  const startedAt = { time: performance.now(), selection: prepareSelection() };
  let text;
  try { text = await navigator.clipboard.readText(); }
  catch {
    publish({ strategy: 'insertHTML', characterCount: null, totalMs: performance.now() - startedAt.time, commandMs: null, inputEventCount: 0, contentMatches: null, outcome: 'read-failed' });
    setBusy(false);
    return;
  }
  const events = observeEvents();
  const Observer = window.MutationObserver;
  const observer = Observer ? new Observer(() => {}) : null;
  observer?.observe(editor, { childList: true, characterData: true, subtree: true });
  const commandStarted = performance.now();
  let commandAccepted = false;
  try {
    commandAccepted = document.execCommand(
      'insertHTML',
      false,
      `<span style="white-space: pre-wrap;">${escapeHTML(text)}</span>`,
    );
  } catch { /* Report as rejected or unconfirmed. */ }
  const commandEnded = performance.now();
  finish({ strategy: 'insertHTML', startedAt, expectedText: text.replace(/\r\n/g, '\n'), commandAccepted, commandStarted, commandEnded, observer, events });
  setBusy(false);
}

document.querySelector('#native-paste').addEventListener('pointerdown', () => { savedRange = captureSelection(); });
document.querySelector('#insert-html').addEventListener('pointerdown', () => { savedRange = captureSelection(); });
document.querySelector('#native-paste').addEventListener('click', runNativePaste);
document.querySelector('#insert-html').addEventListener('click', () => { void runInsertHTML(); });
document.querySelector('#reset').addEventListener('click', () => {
  if (busy) return;
  editor.replaceChildren();
  editor.focus();
  status.textContent = '入力欄を空にしました。';
  log.textContent = '';
});
