const BLOCK_TEXT_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION',
  'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'LI', 'MAIN', 'NAV', 'OL',
  'P', 'PRE', 'SECTION', 'TABLE', 'UL',
]);

interface TextProjection {
  readonly text: string;
  readonly ambiguous: boolean;
}

export function rangeBelongsTo(range: Range, editor: HTMLElement): boolean {
  const node = range.commonAncestorContainer;
  return node === editor || editor.contains(node);
}

function projectEditableText(node: Node): TextProjection {
  if (node.nodeType === 3) return { text: node.textContent ?? '', ambiguous: false };
  const element = node.nodeType === 1 ? node as Element : null;
  if (element?.tagName === 'BR') return { text: '\n', ambiguous: false };
  const children = [...node.childNodes];
  const block = element !== null && BLOCK_TEXT_TAGS.has(element.tagName);
  if (block && children.length === 1 && (children[0] as Element | undefined)?.tagName === 'BR') {
    return { text: '', ambiguous: true };
  }

  let text = '';
  let ambiguous = false;
  let previousBlock = false;
  const blockChildCount = children.reduce((count, child) => {
    const childElement = child.nodeType === 1 ? child as Element : null;
    return count + (childElement !== null && BLOCK_TEXT_TAGS.has(childElement.tagName) ? 1 : 0);
  }, 0);
  children.forEach((child, index) => {
    const childElement = child.nodeType === 1 ? child as Element : null;
    const childBlock = childElement !== null && BLOCK_TEXT_TAGS.has(childElement.tagName);
    if (index > 0 && (previousBlock || childBlock)) text += '\n';
    const projected = projectEditableText(child);
    ambiguous ||= projected.ambiguous && !(childBlock && blockChildCount > 1);
    text += projected.text;
    previousBlock = childBlock;
  });
  return { text, ambiguous };
}

export function currentCaretBelongsTo(document: Document, editor: HTMLElement): boolean {
  const selection = document.getSelection();
  if (!selection?.rangeCount) return false;
  try {
    const caret = selection.getRangeAt(0);
    return caret.collapsed && rangeBelongsTo(caret, editor);
  } catch {
    return false;
  }
}

export function readInsertionRangeText(
  document: Document,
  editor: HTMLElement,
  start: Range,
  expectedText: string,
): string | null {
  const selection = document.getSelection();
  if (!selection?.rangeCount) return null;
  try {
    const caret = selection.getRangeAt(0);
    if (!caret.collapsed || !rangeBelongsTo(caret, editor) || !rangeBelongsTo(start, editor)) return null;
    const inserted = start.cloneRange();
    inserted.setEnd(caret.endContainer, caret.endOffset);
    if (inserted.collapsed) return null;
    const text = inserted.toString();
    if (text === expectedText || !expectedText.includes('\n')) return text;
    const projected = projectEditableText(inserted.cloneContents());
    return projected.ambiguous ? null : projected.text;
  } catch {
    return null;
  }
}
