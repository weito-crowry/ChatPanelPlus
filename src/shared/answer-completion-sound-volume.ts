export const MIN_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT = 0;
export const MAX_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT = 100;
export const DEFAULT_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT = 60;
export const MAX_ANSWER_COMPLETION_SOUND_GAIN = 0.3;
export const SILENT_RAMP_GAIN = 0.0001;

export function answerCompletionSoundGain(volumePercent: number): number {
  if (!Number.isInteger(volumePercent)
    || volumePercent < MIN_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT
    || volumePercent > MAX_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT) return 0;
  return (volumePercent / MAX_ANSWER_COMPLETION_SOUND_VOLUME_PERCENT) * MAX_ANSWER_COMPLETION_SOUND_GAIN;
}
