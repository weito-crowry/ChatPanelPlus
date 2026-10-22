export interface SoundTone {
  readonly frequency: number;
  readonly offsetSeconds: number;
  readonly durationSeconds: number;
}

export interface BuiltinCompletionSound {
  readonly id: string;
  readonly label: string;
  readonly tones: readonly SoundTone[];
  readonly durationSeconds: number;
}

export const BUILTIN_COMPLETION_SOUNDS: readonly BuiltinCompletionSound[] = Object.freeze([
  {
    id: 'tone-660',
    label: '短音（660 Hz）',
    tones: [{ frequency: 660, offsetSeconds: 0, durationSeconds: 0.17 }],
    durationSeconds: 0.18,
  },
  {
    id: 'soft-chime',
    label: 'やわらかい音',
    tones: [{ frequency: 523.25, offsetSeconds: 0, durationSeconds: 0.24 }],
    durationSeconds: 0.25,
  },
  {
    id: 'two-tone',
    label: '2音',
    tones: [
      { frequency: 587.33, offsetSeconds: 0, durationSeconds: 0.13 },
      { frequency: 783.99, offsetSeconds: 0.14, durationSeconds: 0.18 },
    ],
    durationSeconds: 0.34,
  },
]);

export const DEFAULT_COMPLETION_SOUND_ID = BUILTIN_COMPLETION_SOUNDS[0]!.id;

export function isBuiltinCompletionSoundId(value: string): boolean {
  return BUILTIN_COMPLETION_SOUNDS.some(({ id }) => id === value);
}

export function isUserCompletionSoundId(value: string): boolean {
  return /^user-[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);
}

export function findBuiltinCompletionSound(id: string) {
  return BUILTIN_COMPLETION_SOUNDS.find((sound) => sound.id === id)
    ?? BUILTIN_COMPLETION_SOUNDS[0]!;
}
