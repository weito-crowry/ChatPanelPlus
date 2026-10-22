import { reportClipboardMetric, type ClipboardInputEventMetric, type ClipboardMetricReporter } from '../clipboard-metrics.ts';
import { currentCaretBelongsTo, rangeBelongsTo, readInsertionRangeText } from './text-range.ts';

export type EditFailureReason =
  | 'editor-not-found'
  | 'editor-hidden'
  | 'editor-disabled'
  | 'selection-invalid'
  | 'edit-rejected'
  | 'composer-changed'
  | 'complex-content'
  | 'ime-composing'
  | 'edit-unconfirmed'
  | 'unexpected-error';

export type EditResult = { ok: true } | { ok: false; reason: EditFailureReason };

export interface SelectionSnapshot {
  readonly editor: HTMLElement | null;
  readonly range: Range | null;
}

export interface EditorEnvironment {
  readonly document: Document;
  isVisible(editor: HTMLElement): boolean;
}

const CANDIDATE_SELECTORS = [
  '#prompt-textarea[contenteditable="true"]',
  '[data-testid="prompt-textarea"][contenteditable="true"]',
  'form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"][role="textbox"]',
  'form [contenteditable="true"][data-lexical-editor="true"][role="textbox"]',
  'form [contenteditable="true"].ProseMirror[role="textbox"]',
  'form [contenteditable="true"].ProseMirror',
] as const;

const failed = (reason: EditFailureReason): EditResult => ({ ok: false, reason });
const composingEditors = new WeakMap<Document, WeakSet<HTMLElement>>();

function browserEnvironment(): EditorEnvironment {
  return {
    document,
    isVisible(editor) {
      if (!editor.isConnected || editor.hidden || editor.getAttribute('aria-hidden') === 'true') return false;
      if (typeof editor.checkVisibility === 'function' && !editor.checkVisibility()) return false;
      return editor.getClientRects().length > 0;
    },
  };
}

export function getBrowserEditorEnvironment(): EditorEnvironment {
  return browserEnvironment();
}

function isEligible(editor: HTMLElement, environment: EditorEnvironment): boolean {
  if (!editor.isConnected || !environment.isVisible(editor)) return false;
  const form = editor.closest('form');
  if (!form || !form.contains(editor)) return false;
  if (!editor.isContentEditable || editor.getAttribute('contenteditable') === 'false') return false;
  if (editor.hasAttribute('disabled') || editor.hasAttribute('readonly')) return false;
  if (editor.getAttribute('aria-disabled') === 'true' || editor.getAttribute('aria-readonly') === 'true') return false;
  if (editor.closest('[aria-disabled="true"], [inert], fieldset:disabled')) return false;
  return true;
}

function trackComposition(environment: EditorEnvironment): void {
  if (composingEditors.has(environment.document)) return;
  const editors = new WeakSet<HTMLElement>();
  composingEditors.set(environment.document, editors);
  environment.document.addEventListener('compositionstart', (event) => {
    const editor = findActiveEditor(environment);
    const target = event.target as Node | null;
    if (editor && target && (target === editor || editor.contains(target))) editors.add(editor);
  }, true);
  environment.document.addEventListener('compositionend', (event) => {
    const editor = findActiveEditor(environment);
    const target = event.target as Node | null;
    if (editor && target && (target === editor || editor.contains(target))) editors.delete(editor);
  }, true);
}

export function isEditorComposing(environment: EditorEnvironment, editor: HTMLElement): boolean {
  trackComposition(environment);
  return composingEditors.get(environment.document)?.has(editor) ?? false;
}

export function findActiveEditor(environment: EditorEnvironment = browserEnvironment()): HTMLElement | null {
  trackComposition(environment);
  for (const selector of CANDIDATE_SELECTORS) {
    const candidates = [...environment.document.querySelectorAll<HTMLElement>(selector)]
      .filter((candidate) => isEligible(candidate, environment));
    if (candidates.length > 1) return null;
    if (candidates.length === 1) return candidates[0] ?? null;
  }
  return null;
}

function activeSelection(environment: EditorEnvironment): Selection | null {
  return environment.document.getSelection();
}

