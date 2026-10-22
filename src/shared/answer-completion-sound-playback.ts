import { DEFAULT_COMPLETION_SOUND_ID, findBuiltinCompletionSound, isBuiltinCompletionSoundId } from './answer-completion-sound-definitions.ts';
import type { SoundAsset, SoundFileLike } from './answer-completion-sound-assets.ts';

export type AudioContextFactory = () => AudioContext | undefined;

export function createDocumentAudioContext(document: Document): AudioContext | undefined {
  const AudioContextConstructor = document.defaultView?.AudioContext;
  return AudioContextConstructor ? new AudioContextConstructor() : undefined;
}

export async function decodeSoundFile(file: SoundFileLike, contextFactory: AudioContextFactory): Promise<{ readonly duration: number }> {
  return decodeSoundData(await file.arrayBuffer(), contextFactory);
}

export async function decodeSoundData(data: ArrayBuffer, contextFactory: AudioContextFactory): Promise<{ readonly duration: number }> {
  const context = contextFactory();
  if (!context) throw new Error('AudioContext is unavailable');
  try {
    return await context.decodeAudioData(data);
  } finally {
    if (context.state !== 'closed') {
      try { await context.close(); } catch { /* Decoding cleanup must not affect settings. */ }
    }
  }
}

function closeContext(context: AudioContext): void {
  if (context.state === 'closed') return;
  try { void context.close().catch(() => {}); } catch { /* Preview cleanup is best effort. */ }
}

function addAudioEndCleanup(context: AudioContext, source: AudioBufferSourceNode | OscillatorNode, duration: number): void {
  source.onended = () => closeContext(context);
  globalThis.setTimeout(() => closeContext(context), Math.ceil((duration + 0.5) * 1_000));
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function playBuiltin(context: AudioContext, soundId: string, volume: number): boolean {
  const sound = findBuiltinCompletionSound(soundId);
  const now = context.currentTime;
  let lastSource: OscillatorNode | null = null;
  try {
    for (const tone of sound.tones) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + tone.offsetSeconds;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(tone.frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.durationSeconds);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + tone.durationSeconds + 0.01);
      lastSource = oscillator;
    }
    if (lastSource) addAudioEndCleanup(context, lastSource, sound.durationSeconds);
    return lastSource !== null;
  } catch {
    return false;
  }
}

function playBuffer(context: AudioContext, buffer: AudioBuffer, volume: number): boolean {
  try {
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(volume, context.currentTime);
    source.connect(gain);
    gain.connect(context.destination);
    source.start(context.currentTime);
    addAudioEndCleanup(context, source, Math.min(buffer.duration, 5));
    return true;
  } catch {
    return false;
  }
}

export async function previewCompletionSound(
  document: Document,
  soundId: string,
  asset: SoundAsset | undefined,
  contextFactory: AudioContextFactory = () => createDocumentAudioContext(document),
): Promise<boolean> {
  let context: AudioContext | undefined;
  try {
    context = contextFactory();
    if (!context) return false;
    // Call resume before awaiting anything so the explicit Options click supplies the activation.
    const resumed = context.state === 'suspended' ? context.resume() : Promise.resolve();
    await resumed;
    if (asset && asset.id === soundId) {
      try {
        const buffer = await context.decodeAudioData(base64ToArrayBuffer(asset.data));
        if (playBuffer(context, buffer, 0.045)) return true;
      } catch {
        // Invalid custom data previews as the stable built-in default.
      }
    }
    const played = playBuiltin(context, isBuiltinCompletionSoundId(soundId) ? soundId : DEFAULT_COMPLETION_SOUND_ID, 0.045);
    if (!played) closeContext(context);
    return played;
  } catch {
    if (context) closeContext(context);
    return false;
  }
}
