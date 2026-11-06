import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { startInteractionDiagnostics } from '../src/content/interaction-debug.ts';

function eventDocument(): Document {
  const target = new EventTarget();
  const remove = target.removeEventListener.bind(target);
  // Node 22 does not normalize the boolean capture argument on removal as browsers do.
  target.removeEventListener = (type, listener, options) => remove(type, listener,
    typeof options === 'boolean' ? { capture: options } : options);
  return target as unknown as Document;
}

class DiagnosticElement {
  parent: DiagnosticElement | null = null;
  root: DiagnosticShadowRoot | null = null;
  id = 'private-id';
  textContent = 'private body';
  title = 'private title';
  readonly tag: string;
  readonly attributes: Record<string, string>;
  constructor(tag: string, attributes: Record<string, string> = {}) { this.tag = tag; this.attributes = attributes; }
  getRootNode(): DiagnosticElement | DiagnosticShadowRoot { return this.root ?? this.parent?.getRootNode() ?? this; }
  closest(tag: string): DiagnosticElement | null { return this.tag === tag ? this : this.parent?.closest(tag) ?? null; }
  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
  append<T extends DiagnosticElement>(child: T): T { child.parent = this; return child; }
}

class DiagnosticHTMLElement extends DiagnosticElement {
  editable = false;
  get isContentEditable(): boolean { return this.editable || (this.parent instanceof DiagnosticHTMLElement && this.parent.isContentEditable); }
}

class DiagnosticButton extends DiagnosticHTMLElement {
  constructor(attributes: Record<string, string> = {}) { super('button', attributes); }
}

class DiagnosticShadowRoot {
  readonly host: DiagnosticHTMLElement;
  constructor(host: DiagnosticHTMLElement) { this.host = host; }
}

function installElements(context: TestContext) {
  const constructors = {
    Element: DiagnosticElement, HTMLElement: DiagnosticHTMLElement,
    HTMLButtonElement: DiagnosticButton, ShadowRoot: DiagnosticShadowRoot,
  };
  for (const [name, constructor] of Object.entries(constructors)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: constructor });
    context.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
}

function fromOrigin(type: string, origin: DiagnosticElement): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'composedPath', { value: () => [origin] });
  return event;
}

test('HTML/SVGの子をクリックしてもShadow内ボタンとフォーム・ページボタンを区別する', (context) => {
  installElements(context);
  const document = eventDocument();
  const events: string[] = [];
  const stop = startInteractionDiagnostics('?cppDebugInteraction=1', document, ({ source }) => events.push(source));
  context.after(stop);
  const host = new DiagnosticHTMLElement('div');
  host.id = 'chatpanelplus-extension-root';
  const panel = new DiagnosticHTMLElement('section');
  panel.root = new DiagnosticShadowRoot(host);
  const form = new DiagnosticHTMLElement('form');
  for (const [parent, id] of [
    [panel, 'paste-btn'], [panel, 'clear-btn'], [panel, 'full-btn'],
    [form, 'send'], [new DiagnosticHTMLElement('main'), 'page-action'],
  ] as const) {
    const button = parent.append(new DiagnosticButton({ 'data-button-id': id }));
    for (const child of [button, button.append(new DiagnosticHTMLElement('span')), button.append(new DiagnosticElement('svg')).append(new DiagnosticElement('path'))]) {
      document.dispatchEvent(fromOrigin('click', child));
    }
  }
  assert.deepEqual(events, [
    'paste-button', 'paste-button', 'paste-button',
    'clear-button', 'clear-button', 'clear-button',
    'panel-button', 'panel-button', 'panel-button',
    'form-button', 'form-button', 'form-button',
    'page-button', 'page-button', 'page-button',
  ]);
});

test('ボタンでないSVGやフォーム入力とComposerは固有の分類を保つ', (context) => {
  installElements(context);
  const document = eventDocument();
  const events: string[] = [];
  const stop = startInteractionDiagnostics('?cppDebugInteraction=1', document, ({ source }) => events.push(source));
  context.after(stop);
  const host = new DiagnosticHTMLElement('div');
  host.id = 'chatpanelplus-extension-root';
  const panel = new DiagnosticHTMLElement('section');
  panel.root = new DiagnosticShadowRoot(host);
  const foreignPanel = new DiagnosticElement('svg');
  foreignPanel.root = new DiagnosticShadowRoot(new DiagnosticHTMLElement('div'));
  const form = new DiagnosticHTMLElement('form');
  const composer = form.append(new DiagnosticHTMLElement('div'));
  composer.editable = true;
  const origins = [panel, panel.append(new DiagnosticElement('svg')), foreignPanel,
    new DiagnosticElement('svg'), form.append(new DiagnosticHTMLElement('input')),
    form.append(new DiagnosticHTMLElement('span')), composer, composer.append(new DiagnosticHTMLElement('p'))];
  for (const origin of origins) document.dispatchEvent(fromOrigin('focusin', origin));
  assert.deepEqual(events, ['panel', 'panel', 'page', 'page', 'form-control', 'form-control', 'composer', 'composer']);
});

