export type FakeListener = {
  readonly callback: EventListenerOrEventListenerObject;
  readonly capture: boolean;
  readonly once: boolean;
};

export class FakeEventTarget extends EventTarget {
  static readonly dispatchTrace: Array<{
    readonly currentTarget: FakeEventTarget;
    readonly callback: EventListenerOrEventListenerObject;
    readonly capture: boolean;
    readonly target: EventTarget | null;
  }> = [];
  private readonly listeners = new Map<string, FakeListener[]>();

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (!callback) return;
    const capture = typeof options === 'boolean' ? options : options?.capture ?? false;
    const listeners = this.listeners.get(type) ?? [];
    if (listeners.some((listener) => listener.callback === callback && listener.capture === capture)) return;
    listeners.push({ callback, capture, once: typeof options === 'object' && options.once === true });
    this.listeners.set(type, listeners);
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    if (!callback) return;
    const capture = typeof options === 'boolean' ? options : options?.capture ?? false;
    const remaining = (this.listeners.get(type) ?? []).filter(
      (listener) => listener.callback !== callback || listener.capture !== capture,
    );
    if (remaining.length) this.listeners.set(type, remaining);
    else this.listeners.delete(type);
  }

  dispatchAt(event: Event, capture: boolean, phase: number): void {
    Object.defineProperties(event, {
      currentTarget: { configurable: true, value: this },
      eventPhase: { configurable: true, value: phase },
    });
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) {
      if (listener.capture !== capture) continue;
      if (event.type === 'submit') {
        FakeEventTarget.dispatchTrace.push({ currentTarget: this, callback: listener.callback, capture, target: event.target });
      }
      if (listener.once) this.removeEventListener(event.type, listener.callback, capture);
      if (typeof listener.callback === 'function') listener.callback.call(this, event);
      else listener.callback.handleEvent(event);
    }
  }

  override dispatchEvent(event: Event): boolean {
    Object.defineProperty(event, 'target', { configurable: true, value: this });
    this.dispatchAt(event, true, 2);
    this.dispatchAt(event, false, 2);
    Object.defineProperties(event, {
      currentTarget: { configurable: true, value: null },
      eventPhase: { configurable: true, value: 0 },
    });
    return !event.defaultPrevented;
  }
}
