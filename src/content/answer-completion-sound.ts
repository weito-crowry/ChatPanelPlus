import type { AssistantTurnState, TurnIdentity } from './conversation-statistics-dom.ts';
import { DEFAULT_COMPLETION_SOUND_ID, findBuiltinCompletionSound, isBuiltinCompletionSoundId } from '../shared/answer-completion-sound-definitions.ts';
import type { SoundAsset } from '../shared/answer-completion-sound-assets.ts';
import {
  answerCompletionSoundGain,
  DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT,
  SILENT_RAMP_GAIN,
} from '../shared/answer-completion-sound-volume.ts';
import { createDocumentAudioContext } from '../shared/answer-completion-sound-playback.ts';

export interface AnswerCompletionEvent {
  readonly turnKey: string;
  readonly assistantMessageId: string;
}

export type AnswerCompletionCheckReason = 'no-active-cycle' | 'assistant-message-unavailable';
export type AnswerCompletionObservation = Readonly<{ checked: false; event: null }>
  | Readonly<{ checked: true; eventDetected: false; reason: AnswerCompletionCheckReason; event: null }>
  | Readonly<{ checked: true; eventDetected: true; reason: null; event: AnswerCompletionEvent }>;

interface TrackedTurn {
  assistantState: AssistantTurnState;
  activeCycle: boolean;
  completionCheckReported: boolean;
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
      this.turns.set(identity.turnKey, {
        assistantState, activeCycle: assistantState === 'in_progress', completionCheckReported: false,
      });
    }
  }

  observe(identity: AnswerCompletionIdentity): AnswerCompletionEvent | null {
    return this.observeDetailed(identity).event;
  }

  observeDetailed(identity: AnswerCompletionIdentity): AnswerCompletionObservation {
    if (!validIdentity(identity)) return { checked: false, event: null };
    const assistantState = identity.assistantState ?? 'unknown';
    let tracked = this.turns.get(identity.turnKey);
    if (!tracked) {
      tracked = {
        assistantState, activeCycle: assistantState === 'in_progress', completionCheckReported: assistantState === 'complete',
      };
      this.turns.set(identity.turnKey, tracked);
      return assistantState === 'complete'
        ? { checked: true, eventDetected: false, reason: 'no-active-cycle', event: null }
        : { checked: false, event: null };
    }
    if (assistantState === 'unknown') return { checked: false, event: null };
    if (assistantState === 'in_progress') {
      if (tracked.assistantState !== 'in_progress') {
        tracked.activeCycle = true;
        tracked.completionCheckReported = false;
      }
      tracked.assistantState = 'in_progress';
      return { checked: false, event: null };
    }

    const changedToComplete = tracked.assistantState !== 'complete';
    tracked.assistantState = 'complete';
    if (!tracked.activeCycle) {
      if (!changedToComplete || tracked.completionCheckReported) return { checked: false, event: null };
      tracked.completionCheckReported = true;
      return { checked: true, eventDetected: false, reason: 'no-active-cycle', event: null };
    }
    if (!identity.assistantMessageId || identity.assistantMessageId.trim() !== identity.assistantMessageId) {
      if (tracked.completionCheckReported) return { checked: false, event: null };
      tracked.completionCheckReported = true;
      return { checked: true, eventDetected: false, reason: 'assistant-message-unavailable', event: null };
    }
    tracked.activeCycle = false;
    tracked.completionCheckReported = false;
    const event = { turnKey: identity.turnKey, assistantMessageId: identity.assistantMessageId };
    return { checked: true, eventDetected: true, reason: null, event };
  }
}

export class AnswerCompletionSoundPlayer {
  private readonly document: Document;
  private readonly contextFactory: () => AudioContext | undefined;
  private readonly loadAsset: (id: string) => Promise<SoundAsset | undefined>;
  private enabled = false;
  private context: AudioContext | null = null;
  private soundId = DEFAULT_COMPLETION_SOUND_ID;
  private volumePercent = DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT;
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

  setVolumePercent(volumePercent: number): void {
    if (this.volumePercent === volumePercent) return;
    this.volumePercent = volumePercent;
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
    if (!this.enabled || answerCompletionSoundGain(this.volumePercent) === 0 || !context || context.state !== 'running') return;
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
      gain.gain.setValueAtTime(answerCompletionSoundGain(this.volumePercent), context.currentTime);
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
    const peak = answerCompletionSoundGain(this.volumePercent);
    if (peak === 0) return;
    try {
      const now = context.currentTime;
      for (const tone of sound.tones) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = now + tone.offsetSeconds;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(tone.frequency, start);
        gain.gain.setValueAtTime(SILENT_RAMP_GAIN, start);
        gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(SILENT_RAMP_GAIN, start + tone.durationSeconds);
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
