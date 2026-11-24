import {
  ANSWER_COMPLETION_SOUND_ROUTE,
  isAnswerCompletionSoundRouteResult,
  type AnswerCompletionSoundRequest,
  type OffscreenPlaybackResult,
} from '../shared/answer-completion-output-device-protocol.ts';

export interface OutputDeviceRuntimeLike {
  sendMessage(message: unknown): Promise<unknown>;
}

export async function routeAnswerCompletionSound(
  runtime: OutputDeviceRuntimeLike,
  sound: Omit<AnswerCompletionSoundRequest, 'type'>,
  playWithExistingDefaultPath: () => void,
  onError: (reason: string, playback?: OffscreenPlaybackResult) => void,
): Promise<void> {
  try {
    const response: unknown = await runtime.sendMessage({ type: ANSWER_COMPLETION_SOUND_ROUTE, ...sound });
    if (!isAnswerCompletionSoundRouteResult(response)) {
      onError('offscreen-failed');
      return;
    }
    if (!response.ok) {
      onError(response.reason, response.playback);
      return;
    }
    if (response.route === 'skipped') {
      if (response.reason === 'mute-unavailable') onError('mute-unavailable');
      return;
    }
    if (response.route === 'partial-device') {
      onError('partial-output', response.playback);
      return;
    }
    if (response.route === 'default') playWithExistingDefaultPath();
  } catch {
    onError('offscreen-failed');
  }
}
