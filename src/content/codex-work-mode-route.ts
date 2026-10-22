import { conversationIdFromPath } from '../shared/conversation-route.ts';

export interface CodexWorkModeRouteSource {
  currentConversationId(): string | null;
  subscribe(listener: (conversationId: string | null) => void): () => void;
}

const ROUTE_POLL_MS = 250;

class CodexWorkModeRouteObserver implements CodexWorkModeRouteSource {
  private readonly window: Window;
  private readonly listeners = new Set<(conversationId: string | null) => void>();
  private interval: number | undefined;
  private conversationId: string | null = null;
  private initialized = false;

  constructor(window: Window) {
    this.window = window;
  }

  currentConversationId(): string | null {
    return conversationIdFromPath(this.window.location.pathname);
  }

  subscribe(listener: (conversationId: string | null) => void): () => void {
    const first = this.listeners.size === 0;
    this.listeners.add(listener);
    if (first) {
      this.window.addEventListener('popstate', this.onNavigation);
      this.window.addEventListener('pageshow', this.onNavigation);
      this.interval = this.window.setInterval(this.onNavigation, ROUTE_POLL_MS);
      this.checkRoute();
    } else {
      listener(this.conversationId);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  private readonly onNavigation = (): void => this.checkRoute();

  private checkRoute(): void {
    const nextId = this.currentConversationId();
    if (this.initialized && nextId === this.conversationId) return;
    this.initialized = true;
    this.conversationId = nextId;
    this.listeners.forEach((listener) => listener(nextId));
  }

  private stop(): void {
    this.window.removeEventListener('popstate', this.onNavigation);
    this.window.removeEventListener('pageshow', this.onNavigation);
    if (this.interval !== undefined) this.window.clearInterval(this.interval);
    this.interval = undefined;
    this.initialized = false;
  }
}

export function createCodexWorkModeRouteObserver(window: Window): CodexWorkModeRouteSource {
  return new CodexWorkModeRouteObserver(window);
}
