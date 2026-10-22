export interface AnswerCompletionNotificationActions {
  readonly notifyTab: () => void;
  readonly soundEnabled: boolean;
  readonly soundVolumePercent: number;
  readonly playSound: () => void;
}

export function dispatchAnswerCompletionNotifications(actions: AnswerCompletionNotificationActions): void {
  try { actions.notifyTab(); } catch { /* Visual notification failures must not affect sound playback. */ }
  if (!actions.soundEnabled || actions.soundVolumePercent <= 0) return;
  try { actions.playSound(); } catch { /* Sound failures must not affect the tab indicator. */ }
}
