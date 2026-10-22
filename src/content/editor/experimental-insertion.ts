import {
  captureSelectionForPaste,
  findActiveEditor,
  getBrowserEditorEnvironment,
  isEditorComposing,
  type EditFailureReason,
  type EditResult,
  type EditorEnvironment,
  type SelectionSnapshot,
} from './adapter.ts';
import {
  currentCaretBelongsTo,
  rangeBelongsTo,
  readInsertionRangeText,
} from './text-range.ts';
import {
  reportClipboardMetric,
  type ClipboardContentKind,
  type ClipboardInputEventMetric,
  type ClipboardMetricReporter,
  type ClipboardObservedEventMetric,
  type ClipboardPasteStrategy,
} from '../clipboard-metrics.ts';
import { classifyClipboardContent } from '../clipboard-content.ts';
import { attachmentUiChanged, captureAttachmentUi, waitForAttachmentUi } from './attachment-ui.ts';

type ExperimentalCommand = 'insertHTML' | 'paste';

interface ExperimentalEditAttempt {
  readonly edit: EditResult;
  readonly characterCount?: number;
  readonly contentKind?: ClipboardContentKind;
  readonly attachmentUiChanged?: boolean;
}

interface ExperimentalCommandResult extends ExperimentalEditAttempt {
  readonly status: 'verified' | 'unconfirmed' | 'rejected';
}

interface SavedSelection {
  readonly selection: Selection | null;
  readonly range: Range | null;
}

const failed = (reason: EditFailureReason): EditResult => ({ ok: false, reason });

