const TITLE_MARKER = '● ';
const BLINK_INTERVAL_MS = 500;
const BLINK_TOGGLE_COUNT = 6;

const ATTENTION_ICON = createIconDataUri('#d32f2f');
const ALTERNATE_ATTENTION_ICON = createIconDataUri('#ffb300');

function createIconDataUri(badgeColor: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="7" fill="#202123"/><circle cx="23" cy="9" r="8" fill="${badgeColor}"/><path d="M23 5.5v6M23 14.5v.2" stroke="#fff" stroke-linecap="round" stroke-width="2.7"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export interface TabCompletionIndicatorOptions {
  readonly document: Pick<Document, 'documentElement' | 'head' | 'title' | 'visibilityState' | 'createElement' | 'addEventListener' | 'removeEventListener'>;
  readonly window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'>;
  readonly createMutationObserver?: (callback: MutationCallback) => MutationObserver;
}

export class TabCompletionIndicator {
  private readonly options: TabCompletionIndicatorOptions;
  private unread = false;
  private disposed = false;
  private baseTitle = '';
  private lastWrittenTitle: string | null = null;
  private lastTitleElement: HTMLTitleElement | null = null;
  private titleElementCreatedByIndicator = false;
  private iconLink: HTMLLinkElement | null = null;
  private observedHead: HTMLHeadElement | null = null;
  private headObserver: MutationObserver | null = null;
  private documentElementObserver: MutationObserver | null = null;
  private blinkTimer: number | undefined;
  private blinkPhase = 0;
  private blinkTogglesRemaining = 0;

  constructor(options: TabCompletionIndicatorOptions) {
    this.options = options;
  }

  onAnswerCompleted(): void {
    if (this.disposed || this.options.document.visibilityState !== 'hidden' || this.unread) return;
    this.unread = true;
    this.baseTitle = this.options.document.title;
    this.blinkPhase = 0;
    this.blinkTogglesRemaining = BLINK_TOGGLE_COUNT;
    this.attachLifecycleListeners();
    this.attachObservers();
    this.writeMarkedTitle();
    this.ensureAttentionIcon();
    this.scheduleBlink();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearUnreadState();
  }

  private readonly onVisibilityChange = (): void => {
    if (this.options.document.visibilityState === 'visible') this.clearUnreadState();
  };

  private readonly onFocus = (): void => {
    if (this.options.document.visibilityState === 'visible') this.clearUnreadState();
  };

  private readonly onPageShow = (): void => {
    if (this.options.document.visibilityState === 'visible') this.clearUnreadState();
  };

  private readonly onPageHide = (event: Event): void => {
    if (!(event as PageTransitionEvent).persisted) this.dispose();
  };

  private attachLifecycleListeners(): void {
    this.options.document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.options.window.addEventListener('focus', this.onFocus);
    this.options.window.addEventListener('pageshow', this.onPageShow);
    this.options.window.addEventListener('pagehide', this.onPageHide);
  }

  private attachObservers(): void {
    try {
      const root = this.options.document.documentElement;
      if (root) {
        this.documentElementObserver = this.createObserver(() => this.onHeadStructureChanged());
        this.documentElementObserver.observe(root, { childList: true });
      }
      this.connectHeadObserver();
    } catch {
      this.headObserver?.disconnect();
      this.headObserver = null;
      this.documentElementObserver?.disconnect();
      this.documentElementObserver = null;
    }
  }

  private createObserver(callback: MutationCallback): MutationObserver {
    return this.options.createMutationObserver?.(callback) ?? new MutationObserver(callback);
  }

  private connectHeadObserver(): void {
    const head = this.options.document.head;
    if (head === this.observedHead) return;
    this.headObserver?.disconnect();
    this.observedHead = head;
    if (!head) return;
    this.headObserver ??= this.createObserver(() => this.onHeadMutated());
    this.headObserver.observe(head, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['rel', 'href', 'sizes'],
    });
  }

  private onHeadStructureChanged(): void {
    if (!this.unread) return;
    this.connectHeadObserver();
    this.syncTitleFromSite();
    this.ensureAttentionIcon();
  }

  private onHeadMutated(): void {
    if (!this.unread) return;
    this.syncTitleFromSite();
    this.ensureAttentionIcon();
  }

  private syncTitleFromSite(): void {
    const currentTitle = this.options.document.title;
    const currentElement = this.options.document.head?.querySelector('title') ?? null;
    if (currentElement === this.lastTitleElement && currentTitle === this.lastWrittenTitle) return;
    this.baseTitle = currentTitle;
    this.lastTitleElement = currentElement;
    this.titleElementCreatedByIndicator = false;
    this.writeMarkedTitle();
  }

  private writeMarkedTitle(): void {
    const head = this.options.document.head;
    let titleElement = head?.querySelector('title') as HTMLTitleElement | null ?? null;
    if (!titleElement && head) {
      titleElement = this.options.document.createElement('title') as HTMLTitleElement;
      this.titleElementCreatedByIndicator = true;
      head.appendChild(titleElement);
    }
    this.lastTitleElement = titleElement;
    this.lastWrittenTitle = `${TITLE_MARKER}${this.baseTitle}`;
    if (titleElement) titleElement.textContent = this.lastWrittenTitle;
    else this.options.document.title = this.lastWrittenTitle;
    if (!titleElement) this.lastWrittenTitle = this.options.document.title;
  }

  private ensureAttentionIcon(): void {
    const head = this.options.document.head;
    if (!head) return;
    const icon = this.iconLink ?? this.options.document.createElement('link') as HTMLLinkElement;
    this.iconLink = icon;
    const desiredHref = this.blinkPhase === 0 ? ATTENTION_ICON : ALTERNATE_ATTENTION_ICON;
    if (icon.rel !== 'icon') icon.rel = 'icon';
    if (icon.type !== 'image/svg+xml') icon.type = 'image/svg+xml';
    if (icon.getAttribute('sizes') !== '32x32') icon.setAttribute('sizes', '32x32');
    if (icon.href !== desiredHref) icon.href = desiredHref;
    if (icon.getAttribute('data-cpp-tab-completion-indicator') !== 'true') {
      icon.setAttribute('data-cpp-tab-completion-indicator', 'true');
    }
    if (icon.parentNode !== head || head.lastChild !== icon) head.appendChild(icon);
  }

  private scheduleBlink(): void {
    this.blinkTimer = this.options.window.setTimeout(() => {
      this.blinkTimer = undefined;
      if (!this.unread || this.disposed) return;
      this.blinkTogglesRemaining -= 1;
      this.blinkPhase = this.blinkPhase === 0 ? 1 : 0;
      if (this.blinkTogglesRemaining === 0) this.blinkPhase = 0;
      this.ensureAttentionIcon();
      if (this.blinkTogglesRemaining > 0) this.scheduleBlink();
    }, BLINK_INTERVAL_MS);
  }

  private clearUnreadState(): void {
    if (!this.unread) return;
    this.unread = false;
    if (this.blinkTimer !== undefined) this.options.window.clearTimeout(this.blinkTimer);
    this.blinkTimer = undefined;
    this.headObserver?.disconnect();
    this.documentElementObserver?.disconnect();
    this.headObserver = null;
    this.documentElementObserver = null;
    this.observedHead = null;
    this.options.document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.options.window.removeEventListener('focus', this.onFocus);
    this.options.window.removeEventListener('pageshow', this.onPageShow);
    this.options.window.removeEventListener('pagehide', this.onPageHide);
    this.iconLink?.remove();
    this.iconLink = null;
    this.restoreTitleIfOwnedValueIsStillCurrent();
    this.baseTitle = '';
    this.lastWrittenTitle = null;
    this.lastTitleElement = null;
    this.titleElementCreatedByIndicator = false;
    this.blinkPhase = 0;
    this.blinkTogglesRemaining = 0;
  }

  private restoreTitleIfOwnedValueIsStillCurrent(): void {
    const titleElement = this.options.document.head?.querySelector('title') ?? null;
    if (titleElement !== this.lastTitleElement || this.options.document.title !== this.lastWrittenTitle) return;
    if (this.titleElementCreatedByIndicator && this.baseTitle === '') titleElement?.remove();
    else if (titleElement) titleElement.textContent = this.baseTitle;
    else this.options.document.title = this.baseTitle;
  }
}