export function captureSelectionForPaste(
  environment: EditorEnvironment = browserEnvironment(),
): SelectionSnapshot {
  const editor = findActiveEditor(environment);
  const selection = activeSelection(environment);
  if (!editor || !selection?.rangeCount) return { editor, range: null };
  try {
    const range = selection.getRangeAt(0);
    return rangeBelongsTo(range, editor) ? { editor, range: range.cloneRange() } : { editor, range: null };
  } catch {
    return { editor, range: null };
  }
}

function selectRange(environment: EditorEnvironment, range: Range): void {
  const selection = activeSelection(environment);
  if (!selection) throw new Error('Selection unavailable');
  selection.removeAllRanges();
  selection.addRange(range);
}

interface SavedSelection {
  readonly selection: Selection | null;
  readonly range: Range | null;
}

function saveSelection(environment: EditorEnvironment): SavedSelection {
  const selection = activeSelection(environment);
  if (!selection?.rangeCount) return { selection, range: null };
  try {
    return { selection, range: selection.getRangeAt(0).cloneRange() };
  } catch {
    return { selection, range: null };
  }
}

function restoreSelection(saved: SavedSelection): void {
  if (!saved.selection) return;
  try {
    saved.selection.removeAllRanges();
    if (saved.range) saved.selection.addRange(saved.range);
  } catch { /* Keep the original edit failure when selection restoration is unavailable. */ }
}

interface CommandVerification {
  readonly status: 'verified' | 'unconfirmed' | 'rejected';
  readonly commandAccepted: boolean;
  readonly inputEventReceived: boolean;
  readonly inputTrusted: boolean;
  readonly inputType: string | null;
  readonly dataMatches: boolean | null;
  readonly editorChanged: boolean | null;
  readonly inputEventCount: number;
  readonly inputEvents: readonly ClipboardInputEventMetric[];
  readonly inputDataCharacterCount: number;
  readonly contentMatches: boolean | null;
  readonly postCaretMatchesEditor: boolean;
  readonly verificationMethod: 'editor-range' | 'input-events' | null;
}

