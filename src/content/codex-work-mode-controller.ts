import type { CodexWorkModeRouteSource } from './codex-work-mode-route.ts';
import type {
  CodexWorkModeChange,
  CodexWorkModeReadResult,
  CodexWorkModeRepositoryLike,
} from '../shared/codex-work-mode-repository.ts';

export type CodexWorkModeControllerState =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly enabled: boolean; readonly saving: boolean; readonly notice?: 'write-failed' }
  | {
    readonly status: 'unknown';
    readonly reason: 'invalid-data' | 'storage-error';
    readonly saving: boolean;
    readonly actionFailed?: boolean;
  };

export class CodexWorkModeController {
  private current: CodexWorkModeControllerState = { status: 'loading' };
  private readonly listeners = new Set<(state: CodexWorkModeControllerState) => void>();
  private unsubscribeRepository: (() => void) | null = null;
  private unsubscribeRoute: (() => void) | null = null;
  private active = false;
  private generation = 0;
  private readSequence = 0;
  private storageRevision = 0;
  private currentConversationId: string | null = null;
  private routeInitialized = false;
  private readonly repository: CodexWorkModeRepositoryLike;
  private readonly route: CodexWorkModeRouteSource;

  constructor(repository: CodexWorkModeRepositoryLike, route: CodexWorkModeRouteSource) {
    this.repository = repository;
    this.route = route;
  }

  get state(): CodexWorkModeControllerState {
    return this.current;
  }

  subscribe(listener: (state: CodexWorkModeControllerState) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.generation += 1;
    this.readSequence += 1;
    this.storageRevision = 0;
    this.routeInitialized = false;
    this.currentConversationId = null;
    this.setState({ status: 'loading' });
    this.unsubscribeRepository = this.repository.subscribe((change) => this.handleRepositoryChange(change));
    this.unsubscribeRoute = this.route.subscribe((conversationId) => this.handleRouteChange(conversationId));
  }

  async toggle(): Promise<void> {
    this.syncRoute();
    if (this.current.status !== 'ready' || this.current.saving) return;
    await this.write(!this.current.enabled, 'toggle');
  }

  async retry(): Promise<void> {
    this.syncRoute();
    if (this.current.status !== 'unknown' || this.current.saving || !this.active || !this.currentConversationId) return;
    const generation = this.generation;
    this.readSequence += 1;
    this.setState({ status: 'loading' });
    await this.read(generation, this.currentConversationId);
  }

  async initializeOff(): Promise<void> {
    this.syncRoute();
    if (this.current.status !== 'unknown' || this.current.saving || !this.active) return;
    await this.write(false, 'initialize');
  }

  dispose(): void {
    this.active = false;
    this.generation += 1;
    this.readSequence += 1;
    this.unsubscribeRoute?.();
    this.unsubscribeRoute = null;
    this.unsubscribeRepository?.();
    this.unsubscribeRepository = null;
  }

  private handleRouteChange(conversationId: string | null): void {
    if (!this.active || (this.routeInitialized && conversationId === this.currentConversationId)) return;
    this.routeInitialized = true;
    this.currentConversationId = conversationId;
    this.generation += 1;
    this.readSequence += 1;
    this.storageRevision = 0;
    if (!conversationId) {
      this.setState({ status: 'unavailable' });
      return;
    }
    const generation = this.generation;
    this.setState({ status: 'loading' });
    void this.read(generation, conversationId);
  }

  private async read(generation: number, conversationId: string): Promise<void> {
    const sequence = ++this.readSequence;
    const revision = this.storageRevision;
    let result: CodexWorkModeReadResult;
    try {
      result = await this.repository.load(conversationId);
    } catch {
      result = { ok: false, reason: 'storage-error' };
    }
    if (!this.active) return;
    if (this.route.currentConversationId() !== this.currentConversationId) {
      this.handleRouteChange(this.route.currentConversationId());
      return;
    }
    if (generation !== this.generation || sequence !== this.readSequence
      || revision !== this.storageRevision || conversationId !== this.currentConversationId) return;
    this.setState(this.stateFromRead(result));
  }

  private async write(enabled: boolean, kind: 'toggle' | 'initialize'): Promise<void> {
    const previous = this.current;
    const conversationId = this.currentConversationId;
    if ((previous.status !== 'ready' && previous.status !== 'unknown') || previous.saving || !conversationId) return;
    const generation = this.generation;
    const revision = this.storageRevision;
    this.setState(previous.status === 'ready'
      ? { status: 'ready', enabled: previous.enabled, saving: true }
      : { ...previous, saving: true, actionFailed: false });

    let result;
    try {
      result = await this.repository.setEnabled(conversationId, enabled);
    } catch {
      result = { ok: false as const, reason: 'storage-error' as const };
    }
    if (!this.active) return;
    if (this.route.currentConversationId() !== this.currentConversationId) {
      this.handleRouteChange(this.route.currentConversationId());
      return;
    }
    if (generation !== this.generation || conversationId !== this.currentConversationId) return;
    if (revision === this.storageRevision) {
      if (result.ok) {
        this.setState({ status: 'ready', enabled: result.value.enabled, saving: false });
      } else if (kind === 'toggle' && previous.status === 'ready') {
        this.setState({ status: 'ready', enabled: previous.enabled, saving: false, notice: 'write-failed' });
      } else if (previous.status === 'unknown') {
        this.setState({ ...previous, saving: false, actionFailed: true });
      }
      return;
    }

    if (this.current.status === 'ready') {
      this.setState({
        status: 'ready',
        enabled: this.current.enabled,
        saving: false,
        ...(!result.ok ? { notice: 'write-failed' as const } : {}),
      });
    } else if (this.current.status === 'unknown') {
      this.setState({ ...this.current, saving: false, actionFailed: !result.ok });
    }
  }

  private handleRepositoryChange(change: CodexWorkModeChange): void {
    if (!this.active) return;
    if (this.route.currentConversationId() !== this.currentConversationId) {
      this.handleRouteChange(this.route.currentConversationId());
      return;
    }
    if (!this.routeInitialized || change.conversationId !== this.currentConversationId) return;
    this.storageRevision += 1;
    const saving = this.current.status !== 'loading' && this.current.status !== 'unavailable' && this.current.saving;
    this.setState(change.result.ok
      ? { status: 'ready', enabled: change.result.value.enabled, saving }
      : { status: 'unknown', reason: change.result.reason, saving });
  }

  private stateFromRead(result: CodexWorkModeReadResult): CodexWorkModeControllerState {
    return result.ok
      ? { status: 'ready', enabled: result.value.enabled, saving: false }
      : { status: 'unknown', reason: result.reason, saving: false };
  }

  private syncRoute(): void {
    if (!this.active) return;
    const current = this.route.currentConversationId();
    if (!this.routeInitialized || current !== this.currentConversationId) this.handleRouteChange(current);
  }

  private setState(state: CodexWorkModeControllerState): void {
    this.current = state;
    this.listeners.forEach((listener) => listener(state));
  }
}
