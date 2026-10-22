export interface InteractionDiagnosticEvent {
  readonly type: string;
  readonly atMs: number;
  readonly source: string;
  readonly trusted: boolean;
  readonly defaultPrevented: boolean;
  readonly sendEvent: boolean;
  readonly inputType?: string;
  readonly keyIsEnter?: boolean;
}

const EVENT_TYPES = [
  'pointerdown', 'click', 'focusin', 'focusout', 'paste', 'beforeinput', 'input', 'change', 'keydown', 'keyup', 'submit',
] as const;

function sourceKind(event: Event): string {
  const origin = event.composedPath()[0];
  if (typeof Element === 'undefined' || !(origin instanceof Element)) return 'document';

  if (origin instanceof HTMLElement) {
    const root = origin.getRootNode();
    if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot
      && root.host.id === 'chatpanelplus-extension-root') {
      const buttonId = origin.closest('button')?.getAttribute('data-button-id');
      if (buttonId === 'paste-btn') return 'paste-button';
      if (buttonId === 'clear-btn') return 'clear-button';
      return origin.closest('button') ? 'panel-button' : 'panel';
    }
    if (origin.isContentEditable) return 'composer';
    if (origin.closest('form')) return origin instanceof HTMLButtonElement ? 'form-button' : 'form-control';
    if (origin instanceof HTMLButtonElement) return 'page-button';
  }
  return 'page';
}

function createDiagnosticEvent(event: Event, startedAtMs: number, now: () => number): InteractionDiagnosticEvent {
  const inputType = (event as InputEvent).inputType;
  return {
    type: event.type,
    atMs: Math.max(0, Math.round((now() - startedAtMs) * 10) / 10),
    source: sourceKind(event),
    trusted: event.isTrusted,
    defaultPrevented: event.defaultPrevented,
    sendEvent: event.type === 'submit',
    ...(typeof inputType === 'string' ? { inputType } : {}),
    ...((event.type === 'keydown' || event.type === 'keyup')
      ? { keyIsEnter: (event as KeyboardEvent).key === 'Enter' }
      : {}),
  };
}

export function startInteractionDiagnostics(
  search: string,
  target: Document,
  report: (event: InteractionDiagnosticEvent) => void = (event) => {
    console.info('[ChatPanelPlus interaction debug]', event);
  },
  now: () => number = () => performance.now(),
): () => void {
  if (new URLSearchParams(search).get('cppDebugInteraction') !== '1') return () => {};

  const startedAtMs = now();
  const listener = (event: Event) => {
    try {
      report(createDiagnosticEvent(event, startedAtMs, now));
    } catch { /* Diagnostic reporting must not alter the observed interaction. */ }
  };
  for (const type of EVENT_TYPES) target.addEventListener(type, listener, true);
  return () => {
    for (const type of EVENT_TYPES) target.removeEventListener(type, listener, true);
  };
}