function executeVerifiedCommand(
  environment: EditorEnvironment,
  editor: HTMLElement,
  command: 'insertText' | 'delete',
  value?: string,
  onMetric?: ClipboardMetricReporter,
): CommandVerification {
  let accepted = false;
  let commandThrew = false;
  const inputEvents: ClipboardInputEventMetric[] = [];
  const inputData: string[] = [];
  let inputDataCharacterCount = 0;
  let listening = false;
  let observer: MutationObserver | null = null;
  let insertionStart: Range | null = null;
  const captureInput = (event: Event) => {
    const input = event as InputEvent;
    const data = typeof input.data === 'string' ? input.data : null;
    const inputType = typeof input.inputType === 'string' ? input.inputType : null;
    inputEvents.push({
      inputType,
      trusted: input.isTrusted === true,
      targetMatchesEditor: input.target === editor || Boolean(input.target && editor.contains(input.target as Node)),
      dataIsNull: data === null,
      dataCharacterCount: data === null ? null : data.length,
    });
    if (data !== null) {
      inputData.push(data);
      inputDataCharacterCount += data.length;
    }
  };
  if (command === 'insertText') {
    try {
      const selection = activeSelection(environment);
      if (selection?.rangeCount) {
        insertionStart = selection.getRangeAt(0).cloneRange();
        insertionStart.collapse(true);
      }
      const Observer = environment.document.defaultView?.MutationObserver;
      if (Observer) {
        observer = new Observer(() => {});
        observer.observe(editor, { childList: true, characterData: true, subtree: true });
      }
    } catch {
      observer?.disconnect();
      observer = null;
    }
  }
  let commandStarted = onMetric ? performance.now() : 0;
  let commandEnded = commandStarted;
  try {
    editor.addEventListener('input', captureInput);
    listening = true;
    commandStarted = onMetric ? performance.now() : 0;
    accepted = command === 'insertText'
      ? environment.document.execCommand(command, false, value)
      : environment.document.execCommand(command);
  } catch {
    commandThrew = true;
  }
  finally {
    commandEnded = onMetric ? performance.now() : 0;
    if (listening) editor.removeEventListener('input', captureInput);
  }

  if (onMetric && command === 'insertText') {
    reportClipboardMetric(onMetric, 'command', commandStarted, () => commandEnded,
      commandThrew ? 'threw' : accepted ? 'accepted' : 'rejected', {
        strategy: 'insertText',
        commandAccepted: accepted,
        characterCount: value?.length ?? 0,
      });
  }

  const validationStarted = onMetric && command === 'insertText' ? commandEnded : 0;
  let editorChanged: boolean | null = null;
  if (observer) {
    try {
      editorChanged = observer.takeRecords().length > 0;
    } catch { /* Treat unavailable mutation readback as uncertain. */ }
    finally { observer.disconnect(); }
  }
  const inputEventCount = inputEvents.length;
  const firstInputEvent = inputEvents[0];
  const inputType = firstInputEvent?.inputType ?? null;
  const inputTrusted = inputEventCount > 0 && inputEvents.every((event) => event.trusted);
  const inputEventReceived = inputEventCount > 0;
  const dataMatches = command === 'insertText'
    ? inputEventCount === 0
      ? null
      : inputEvents.every((event) => !event.dataIsNull)
        ? inputData.join('') === (value ?? '')
        : false
    : null;

  if (command === 'delete') {
    const verified = accepted && inputTrusted && Boolean(inputType?.startsWith('delete'));
    return {
      status: verified ? 'verified' : 'rejected',
      commandAccepted: accepted,
      inputEventReceived,
      inputTrusted,
      inputType,
      dataMatches,
      editorChanged,
      inputEventCount,
      inputEvents,
      inputDataCharacterCount,
      contentMatches: null,
      postCaretMatchesEditor: false,
      verificationMethod: null,
    };
  }

  const postCaretMatchesEditor = currentCaretBelongsTo(environment.document, editor);
  const insertedText = insertionStart && postCaretMatchesEditor
    ? readInsertionRangeText(environment.document, editor, insertionStart, value ?? '')
    : null;
  const contentMatches = insertedText === null ? null : insertedText === (value ?? '');
  const allowedInputTypes = (value ?? '').includes('\n')
    ? ['insertText', 'insertParagraph', 'insertLineBreak']
    : ['insertText'];
  const eventTypesMatch = inputEventCount > 0 && inputEvents.every((event) => event.trusted
    && event.targetMatchesEditor
    && allowedInputTypes.includes(event.inputType ?? ''));
  const verificationMethod = contentMatches === true
    ? 'editor-range'
    : contentMatches === null && dataMatches === true && postCaretMatchesEditor ? 'input-events' : null;
  const contentVerified = contentMatches === true || (contentMatches === null && dataMatches === true);
  const inputMatches = inputTrusted && eventTypesMatch && postCaretMatchesEditor && contentVerified;
  const status = editorChanged === true
    ? accepted && inputMatches ? 'verified' : 'unconfirmed'
    : editorChanged === false ? 'rejected' : 'unconfirmed';
  if (onMetric) {
    reportClipboardMetric(onMetric, 'validation', validationStarted, () => performance.now(), status, {
      strategy: 'insertText',
      commandAccepted: accepted,
      inputEventReceived,
      inputTrusted,
      inputType,
      dataMatches,
      editorChanged,
      inputEventCount,
      inputEvents,
      inputDataCharacterCount,
      contentMatches,
      postCaretMatchesEditor,
      verificationMethod,
      characterCount: value?.length ?? 0,
    });
  }
  return {
    status,
    commandAccepted: accepted,
    inputEventReceived,
    inputTrusted,
    inputType,
    dataMatches,
    editorChanged,
    inputEventCount,
    inputEvents,
    inputDataCharacterCount,
    contentMatches,
    postCaretMatchesEditor,
    verificationMethod,
  };
}

function insertText(
  environment: EditorEnvironment,
  editor: HTMLElement,
  range: Range,
  text: string,
  onMetric?: ClipboardMetricReporter,
  selectionStarted = onMetric ? performance.now() : 0,
): EditResult {
  if (isEditorComposing(environment, editor)) {
    reportClipboardMetric(onMetric, 'selection', selectionStarted, () => performance.now(), 'ime-composing', { strategy: 'insertText', characterCount: text.length });
    return failed('ime-composing');
  }
  const previousSelection = saveSelection(environment);
  let selectionReported = false;
  try {
    editor.focus();
    selectRange(environment, range);
    reportClipboardMetric(onMetric, 'selection', selectionStarted, () => performance.now(), 'prepared', { strategy: 'insertText', characterCount: text.length });
    selectionReported = true;
    const verification = executeVerifiedCommand(environment, editor, 'insertText', text, onMetric);
    if (verification.status === 'verified') return { ok: true };
    if (verification.status === 'unconfirmed') return failed('edit-unconfirmed');
    restoreSelection(previousSelection);
    return failed('edit-rejected');
  } catch {
    if (!selectionReported) {
      reportClipboardMetric(onMetric, 'selection', selectionStarted, () => performance.now(), 'failed', { strategy: 'insertText', characterCount: text.length });
    }
    restoreSelection(previousSelection);
    return failed('unexpected-error');
  }
}