test('明示的な診断フラグがない・無効ならlistenerを登録せずsubmitを記録しない', (context) => {
  for (const search of ['', '?cppDebugInteraction=0', '?cppDebugInteraction=true', '?other=1']) {
    const document = eventDocument();
    const addListener = context.mock.method(document, 'addEventListener');
    const events: unknown[] = [];
    const stop = startInteractionDiagnostics(search, document, (event) => events.push(event), () => 100);
    document.dispatchEvent(new Event('submit', { cancelable: true }));
    stop();
    assert.equal(addListener.mock.callCount(), 0);
    assert.deepEqual(events, []);
  }
});

test('有効時は非機密なイベント時系列だけ記録しイベントを抑止しない', () => {
  const document = eventDocument();
  const events: Array<Record<string, unknown>> = [];
  let time = 100;
  const stop = startInteractionDiagnostics(
    '?cppDebugInteraction=1',
    document,
    (event) => events.push(event as unknown as Record<string, unknown>),
    () => time,
  );
  const input = new Event('beforeinput', { cancelable: true });
  Object.defineProperties(input, {
    inputType: { value: 'insertText' },
    data: { value: 'private text must not be recorded' },
  });

  document.dispatchEvent(input);
  time = 110;
  document.dispatchEvent(new Event('focusin'));
  time = 125;
  document.dispatchEvent(new Event('submit', { cancelable: true }));

  assert.deepEqual(events.map(({ type, atMs, source, trusted, defaultPrevented, sendEvent }) => ({
    type, atMs, source, trusted, defaultPrevented, sendEvent,
  })), [
    { type: 'beforeinput', atMs: 0, source: 'document', trusted: false, defaultPrevented: false, sendEvent: false },
    { type: 'focusin', atMs: 10, source: 'document', trusted: false, defaultPrevented: false, sendEvent: false },
    { type: 'submit', atMs: 25, source: 'document', trusted: false, defaultPrevented: false, sendEvent: true },
  ]);
  assert.equal(events[0]?.inputType, 'insertText');
  assert.equal(Object.hasOwn(events[0] ?? {}, 'data'), false);
  assert.equal(input.defaultPrevented, false);
  stop();
});

test('payloadに本文・data・title・id・URLを含めずEnter/inputTypeだけを分類する', (context) => {
  installElements(context);
  const document = eventDocument();
  const events: unknown[] = [];
  const stop = startInteractionDiagnostics('?cppDebugInteraction=1', document, (event) => events.push(event), () => 100);
  context.after(stop);
  const origin = new DiagnosticHTMLElement('textarea');
  for (const [type, key] of [['keydown', 'Enter'], ['keyup', 'a'], ['beforeinput', null]] as const) {
    const event = fromOrigin(type, origin);
    Object.defineProperties(event, {
      key: { value: key }, inputType: { value: 'insertText' },
      data: { get() { throw new Error('data must not be read'); } },
      text: { value: 'private text' }, title: { value: 'private title' },
      id: { value: 'private-id' }, url: { value: 'https://private.example/conversation' },
    });
    document.dispatchEvent(event);
  }
  const common = { atMs: 0, source: 'page', trusted: false, defaultPrevented: false, sendEvent: false, inputType: 'insertText' };
  assert.deepEqual(events, [
    { ...common, type: 'keydown', keyIsEnter: true },
    { ...common, type: 'keyup', keyIsEnter: false },
    { ...common, type: 'beforeinput' },
  ]);
});

test('停止後はすべての診断イベントを解除し通常のイベント配送を維持する', () => {
  const document = eventDocument();
  const observed: string[] = [];
  const stop = startInteractionDiagnostics('?cppDebugInteraction=1', document, ({ type }) => observed.push(type));
  const types = ['pointerdown', 'click', 'focusin', 'focusout', 'paste', 'beforeinput', 'input', 'change', 'keydown', 'keyup', 'submit'];
  for (const type of types) document.dispatchEvent(new Event(type));
  assert.deepEqual(observed, types);
  stop();
  stop();
  observed.length = 0;
  let received = 0;
  for (const type of types) document.addEventListener(type, () => { received += 1; });
  for (const type of types) document.dispatchEvent(new Event(type));
  assert.deepEqual(observed, []);
  assert.equal(received, 11);
});

test('診断reportが失敗してもclick・paste・入力・submitを抑止せず後続listenerへ渡す', () => {
  const document = eventDocument();
  const stop = startInteractionDiagnostics('?cppDebugInteraction=1', document, () => { throw new Error('report failed'); });
  let received = 0;
  for (const type of ['click', 'paste', 'beforeinput', 'keydown', 'submit']) {
    document.addEventListener(type, () => { received += 1; });
    const event = new Event(type, { cancelable: true });
    assert.equal(document.dispatchEvent(event), true);
    assert.equal(event.defaultPrevented, false);
  }
  assert.equal(received, 5);
  stop();
});
