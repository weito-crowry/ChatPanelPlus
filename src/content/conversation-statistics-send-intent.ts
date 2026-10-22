import { findActiveEditor, isEditorComposing, type EditorEnvironment } from './editor/adapter.ts';

function editorEnvironment(document: Document): EditorEnvironment {
  return {
    document,
    isVisible(editor) {
      if (!editor.isConnected || editor.hidden || editor.getAttribute('aria-hidden') === 'true') return false;
      if (typeof editor.checkVisibility === 'function' && !editor.checkVisibility()) return false;
      return editor.getClientRects().length > 0;
    },
  };
}

function findComposerEditor(document: Document): HTMLElement | null {
  const editor = findActiveEditor(editorEnvironment(document));
  return editor?.closest('[data-turn-key]') ? null : editor;
}

export function findComposerForm(document: Document): HTMLFormElement | null {
  return findComposerEditor(document)?.closest('form') as HTMLFormElement | null;
}

export function isComposerEnterIntent(event: KeyboardEvent, document: Document): boolean {
  if (event.key !== 'Enter' || event.shiftKey || event.repeat || event.isComposing || event.keyCode === 229) return false;
  const editor = findComposerEditor(document);
  const target = event.target as Node | null;
  if (!editor || !target || !(target === editor || editor.contains(target))) return false;
  return !isEditorComposing(editorEnvironment(document), editor);
}

function isAssociatedWithComposer(button: Element, form: HTMLFormElement | null): boolean {
  if (!form) return false;
  if (form.contains(button) || (button as HTMLButtonElement).form === form) return true;
  const formId = form.getAttribute('id');
  return Boolean(formId && button.getAttribute('form') === formId);
}

export function isComposerSendButton(target: EventTarget | null, document: Document): boolean {
  if (!(target instanceof Element)) return false;
  const button = target.closest('button');
  if (!button || button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return false;
  const form = findComposerForm(document);
  if (button.getAttribute('data-testid') === 'send-button') {
    return !button.closest('[data-turn-key]') && isAssociatedWithComposer(button, form);
  }
  return button.getAttribute('type') === 'submit' && Boolean(form?.contains(button));
}

export function isComposerSubmitIntent(event: Event, document: Document, activeForm: HTMLFormElement | null): boolean {
  if (event.target === activeForm) return false;
  return findComposerForm(document) === event.target || isComposerSendButton((event as SubmitEvent).submitter, document);
}
