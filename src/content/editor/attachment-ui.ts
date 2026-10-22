const ATTACHMENT_UI_TIMEOUT_MS = 1_500;
const ATTACHMENT_UI_SELECTOR = [
  'img', 'video', 'audio', '[data-testid*="attachment"]', '[data-testid*="file"]',
  '[data-testid*="image"]', '[aria-label*="remove attachment"]', '[aria-label*="remove file"]',
].join(', ');

export function captureAttachmentUi(root: HTMLElement): Map<Element, string> {
  const snapshot = new Map<Element, string>();
  try {
    for (const element of root.querySelectorAll(ATTACHMENT_UI_SELECTOR)) {
      const attribute = (name: string) => {
        try { return element.getAttribute(name); }
        catch { return null; }
      };
      const hasAttribute = (name: string) => {
        try { return element.hasAttribute(name); }
        catch { return false; }
      };
      snapshot.set(element, [
        element.tagName,
        attribute('data-testid'),
        attribute('aria-label'),
        hasAttribute('src'),
        attribute('data-state'),
        attribute('class'),
        hasAttribute('style'),
      ].join('|'));
    }
  } catch { /* An unavailable UI snapshot cannot confirm an attachment. */ }
  return snapshot;
}

export function attachmentUiChanged(root: HTMLElement, before: Map<Element, string>): boolean {
  const after = captureAttachmentUi(root);
  return [...after].some(([element, signature]) => before.get(element) !== signature);
}

export function waitForAttachmentUi(
  root: HTMLElement,
  before: Map<Element, string>,
  view: (Window & typeof globalThis) | null,
): Promise<boolean> {
  if (attachmentUiChanged(root, before)) return Promise.resolve(true);
  const Observer = view?.MutationObserver ?? (typeof MutationObserver === 'undefined' ? null : MutationObserver);
  if (!Observer) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    let timer: number | ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | null = null;
    const finish = (changed: boolean) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) {
        if (view) view.clearTimeout(timer as number);
        else globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>);
      }
      observer?.disconnect();
      resolve(changed);
    };
    const onMutation = () => {
      if (attachmentUiChanged(root, before)) finish(true);
    };
    try {
      const createdObserver = new Observer(onMutation);
      observer = createdObserver;
      createdObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'data-testid', 'aria-label', 'data-state', 'class', 'style'],
      });
      timer = view
        ? view.setTimeout(() => finish(false), ATTACHMENT_UI_TIMEOUT_MS)
        : globalThis.setTimeout(() => finish(false), ATTACHMENT_UI_TIMEOUT_MS);
    } catch {
      observer?.disconnect();
      finish(false);
    }
  });
}