function boundaryNeedsNewline(editor: HTMLElement, text: string, environment: EditorEnvironment): boolean {
  if (!text || text.endsWith('\n')) return false;
  const walker = environment.document.createTreeWalker(editor, 4);
  let firstText = walker.nextNode();
  while (firstText && (firstText as Text).length === 0) firstText = walker.nextNode();
  if (!firstText) return false;
  try {
    const range = environment.document.createRange();
    range.setStart(firstText, 0);
    range.setEnd(firstText, 1);
    return range.toString() !== '\n';
  } catch {
    return false;
  }
}

export function insertAtBeginning(
  text: string,
  environment: EditorEnvironment = browserEnvironment(),
): EditResult {
  if (!text) return { ok: true };
  const editor = findActiveEditor(environment);
  if (!editor) return failed('editor-not-found');
  if (isEditorComposing(environment, editor)) return failed('ime-composing');
  try {
    const range = environment.document.createRange();
    range.selectNodeContents(editor);
    range.collapse(true);
    const insertion = text + (boundaryNeedsNewline(editor, text, environment) ? '\n' : '');
    return insertText(environment, editor, range, insertion);
  } catch {
    return failed('unexpected-error');
  }
}

export function replaceCurrentSelection(
  text: string,
  environment: EditorEnvironment = browserEnvironment(),
  snapshot: SelectionSnapshot = captureSelectionForPaste(environment),
  onMetric?: ClipboardMetricReporter,
): EditResult {
  if (!text) return { ok: true };
  const composerStarted = onMetric ? performance.now() : 0;
  const editor = findActiveEditor(environment);
  if (!editor) {
    reportClipboardMetric(onMetric, 'composer', composerStarted, () => performance.now(), 'not-found', { strategy: 'insertText', characterCount: text.length });
    return failed('editor-not-found');
  }
  if (isEditorComposing(environment, editor)) {
    reportClipboardMetric(onMetric, 'composer', composerStarted, () => performance.now(), 'ime-composing', { strategy: 'insertText', characterCount: text.length });
    return failed('ime-composing');
  }
  if (snapshot.editor !== editor) {
    reportClipboardMetric(onMetric, 'composer', composerStarted, () => performance.now(), 'changed', { strategy: 'insertText', characterCount: text.length });
    return failed('composer-changed');
  }
  reportClipboardMetric(onMetric, 'composer', composerStarted, () => performance.now(), 'ready', { strategy: 'insertText', characterCount: text.length });
  const selectionStarted = onMetric ? performance.now() : 0;
  const selection = activeSelection(environment);
  let range: Range | null = null;
  if (snapshot.range && rangeBelongsTo(snapshot.range, editor)) range = snapshot.range.cloneRange();
  if (!range && selection?.rangeCount) {
    try {
      const current = selection.getRangeAt(0);
      if (rangeBelongsTo(current, editor)) range = current.cloneRange();
    } catch { /* Fall through to the Composer end. */ }
  }
  if (!range) {
    range = environment.document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  return insertText(environment, editor, range, text.replace(/\r\n/g, '\n'), onMetric, selectionStarted);
}

export function clearComposer(environment: EditorEnvironment = browserEnvironment()): EditResult {
  const editor = findActiveEditor(environment);
  if (!editor) return failed('editor-not-found');
  if (isEditorComposing(environment, editor)) return failed('ime-composing');
  if (editor.querySelector('img, video, audio, button, input, [data-testid*="attachment"]')) {
    return failed('complex-content');
  }
  const previousSelection = saveSelection(environment);
  try {
    editor.focus();
    const range = environment.document.createRange();
    range.selectNodeContents(editor);
    selectRange(environment, range);
    if (executeVerifiedCommand(environment, editor, 'delete').status === 'verified') return { ok: true };
    restoreSelection(previousSelection);
    return failed('edit-rejected');
  } catch {
    restoreSelection(previousSelection);
    return failed('unexpected-error');
  }
}

if (typeof document !== 'undefined') trackComposition(browserEnvironment());
