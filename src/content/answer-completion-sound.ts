import type { AssistantTurnState, TurnIdentity } from './conversation-statistics-dom.ts';
import { DEFAULT_COMPLETION_SOUND_ID, findBuiltinCompletionSound, isBuiltinCompletionSoundId } from '../shared/answer-completion-sound-definitions.ts';
import type { SoundAsset } from '../shared/answer-completion-sound-assets.ts';
import { createDocumentAudioContext } from '../shared/answer-completion-sound-playback.ts';

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
  private readonly loadAsset: (id: string) => Promise<SoundAsset | undefined>;
  private enabled = false;
  private context: AudioContext | null = null;
  private soundId = DEFAULT_COMPLETION_SOUND_ID;
  private playbackRevision = 0;

  constructor(
    document: Document,
    contextFactory: () => AudioContext | undefined = () => createDocumentAudioContext(document),
    loadAsset: (id: string) => Promise<SoundAsset | undefined> = async () => undefined,
  ) {
    this.document = document;
    this.contextFactory = contextFactory;
    this.loadAsset = loadAsset;
  }

  setSoundId(soundId: string): void {
    if (this.soundId === soundId) return;
    this.soundId = soundId;
    this.playbackRevision += 1;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.document.addEventListener('pointerdown', this.onUserGesture, true);
      this.document.addEventListener('keydown', this.onUserGesture, true);
      return;
    }
    this.playbackRevision += 1;
    this.document.removeEventListener('pointerdown', this.onUserGesture, true);
    this.document.removeEventListener('keydown', this.onUserGesture, true);
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') {
      try { void context.close().catch(() => {}); } catch { /* Closing audio must not affect the page. */ }
    }
  }

  dispose(): void {
    if (this.enabled) this.setEnabled(false);
    else this.closeContext();
  }

  play(): void {
    const context = this.context;
    if (!this.enabled || !context || context.state !== 'running') return;
    const soundId = this.soundId;
    if (isBuiltinCompletionSoundId(soundId)) {
      this.playBuiltin(context, soundId);
      return;
    }
    const revision = ++this.playbackRevision;
    void this.playUserSound(context, soundId, revision);
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

  private async playUserSound(context: AudioContext, soundId: string, revision: number): Promise<void> {
    try {
      const asset = await this.loadAsset(soundId);
      if (!this.canPlay(context, soundId, revision)) return;
      if (!asset || asset.id !== soundId) {
        this.playBuiltin(context, DEFAULT_COMPLETION_SOUND_ID);
        return;
      }
      const binary = atob(asset.data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const buffer = await context.decodeAudioData(bytes.buffer);
      if (!this.canPlay(context, soundId, revision)) return;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.setValueAtTime(0.045, context.currentTime);
      source.connect(gain);
      gain.connect(context.destination);
      source.start(context.currentTime);
    } catch {
      if (this.canPlay(context, soundId, revision)) this.playBuiltin(context, DEFAULT_COMPLETION_SOUND_ID);
    }
  }

  private canPlay(context: AudioContext, soundId: string, revision: number): boolean {
    return this.enabled && this.context === context && context.state === 'running'
      && this.soundId === soundId && this.playbackRevision === revision;
  }

  private playBuiltin(context: AudioContext, soundId: string): void {
    const sound = findBuiltinCompletionSound(soundId);
    try {
      const now = context.currentTime;
      for (const tone of sound.tones) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = now + tone.offsetSeconds;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(tone.frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.045, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.durationSeconds);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + tone.durationSeconds + 0.01);
      }
    } catch {
      // Audio failures must not affect the page or its controls.
    }
  }

  private closeContext(): void {
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') {
      try { void context.close().catch(() => {}); } catch { /* Closing audio must not affect the page. */ }
    }
  }
}
