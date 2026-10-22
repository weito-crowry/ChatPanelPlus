import type { EditorEnvironment } from '../src/content/editor/adapter.ts';

type MockRange = {
  startOffset: number;
  endOffset: number;
  startContainer: Node;
  endContainer: Node;
  selectNodeContents(): void;
  collapse(toStart?: boolean): void;
  setStart(node: Node, offset: number): void;
  setEnd(node: Node, offset: number): void;
  setStartAfter(node: Node): void;
  deleteContents(): void;
  insertNode(node: Node): void;
  readonly commonAncestorContainer: Node;
  readonly collapsed: boolean;
  cloneRange(): MockRange;
  cloneContents(): DocumentFragment;
  toString(): string;
};

export function fixture(firstCharacter = 'o', options: { hasForm?: boolean; nestedText?: string; selectionStart?: number; selectionEnd?: number } = {}) {
  let modelText = options.nestedText ?? `${firstCharacter}riginal`;
  const textNode = {
    get textContent() { return modelText; },
    get length() { return modelText.length; },
  } as Text;
  const firstText = options.nestedText === undefined
    ? textNode
    : {
      get textContent() { return modelText; },
      get length() { return modelText.length; },
    } as Text;
  const firstElement = options.nestedText === undefined
    ? textNode
    : { firstChild: firstText } as unknown as Element;
  const attachmentNodes: Element[] = [];
  const form = {
    contains: (element: Element) => element === editor || (element as HTMLElement).closest('form') === form,
    querySelector: () => ({ disabled: true }),
    querySelectorAll: () => attachmentNodes,
  } as unknown as HTMLFormElement;
  const selectionState: { ranges: Range[] } = { ranges: [] };
  const insertedNodes: Node[] = [];
  const dispatchedInputs: Event[] = [];
  const inputListeners: Array<(event: Event) => void> = [];
  const editorListeners = new Map<string, Array<(event: Event) => void>>();
  const mutationObservers: Array<{
    targets: Set<Node>;
    observing: boolean;
    records: MutationRecord[];
    callback(records: MutationRecord[]): void;
    takeRecords(): MutationRecord[];
  }> = [];
  const pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  let nextTimerId = 0;
  const commandBehavior: {
    accepted?: boolean;
    mutate?: boolean;
    trusted?: boolean;
    inputType?: string;
    data?: string | null;
    mutationText?: string;
    events?: Array<{ trusted?: boolean; inputType?: string; data?: string | null }>;
    rangeText?: string;
    rangeContents?: DocumentFragment;
    pasteText?: string;
    pasteTypes?: string[];
    pasteItems?: Array<{ kind?: string; type?: string }>;
    pasteFiles?: number;
    emitPaste?: boolean;
    pasteTargetMatches?: boolean;
    composerChanged?: boolean;
    afterCommand?: () => void;
  } = {};
  let cleared = false;
  let mutated = false;
  const editor = {
    isConnected: true,
    isContentEditable: true,
    hidden: false,
    getAttribute: (name: string) => name === 'contenteditable' ? 'true' : null,
    hasAttribute: () => false,
    firstChild: firstElement,
    get childNodes() { return cleared ? [{ nodeType: 1 }, ...insertedNodes] : [firstElement, ...insertedNodes]; },
    get textContent() { return modelText; },
    contains: (node: Node) => node === editor || node === textNode || node === firstElement || node === firstText || insertedNodes.includes(node),
    focus() {},
    dispatchEvent: (event: Event) => { dispatchedInputs.push(event); return true; },
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener !== 'function') return;
      const callback = listener as (event: Event) => void;
      const listeners = editorListeners.get(type) ?? [];
      listeners.push(callback);
      editorListeners.set(type, listeners);
      if (type === 'input') inputListeners.push(callback);
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener !== 'function') return;
      const callback = listener as (event: Event) => void;
      const listeners = editorListeners.get(type) ?? [];
      const index = listeners.indexOf(callback);
      if (index >= 0) listeners.splice(index, 1);
      if (type === 'input') {
        const inputIndex = inputListeners.indexOf(callback);
        if (inputIndex >= 0) inputListeners.splice(inputIndex, 1);
      }
    },
    querySelector: () => null,
    closest: (selector: string) => selector === 'form' && options.hasForm !== false ? form : null,
    getClientRects: () => [{}],
    checkVisibility: () => true,
  } as unknown as HTMLElement;
  const recordEditorMutation = () => {
    for (const observer of mutationObservers) {
      if (observer.observing && (observer.targets.has(editor as unknown as Node) || observer.targets.has(form as unknown as Node))) {
        observer.records.push({ target: editor } as unknown as MutationRecord);
        observer.callback(observer.records);
      }
    }
  };
  const recordAttachmentMutation = () => {
    for (const observer of mutationObservers) {
      if (observer.observing && observer.targets.has(form as unknown as Node)) {
        observer.records.push({ target: form as unknown as Node } as unknown as MutationRecord);
        observer.callback(observer.records);
      }
    }
  };
  const emitEditorEvent = (type: string, event: Event) => {
    for (const listener of [...(editorListeners.get(type) ?? [])]) listener(event);
  };
  const selectors = new Map<string, Element[]>([
    ['#prompt-textarea[contenteditable="true"]', [editor]],
  ]);
  const listeners = new Map<string, (event: Event) => void>();
  const selection = {
    get rangeCount() { return selectionState.ranges.length; },
    getRangeAt: (index: number) => selectionState.ranges[index],
    removeAllRanges: () => { selectionState.ranges = []; },
    addRange: (range: Range) => { selectionState.ranges.push(range); },
  } as unknown as Selection;
  const makeRangeState = (
    startOffset = 0,
    endOffset = modelText.length,
    startContainer = editor as unknown as Node,
    endContainer = editor as unknown as Node,
  ): MockRange => ({
    startOffset,
    endOffset,
    startContainer,
    endContainer,
    selectNodeContents() {
      this.startOffset = 0;
      this.endOffset = modelText.length;
    },
    collapse(toStart = false) {
      const offset = toStart ? this.startOffset : this.endOffset;
      this.startOffset = offset;
      this.endOffset = offset;
    },
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
    setStartAfter(node) {
      this.startContainer = editor as unknown as Node;
      this.startOffset = ((node as unknown as { data?: string }).data ?? '').length;
      this.endOffset = this.startOffset;
    },
    deleteContents() {
      if (this.startOffset === 0 && this.endOffset >= modelText.length) {
        modelText = '';
        cleared = true;
      }
    },
    insertNode(node) {
      insertedNodes.push(node);
      (node as unknown as { parentNode: Node }).parentNode = editor;
    },
    get commonAncestorContainer() { return editor; },
    get collapsed() { return this.startOffset === this.endOffset; },
    cloneRange() {
      return makeRangeState(this.startOffset, this.endOffset, this.startContainer, this.endContainer);
    },
    cloneContents() { return commandBehavior.rangeContents as DocumentFragment; },
    toString() {
      return mutated && commandBehavior.rangeText !== undefined
        ? commandBehavior.rangeText
        : modelText.slice(this.startOffset, this.endOffset);
    },
  });
  const document = {
    querySelectorAll: (selector: string) => selectors.get(selector) ?? [],
    getSelection: () => selection,
    createRange: () => makeRangeState() as unknown as Range,
    createTreeWalker: () => {
      let visited = false;
      return { nextNode: () => {
        if (cleared || visited) return null;
        visited = true;
        return firstText;
      } };
    },
    createTextNode: (data: string) => ({ data, nodeValue: data, parentNode: null }) as unknown as Text,
    defaultView: {
      MutationObserver: class {
        targets = new Set<Node>();
        observing = false;
        records: MutationRecord[] = [];
        private readonly notify: MutationCallback;
        constructor(notify: MutationCallback) { this.notify = notify; }
        observe(target: Node) {
          this.targets.add(target);
          this.observing = true;
          if (!mutationObservers.includes(this as unknown as (typeof mutationObservers)[number])) {
            mutationObservers.push(this as unknown as (typeof mutationObservers)[number]);
          }
        }
        disconnect() { this.observing = false; }
        takeRecords() {
          const records = this.records;
          this.records = [];
          return records;
        }
        callback(records: MutationRecord[]) { this.notify(records, this as unknown as MutationObserver); }
      },
      setTimeout: (callback: () => void, delay: number) => {
        const id = ++nextTimerId;
        const handle = globalThis.setTimeout(() => {
          pendingTimers.delete(id);
          callback();
        }, delay);
        pendingTimers.set(id, handle);
        return id;
      },
      clearTimeout: (id: number) => {
        const handle = pendingTimers.get(id);
        if (handle !== undefined) globalThis.clearTimeout(handle);
        pendingTimers.delete(id);
      },
      InputEvent: class extends Event {
        inputType: string;
        data: string | null;
        constructor(type: string, init: InputEventInit) {
          super(type, init);
          this.inputType = init.inputType ?? '';
          this.data = init.data ?? null;
        }
      },
    },
    execCommand: (command: string, _ui?: boolean, value?: string | null) => {
      commands.push(`${command}:${value ?? ''}`);
      const range = selectionState.ranges.at(-1) as (Range & { startOffset: number; endOffset: number }) | undefined;
      if (!range) return false;
      if (command === 'insertText') {
        const text = commandBehavior.mutationText ?? value ?? '';
        if (commandBehavior.mutate !== false) {
          modelText = modelText.slice(0, range.startOffset) + text + modelText.slice(range.endOffset);
          range.startOffset += text.length;
          range.endOffset = range.startOffset;
          mutated = true;
          recordEditorMutation();
        }
      } else if (command === 'insertHTML' || command === 'paste') {
        if (command === 'paste' && commandBehavior.emitPaste !== false) {
          emitEditorEvent('paste', {
            target: commandBehavior.pasteTargetMatches === false ? {} : editor,
            isTrusted: commandBehavior.trusted ?? true,
            clipboardData: {
              types: commandBehavior.pasteTypes ?? ['text/plain'],
              items: commandBehavior.pasteItems ?? [],
              files: Array.from({ length: commandBehavior.pasteFiles ?? 0 }, () => ({})),
              getData: (type: string) => type === 'text/plain' ? commandBehavior.pasteText ?? '' : '',
            },
          } as unknown as Event);
          emitEditorEvent('beforeinput', {
            target: editor,
            isTrusted: commandBehavior.trusted ?? true,
            inputType: 'insertFromPaste',
            data: null,
          } as unknown as Event);
        }
        if (commandBehavior.mutate !== false) {
          const text = commandBehavior.mutationText ?? (command === 'paste' ? commandBehavior.pasteText ?? '' : '');
          modelText = modelText.slice(0, range.startOffset) + text + modelText.slice(range.endOffset);
          range.startOffset += text.length;
          range.endOffset = range.startOffset;
          mutated = true;
          recordEditorMutation();
        }
      } else if (command === 'delete') {
        if (commandBehavior.mutate !== false) {
          modelText = modelText.slice(0, range.startOffset) + modelText.slice(range.endOffset);
          range.endOffset = range.startOffset;
          cleared = modelText.length === 0;
          recordEditorMutation();
        }
      }
      commandBehavior.afterCommand?.();
      const inputEvents = commandBehavior.events ?? [{
        trusted: commandBehavior.trusted,
        inputType: commandBehavior.inputType,
        data: Object.hasOwn(commandBehavior, 'data')
          ? commandBehavior.data
          : command === 'insertText' ? value ?? null : null,
      }];
      for (const input of inputEvents) {
        const event = {
          target: editor,
          isTrusted: input.trusted ?? commandBehavior.trusted ?? true,
          inputType: input.inputType ?? commandBehavior.inputType ?? (
            command === 'insertText' || command === 'insertHTML' ? 'insertText'
              : command === 'paste' ? 'insertFromPaste' : 'deleteContentBackward'
          ),
          data: Object.hasOwn(input, 'data')
            ? input.data
            : Object.hasOwn(commandBehavior, 'data')
              ? commandBehavior.data
              : command === 'insertText' ? value ?? null : null,
        } as unknown as Event;
        for (const listener of [...inputListeners]) listener(event);
      }
      if (commandBehavior.composerChanged) selectors.set('#prompt-textarea[contenteditable="true"]', []);
      return commandBehavior.accepted ?? true;
    },
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') listeners.set(type, listener as (event: Event) => void);
    },
  } as unknown as Document;
  const commands: string[] = [];
  const environment: EditorEnvironment = { document, isVisible: () => true };
  const selectionRange = document.createRange() as Range & { startOffset: number; endOffset: number };
  const start = options.selectionStart ?? modelText.length;
  const end = options.selectionEnd ?? start;
  selectionRange.startOffset = start;
  selectionRange.endOffset = end;
  selectionState.ranges.push(selectionRange);
  return {
    editor, selectors, commands, environment, selection, selectionState,
    insertedNodes, dispatchedInputs,
    commandBehavior,
    recordEditorMutation,
    get activeObserverCount() { return mutationObservers.filter((observer) => observer.observing).length; },
    get activeTimerCount() { return pendingTimers.size; },
    addAttachment(node = {} as Element) { attachmentNodes.push(node); recordAttachmentMutation(); },
    get text() { return modelText; },
    makeRange(startOffset: number, endOffset: number) {
      const range = document.createRange() as Range & { startOffset: number; endOffset: number };
      range.startOffset = startOffset;
      range.endOffset = endOffset;
      return range;
    },
    emitInput(event: Event) { for (const listener of [...inputListeners]) listener(event); },
    emit(type: string, event: Event) { emitEditorEvent(type, event); },
    dispatch(type: string) { listeners.get(type)?.({ target: editor } as unknown as Event); },
  };
}