function saveSelection(environment: EditorEnvironment): SavedSelection {
  const selection = environment.document.getSelection();
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

function selectRange(environment: EditorEnvironment, range: Range): void {
  const selection = environment.document.getSelection();
  if (!selection) throw new Error('Selection unavailable');
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertionRange(
  environment: EditorEnvironment,
  editor: HTMLElement,
  snapshot: SelectionSnapshot,
): Range {
  if (snapshot.range && rangeBelongsTo(snapshot.range, editor)) return snapshot.range.cloneRange();
  const selection = environment.document.getSelection();
  if (selection?.rangeCount) {
    try {
      const current = selection.getRangeAt(0);
      if (rangeBelongsTo(current, editor)) return current.cloneRange();
    } catch { /* Fall through to the Composer end. */ }
  }
  const range = environment.document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  return range;
}

function escapeHTML(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function insertionHTML(text: string): string {
  return `<span style="white-space: pre-wrap;">${escapeHTML(text)}</span>`;
}

function metric(
  onMetric: ClipboardMetricReporter | undefined,
  strategy: ClipboardPasteStrategy,
  stage: 'composer' | 'selection' | 'command' | 'validation',
  startedAtMs: number,
  outcome: string,
  details: Parameters<typeof reportClipboardMetric>[5] = {},
): void {
  reportClipboardMetric(onMetric, stage, startedAtMs, () => performance.now(), outcome, {
    strategy,
    ...details,
  });
}

async function runExperimentalCommand(
  environment: EditorEnvironment,
  editor: HTMLElement,
  command: ExperimentalCommand,
  expectedText: string | null,
  argument: string | undefined,
  onMetric?: ClipboardMetricReporter,
): Promise<ExperimentalCommandResult> {
  const strategy: ClipboardPasteStrategy = command === 'paste' ? 'execCommandPaste' : 'insertHTML';
  let accepted = false;
  let commandThrew = false;
  let inputDataCharacterCount = 0;
  const inputData: string[] | null = onMetric ? [] : null;
  const inputEvents: ClipboardInputEventMetric[] | null = onMetric ? [] : null;
  const observedEvents: ClipboardObservedEventMetric[] | null = onMetric ? [] : null;
  const pastePayload: {
    text: string | null;
    contentKind: ClipboardContentKind;
    clipboardDataAvailable: boolean;
    fileCount: number;
  } = { text: null, contentKind: 'unknown', clipboardDataAvailable: false, fileCount: 0 };
  let pasteEventCount = 0;
  let pasteEventsTrusted = true;
  let pasteEventsTargetMatch = true;
  let beforeInputEventCount = 0;
  let inputEventCount = 0;
  let inputEventsTrusted = true;
  let inputTargetsMatchEditor = true;
  let inputTypesAllowed = true;
  let allInputDataPresent = true;
  let firstInputType: string | null = null;
  const allowedInputTypes = ['insertText', 'insertParagraph', 'insertLineBreak', 'insertFromPaste'];
  let observer: MutationObserver | null = null;
  let insertionStart: Range | null = null;
  const attachmentRoot = editor.closest('form') ?? editor;
  const attachmentsBefore = captureAttachmentUi(attachmentRoot);

  const summarizeEvent = (type: ClipboardObservedEventMetric['type'], event: Event, data: string | null) => {
    if (!observedEvents) return;
    const target = event.target as Node | null;
    const input = event as InputEvent;
    observedEvents.push({
      type,
      inputType: typeof input.inputType === 'string' ? input.inputType : null,
      trusted: event.isTrusted === true,
      targetMatchesEditor: target === editor || Boolean(target && editor.contains(target)),
      dataIsNull: data === null,
      dataCharacterCount: data === null ? null : data.length,
    });
  };
  const capturePaste = (event: Event) => {
    pasteEventCount += 1;
    pasteEventsTrusted &&= event.isTrusted === true;
    const target = event.target as Node | null;
    pasteEventsTargetMatch &&= target === editor || Boolean(target && editor.contains(target));
    let data: string | null = null;
    try {
      const clipboardData = (event as ClipboardEvent).clipboardData;
      if (clipboardData) {
        pastePayload.clipboardDataAvailable = true;
        const types = Array.from(clipboardData.types ?? []);
        const items = Array.from(clipboardData.items ?? []);
        const itemKinds = items.map((item) => item.kind);
        const itemTypes = items.map((item) => item.type);
        pastePayload.fileCount = clipboardData.files?.length ?? 0;
        data = clipboardData.getData('text/plain');
        pastePayload.contentKind = classifyClipboardContent(
          [...types, ...itemTypes],
          itemKinds,
          pastePayload.fileCount,
          typeof data === 'string' && data.length > 0,
        );
        if (data) pastePayload.text = data.replace(/\r\n/g, '\n');
      }
    } catch { /* Treat unavailable clipboard event data as unconfirmed. */ }
    summarizeEvent('paste', event, data);
  };
  const captureBeforeInput = (event: Event) => {
    if (onMetric) beforeInputEventCount += 1;
    const input = event as InputEvent;
    summarizeEvent('beforeinput', event, typeof input.data === 'string' ? input.data : null);
  };
  const captureInput = (event: Event) => {
    const input = event as InputEvent;
    const data = typeof input.data === 'string' ? input.data : null;
    const inputType = typeof input.inputType === 'string' ? input.inputType : null;
    const target = event.target as Node | null;
    const targetMatchesEditor = target === editor || Boolean(target && editor.contains(target));
    inputEventCount += 1;
    if (inputEventCount === 1) firstInputType = inputType;
    inputEventsTrusted &&= event.isTrusted === true;
    inputTargetsMatchEditor &&= targetMatchesEditor;
    inputTypesAllowed &&= allowedInputTypes.includes(inputType ?? '');
    allInputDataPresent &&= data !== null;
    if (data !== null && onMetric) inputDataCharacterCount += data.length;
    if (!inputEvents || !observedEvents) return;
    const summary: ClipboardObservedEventMetric = {
      type: 'input',
      inputType,
      trusted: event.isTrusted === true,
      targetMatchesEditor,
      dataIsNull: data === null,
      dataCharacterCount: data === null ? null : data.length,
    };
    inputEvents.push(summary);
    observedEvents.push(summary);
    if (data !== null) inputData?.push(data);
  };

  try {
    const selection = environment.document.getSelection();
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

  let commandStarted = onMetric ? performance.now() : 0;
  let commandEnded: number;
  const listeners: ReadonlyArray<readonly [string, EventListener]> = [
    ['paste', capturePaste],
    ['beforeinput', captureBeforeInput],
    ['input', captureInput],
  ];
  const listening: string[] = [];
  try {
    for (const [type, listener] of listeners) {
      editor.addEventListener(type, listener);
      listening.push(type);
    }
    commandStarted = onMetric ? performance.now() : 0;
    accepted = command === 'insertHTML'
      ? environment.document.execCommand('insertHTML', false, argument)
      : environment.document.execCommand('paste');
  } catch {
    commandThrew = true;
  } finally {
    commandEnded = onMetric ? performance.now() : 0;
    for (const [type, listener] of listeners) {
      if (listening.includes(type)) editor.removeEventListener(type, listener);
    }
    if (onMetric) {
      metric(onMetric, strategy, 'command', commandStarted, commandThrew ? 'threw' : accepted ? 'accepted' : 'rejected', {
        commandAccepted: accepted,
        ...(expectedText === null ? {} : { characterCount: expectedText.length }),
      });
    }
  }

  let editorChanged: boolean | null = null;
  if (observer) {
    try { editorChanged = observer.takeRecords().length > 0; }
    catch { /* Treat unavailable mutation readback as uncertain. */ }
    finally { observer.disconnect(); }
  }
  const inputType = firstInputType;
  const inputTrusted = inputEventCount > 0 && inputEventsTrusted;
  const postCaretMatchesEditor = currentCaretBelongsTo(environment.document, editor);
  let composerMatchesEditor = command === 'paste' ? findActiveEditor(environment) === editor : null;
  const insertionText = insertionStart && postCaretMatchesEditor
    ? readInsertionRangeText(environment.document, editor, insertionStart, expectedText ?? pastePayload.text ?? '')
    : null;
  const hasFilePayload = command === 'paste' && pastePayload.contentKind === 'files';
  const verificationText = command === 'paste' && !hasFilePayload ? pastePayload.text : expectedText;
  const contentMatches = insertionText !== null && verificationText !== null
    ? insertionText === verificationText
    : null;
  const dataMatches = !onMetric || verificationText === null || inputEventCount === 0
    ? null
    : allInputDataPresent && inputData?.join('') === verificationText;
  const eventTypesMatch = inputEventCount > 0 && inputTrusted && inputTargetsMatchEditor && inputTypesAllowed;
  const pasteEventTrusted = pasteEventCount === 0 ? null : pasteEventsTrusted;
  const pasteEventsValid = command !== 'paste'
    || pasteEventCount === 1 && pasteEventsTrusted && pasteEventsTargetMatch && pastePayload.clipboardDataAvailable;
  const pastePayloadMatches = command === 'paste' && pastePayload.text !== null
    && insertionText !== null && pastePayload.text === insertionText;
  const pasteInputEvidenceValid = inputEventCount === 0 || inputTrusted && eventTypesMatch;
  const inputMatches = command === 'paste'
    ? pasteInputEvidenceValid && composerMatchesEditor === true && postCaretMatchesEditor
      && pasteEventsValid && pastePayloadMatches && contentMatches === true
    : inputTrusted && eventTypesMatch && postCaretMatchesEditor && contentMatches === true;
  const canObserveFilePaste = hasFilePayload && pasteEventsValid && composerMatchesEditor === true;
  const immediateAttachmentChange = hasFilePayload && attachmentUiChanged(attachmentRoot, attachmentsBefore);
  const attachmentChanged = immediateAttachmentChange || (canObserveFilePaste
    ? await waitForAttachmentUi(attachmentRoot, attachmentsBefore, environment.document.defaultView)
    : false);
  if (hasFilePayload) composerMatchesEditor = findActiveEditor(environment) === editor;
  const attachmentAccepted = hasFilePayload && canObserveFilePaste
    && composerMatchesEditor === true && attachmentChanged;
  const status = hasFilePayload
    ? attachmentAccepted ? 'verified' : 'unconfirmed'
    : editorChanged === true
      ? accepted && inputMatches ? 'verified' : 'unconfirmed'
      : editorChanged === false ? 'rejected' : 'unconfirmed';
  const validationStarted = onMetric ? commandEnded : 0;
  if (onMetric) {
    metric(onMetric, strategy, 'validation', validationStarted,
      attachmentAccepted ? 'attachment-ui-accepted' : status, {
      commandAccepted: accepted,
      inputEventReceived: inputEventCount > 0,
      inputTrusted,
      inputType,
      dataMatches,
      editorChanged,
      inputEventCount,
      inputDataCharacterCount,
      inputEvents: inputEvents ?? [],
      observedEvents: observedEvents ?? [],
      contentMatches,
      composerMatchesEditor,
      postCaretMatchesEditor,
      verificationMethod: contentMatches === true ? 'editor-range' : null,
      ...(verificationText === null ? {} : { characterCount: verificationText.length }),
      ...(command === 'paste' ? {
        pasteEventCount,
        pasteEventReceived: pasteEventCount > 0,
        pasteEventTrusted,
        pasteTextCharacterCount: pastePayload.text?.length ?? null,
        pasteContentKind: pastePayload.contentKind,
        pasteFileCount: pastePayload.fileCount,
        ...(hasFilePayload ? { attachmentUiChanged: attachmentChanged } : {}),
        beforeInputEventCount,
      } : {}),
    });
  }

  const edit = status === 'verified' ? { ok: true } as const
    : status === 'unconfirmed' ? failed('edit-unconfirmed')
    : failed(commandThrew && command !== 'paste' ? 'unexpected-error' : 'edit-rejected');
  const characterCount = verificationText?.length;
  return {
    status,
    edit,
    ...(characterCount === undefined ? {} : { characterCount }),
    ...(command === 'paste' ? { contentKind: pastePayload.contentKind } : {}),
    ...(hasFilePayload ? { attachmentUiChanged: attachmentChanged } : {}),
  };
}

async function runAtSelection(
  command: ExperimentalCommand,
  expectedText: string | null,
  environment: EditorEnvironment,
  snapshot: SelectionSnapshot,
  onMetric?: ClipboardMetricReporter,
): Promise<ExperimentalCommandResult> {
  const strategy: ClipboardPasteStrategy = command === 'paste' ? 'execCommandPaste' : 'insertHTML';
  const composerStarted = onMetric ? performance.now() : 0;
  const editor = findActiveEditor(environment);
  if (!editor) {
    metric(onMetric, strategy, 'composer', composerStarted, 'not-found', {
      ...(expectedText === null ? {} : { characterCount: expectedText.length }),
    });
    return { status: 'rejected', edit: failed('editor-not-found') };
  }
  if (isEditorComposing(environment, editor)) {
    metric(onMetric, strategy, 'composer', composerStarted, 'ime-composing', {
      ...(expectedText === null ? {} : { characterCount: expectedText.length }),
    });
    return { status: 'rejected', edit: failed('ime-composing') };
  }
  if (snapshot.editor !== editor) {
    metric(onMetric, strategy, 'composer', composerStarted, 'changed', {
      ...(expectedText === null ? {} : { characterCount: expectedText.length }),
    });
    return { status: 'rejected', edit: failed('composer-changed') };
  }
  metric(onMetric, strategy, 'composer', composerStarted, 'ready', {
    ...(expectedText === null ? {} : { characterCount: expectedText.length }),
  });

  const selectionStarted = onMetric ? performance.now() : 0;
  const previousSelection = saveSelection(environment);
  try {
    editor.focus();
    selectRange(environment, insertionRange(environment, editor, snapshot));
    metric(onMetric, strategy, 'selection', selectionStarted, 'prepared', {
      ...(expectedText === null ? {} : { characterCount: expectedText.length }),
    });
    const argument = command === 'insertHTML' && expectedText !== null ? insertionHTML(expectedText) : undefined;
    const result = await runExperimentalCommand(environment, editor, command, expectedText, argument, onMetric);
    if (result.status === 'rejected') restoreSelection(previousSelection);
    return result;
  } catch {
    metric(onMetric, strategy, 'selection', selectionStarted, 'failed', {
      ...(expectedText === null ? {} : { characterCount: expectedText.length }),
    });
    restoreSelection(previousSelection);
    return { status: 'rejected', edit: failed('unexpected-error') };
  }
}

export async function replaceCurrentSelectionWithHTML(
  text: string,
  environment: EditorEnvironment = getBrowserEditorEnvironment(),
  snapshot: SelectionSnapshot = captureSelectionForPaste(environment),
  onMetric?: ClipboardMetricReporter,
): Promise<EditResult> {
  if (!text) return { ok: true };
  const normalized = text.replace(/\r\n/g, '\n');
  return (await runAtSelection('insertHTML', normalized, environment, snapshot, onMetric)).edit;
}

export async function pasteFromClipboard(
  environment: EditorEnvironment = getBrowserEditorEnvironment(),
  snapshot: SelectionSnapshot = captureSelectionForPaste(environment),
  onMetric?: ClipboardMetricReporter,
): Promise<ExperimentalEditAttempt> {
  const result = await runAtSelection('paste', null, environment, snapshot, onMetric);
  return {
    edit: result.edit,
    ...(result.characterCount === undefined ? {} : { characterCount: result.characterCount }),
    ...(result.contentKind === undefined ? {} : { contentKind: result.contentKind }),
    ...(result.attachmentUiChanged === undefined ? {} : { attachmentUiChanged: result.attachmentUiChanged }),
  };
}
