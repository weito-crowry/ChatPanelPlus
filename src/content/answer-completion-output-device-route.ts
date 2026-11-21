import {
  ANSWER_COMPLETION_SOUND_ROUTE,
  type AnswerCompletionSoundRequest,
  type AnswerCompletionSoundRouteResult,
} from '../shared/answer-completion-output-device-protocol.ts';

export interface OutputDeviceRuntimeLike {
  sendMessage(message: unknown): Promise<unknown>;
}

function isRouteResult(value: unknown): value is AnswerCompletionSoundRouteResult {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false;
  if (value.ok === true) return 'route' in value
    && (value.route === 'default' || value.route === 'device'
      || (value.route === 'skipped' && 'reason' in value && (value.reason === 'muted' || value.reason === 'mute-unavailable')));
  return 'reason' in value && typeof value.reason === 'string';
}

export async function routeAnswerCompletionSound(
  runtime: OutputDeviceRuntimeLike,
  sound: Omit<AnswerCompletionSoundRequest, 'type'>,
  playWithExistingDefaultPath: () => void,
  onError: (reason: string) => void,
): Promise<void> {
  try {
    const response: unknown = await runtime.sendMessage({ type: ANSWER_COMPLETION_SOUND_ROUTE, ...sound });
    if (!isRouteResult(response)) {
      onError('offscreen-failed');
      return;
    }
    if (!response.ok) {
      onError(response.reason);
      return;
    }
    if (response.route === 'skipped') {
      if (response.reason === 'mute-unavailable') onError('mute-unavailable');
      return;
    }
    if (response.route === 'default') playWithExistingDefaultPath();
  } catch {
    onError('offscreen-failed');
  }
}
