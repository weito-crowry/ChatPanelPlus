import { DEFAULT_COMPLETION_SOUND_ID, findBuiltinCompletionSound } from '../shared/answer-completion-sound-definitions.ts';
import { MAX_SOUND_ASSET_DURATION_SECONDS, type SoundAsset } from '../shared/answer-completion-sound-assets.ts';
import { isOffscreenAnswerCompletionSoundRequest, type OffscreenPlaybackResult } from '../shared/answer-completion-output-device-protocol.ts';
import { answerCompletionSoundGain, SILENT_RAMP_GAIN } from '../shared/answer-completion-sound-volume.ts';

export type OffscreenAudioContextFactory = () => AudioContext | undefined;
type SinkAudioContext = AudioContext & { setSinkId?: (deviceId: string) => Promise<void> };

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function closeContext(context: AudioContext): void {
  if (context.state === 'closed') return;
  try { void context.close().catch(() => {}); } catch { /* Audio cleanup must not affect extension messaging. */ }
}

function attachCleanup(context: AudioContext, source: AudioBufferSourceNode | OscillatorNode, duration: number): void {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    globalThis.clearTimeout(timeout);
    closeContext(context);
  };
  const timeout = globalThis.setTimeout(cleanup, Math.ceil((duration + 0.75) * 1_000));
  source.onended = cleanup;
}

function playBuiltin(context: AudioContext, soundId: string, gainValue: number): number | null {
  const sound = findBuiltinCompletionSound(soundId);
  const now = context.currentTime;
  let lastSource: OscillatorNode | null = null;
  try {
    for (const tone of sound.tones) {
      const source = context.createOscillator();
      const gain = context.createGain();
      const start = now + tone.offsetSeconds;
      source.type = 'sine';
      source.frequency.setValueAtTime(tone.frequency, start);
      gain.gain.setValueAtTime(SILENT_RAMP_GAIN, start);
      gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(SILENT_RAMP_GAIN, start + tone.durationSeconds);
      source.connect(gain);
      gain.connect(context.destination);
      source.start(start);
      source.stop(start + tone.durationSeconds + 0.01);
      lastSource = source;
    }
  } catch {
    return null;
  }
  if (!lastSource) return null;
  attachCleanup(context, lastSource, sound.durationSeconds);
  return sound.durationSeconds;
}

async function playAsset(context: AudioContext, asset: SoundAsset, gainValue: number): Promise<number | null> {
  try {
    const buffer = await context.decodeAudioData(base64ToArrayBuffer(asset.data));
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(gainValue, context.currentTime);
    source.connect(gain);
    gain.connect(context.destination);
    source.start(context.currentTime);
    const duration = Math.min(buffer.duration, MAX_SOUND_ASSET_DURATION_SECONDS);
    attachCleanup(context, source, duration);
    return duration;
  } catch {
    return null;
  }
}

function sinkFailure(error: unknown): OffscreenPlaybackResult {
  if (error instanceof DOMException && error.name === 'NotFoundError') return { ok: false, reason: 'device-unavailable' };
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
    return { ok: false, reason: 'permission-denied' };
  }
  return { ok: false, reason: 'sink-failed' };
}

export async function playAnswerCompletionSoundOffscreen(
  request: unknown,
  contextFactory: OffscreenAudioContextFactory = () => typeof AudioContext === 'undefined' ? undefined : new AudioContext(),
): Promise<OffscreenPlaybackResult> {
  if (!isOffscreenAnswerCompletionSoundRequest(request)) return { ok: false, reason: 'playback-failed' };
  const volume = answerCompletionSoundGain(request.volumePercent);
  if (volume === 0) return { ok: false, reason: 'playback-failed' };
  const context = contextFactory() as SinkAudioContext | undefined;
  if (!context) return { ok: false, reason: 'playback-failed' };
  if (typeof context.setSinkId !== 'function') {
    closeContext(context);
    return { ok: false, reason: 'sink-failed' };
  }
  try {
    await context.setSinkId(request.deviceId);
  } catch (error) {
    closeContext(context);
    return sinkFailure(error);
  }
  try {
    if (context.state === 'suspended') await context.resume();
    if (context.state !== 'running') {
      closeContext(context);
      return { ok: false, reason: 'playback-failed' };
    }
    const asset = request.asset?.id === request.soundId ? request.asset : undefined;
    const duration = asset ? await playAsset(context, asset, volume) : null;
    if (duration !== null) return { ok: true };
    const builtinDuration = playBuiltin(context, asset ? DEFAULT_COMPLETION_SOUND_ID : request.soundId, volume);
    if (builtinDuration === null) {
      closeContext(context);
      return { ok: false, reason: 'playback-failed' };
    }
    return { ok: true };
  } catch {
    closeContext(context);
    return { ok: false, reason: 'playback-failed' };
  }
}

export function isTrustedOffscreenSender(sender: { readonly id?: string; readonly url?: string }, extensionId: string): boolean {
  return sender.id === extensionId && sender.url === `chrome-extension://${extensionId}/background.js`;
}
