import { findActiveEditor, insertTextAtRange, isEditorComposing, type EditResult, type EditorEnvironment } from './adapter.ts';

type TextTail = Readonly<{ hasText: boolean; lastCharacter: string }>;

function readTextTail(environment: EditorEnvironment, editor: HTMLElement): TextTail {
  const walker = environment.document.createTreeWalker(editor, 4);
  let lastText: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (node.length > 0) lastText = node;
    node = walker.nextNode() as Text | null;
  }
  if (!lastText) return { hasText: false, lastCharacter: '' };
  try {
    const range = environment.document.createRange();
    range.setStart(lastText, lastText.length - 1);
    range.setEnd(lastText, lastText.length);
    return { hasText: true, lastCharacter: range.toString() };
  } catch {
    return { hasText: true, lastCharacter: '' };
  }
}

function endsWithBreak(node: Node | null): boolean {
  if (!node || node.nodeType !== 1) return false;
  const element = node as Element;
  return element.tagName === 'BR' || endsWithBreak(element.lastChild);
}

function saveSelection(environment: EditorEnvironment): Readonly<{ selection: Selection | null; range: Range | null }> {
  const selection = environment.document.getSelection();
  try {
    return { selection, range: selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null };
  } catch {
    return { selection, range: null };
  }
}

function restoreSelection(saved: Readonly<{ selection: Selection | null; range: Range | null }>): void {
  try {
    saved.selection?.removeAllRanges();
    if (saved.selection && saved.range) saved.selection.addRange(saved.range);
  } catch { /* Keep the editor result if the browser can no longer restore the old selection. */ }
}

export function appendTextAtEnd(text: string, environment: EditorEnvironment): EditResult {
  if (!text) return { ok: true };
  const editor = findActiveEditor(environment);
  if (!editor) return { ok: false, reason: 'editor-not-found' };
  if (isEditorComposing(environment, editor)) return { ok: false, reason: 'ime-composing' };
  if (editor.querySelector('img, video, audio, button, input, [data-testid*="attachment"]')) {
    return { ok: false, reason: 'complex-content' };
  }
  const saved = saveSelection(environment);
  try {
    const tail = readTextTail(environment, editor);
    const trailingBreak = endsWithBreak(editor.lastChild);
    const needsSeparator = tail.hasText && tail.lastCharacter !== '\n' && tail.lastCharacter !== '\r'
      && !trailingBreak && !text.startsWith('\n') && !text.startsWith('\r');
    const range = environment.document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    return insertTextAtRange(`${needsSeparator ? '\n' : ''}${text}`, environment, editor, range);
  } catch {
    return { ok: false, reason: 'unexpected-error' };
  } finally {
    restoreSelection(saved);
  }
}
