import type {
  CodexWorkModeReadResult,
  CodexWorkModeRepository,
} from '../shared/codex-work-mode-repository.ts';

export type CodexWorkModeControllerState =
  | { readonly status: 'loading' }
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
  private unsubscribeStorage: (() => void) | null = null;
  private active = false;
  private generation = 0;
  private readSequence = 0;
  private storageRevision = 0;
  private readonly repository: CodexWorkModeRepository;

  constructor(repository: CodexWorkModeRepository) {
    this.repository = repository;
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
    const generation = ++this.generation;
    this.readSequence += 1;
    this.storageRevision = 0;
    this.setState({ status: 'loading' });
    this.unsubscribeStorage = this.repository.subscribe((result) => this.handleStorageChange(result));
    void this.read(generation);
  }

  async toggle(): Promise<void> {
    if (this.current.status !== 'ready' || this.current.saving) return;
    await this.write(!this.current.enabled, 'toggle');
  }

  async retry(): Promise<void> {
    if (this.current.status !== 'unknown' || this.current.saving || !this.active) return;
    const generation = this.generation;
    this.readSequence += 1;
    this.setState({ status: 'loading' });
    await this.read(generation);
  }

  async initializeOff(): Promise<void> {
    if (this.current.status !== 'unknown' || this.current.saving || !this.active) return;
    await this.write(false, 'initialize');
  }

  dispose(): void {
    this.active = false;
    this.generation += 1;
    this.readSequence += 1;
    this.unsubscribeStorage?.();
    this.unsubscribeStorage = null;
  }

  private async read(generation: number): Promise<void> {
    const sequence = ++this.readSequence;
    const revision = this.storageRevision;
    const result = await this.repository.load();
    if (!this.active || generation !== this.generation || sequence !== this.readSequence || revision !== this.storageRevision) return;
    this.setState(this.stateFromRead(result));
  }

  private async write(enabled: boolean, kind: 'toggle' | 'initialize'): Promise<void> {
    const previous = this.current;
    if ((previous.status !== 'ready' && previous.status !== 'unknown') || previous.saving) return;
    const generation = this.generation;
    const revision = this.storageRevision;
    this.setState(previous.status === 'ready'
      ? { ...previous, saving: true, notice: undefined }
      : { ...previous, saving: true, actionFailed: false });

    const result = await this.repository.setEnabled(enabled);
    if (!this.active || generation !== this.generation) return;
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

  private handleStorageChange(result: CodexWorkModeReadResult): void {
    this.storageRevision += 1;
    const saving = this.current.status !== 'loading' && this.current.saving;
    this.setState(result.ok
      ? { status: 'ready', enabled: result.value.enabled, saving }
      : { status: 'unknown', reason: result.reason, saving });
  }

  private stateFromRead(result: CodexWorkModeReadResult): CodexWorkModeControllerState {
    return result.ok
      ? { status: 'ready', enabled: result.value.enabled, saving: false }
      : { status: 'unknown', reason: result.reason, saving: false };
  }

  private setState(state: CodexWorkModeControllerState): void {
    this.current = state;
    this.listeners.forEach((listener) => listener(state));
  }
}
