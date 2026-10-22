import type { AssistantTurnState, TurnIdentity } from './conversation-statistics-dom.ts';

export interface AnswerCompletionEvent {
  readonly turnKey: string;
  readonly assistantMessageId: string;
}

interface TrackedTurn {
  assistantState: AssistantTurnState;
  activeCycle: boolean;
}

type AnswerCompletionIdentity = Pick<TurnIdentity, 'turnKey' | 'assistantMessageId'> & {
  readonly assistantState?: AssistantTurnState;
};

function validIdentity(identity: { readonly turnKey: string }): boolean {
  return identity.turnKey.length > 0 && identity.turnKey.length <= 1_024 && identity.turnKey.trim() === identity.turnKey;
}

export class AnswerCompletionTracker {
  private readonly turns = new Map<string, TrackedTurn>();

  reset(initialIdentities: readonly AnswerCompletionIdentity[]): void {
    this.turns.clear();
    for (const identity of initialIdentities) {
      if (!validIdentity(identity)) continue;
      const assistantState = identity.assistantState ?? 'unknown';
      this.turns.set(identity.turnKey, { assistantState, activeCycle: assistantState === 'in_progress' });
    }
  }

  observe(identity: AnswerCompletionIdentity): AnswerCompletionEvent | null {
    if (!validIdentity(identity)) return null;
    const assistantState = identity.assistantState ?? 'unknown';
    let tracked = this.turns.get(identity.turnKey);
    if (!tracked) {
      tracked = { assistantState, activeCycle: assistantState === 'in_progress' };
      this.turns.set(identity.turnKey, tracked);
      return null;
    }
    if (assistantState === 'unknown') return null;
    if (assistantState === 'in_progress') {
      if (tracked.assistantState !== 'in_progress') tracked.activeCycle = true;
      tracked.assistantState = 'in_progress';
      return null;
    }

    tracked.assistantState = 'complete';
    if (!tracked.activeCycle || !identity.assistantMessageId || identity.assistantMessageId.trim() !== identity.assistantMessageId) return null;
    tracked.activeCycle = false;
    return { turnKey: identity.turnKey, assistantMessageId: identity.assistantMessageId };
  }
}

export class AnswerCompletionSoundPlayer {
  private readonly document: Document;
  private readonly contextFactory: () => AudioContext | undefined;
  private enabled = false;
  private context: AudioContext | null = null;

  constructor(document: Document, contextFactory: () => AudioContext | undefined = () => {
    const AudioContextConstructor = document.defaultView?.AudioContext;
    return AudioContextConstructor ? new AudioContextConstructor() : undefined;
  }) {
    this.document = document;
    this.contextFactory = contextFactory;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.document.addEventListener('pointerdown', this.onUserGesture, true);
      this.document.addEventListener('keydown', this.onUserGesture, true);
      return;
    }
    this.document.removeEventListener('pointerdown', this.onUserGesture, true);
    this.document.removeEventListener('keydown', this.onUserGesture, true);
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') {
      try { void context.close().catch(() => {}); } catch { /* Closing audio must not affect the page. */ }
    }
  }

  dispose(): void {
    this.setEnabled(false);
  }

  play(): void {
    const context = this.context;
    if (!this.enabled || !context || context.state !== 'running') return;
    try {
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(660, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.17);
    } catch {
      // Audio failures must not affect the page or its controls.
    }
  }

  private readonly onUserGesture = (event: Event): void => {
    if (!this.enabled || !event.isTrusted) return;
    if (!this.context) {
      try {
        this.context = this.contextFactory() ?? null;
      } catch {
        return;
      }
    }
    if (!this.context) return;
    if (this.context.state === 'suspended') {
      try { void this.context.resume().catch(() => {}); } catch { /* Resuming audio must not affect the page. */ }
    }
  };
}
