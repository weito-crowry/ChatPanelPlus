import {
  OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND,
  type OffscreenAnswerCompletionSoundRequest,
  type OffscreenPlaybackResult,
} from '../shared/answer-completion-output-device-protocol.ts';

interface OffscreenApiLike {
  createDocument(options: {
    readonly url: string;
    readonly reasons: `${chrome.offscreen.Reason}`[];
    readonly justification: string;
  }): Promise<void>;
}

interface RuntimeContextLike {
  getContexts(filter: {
    readonly contextTypes: `${chrome.runtime.ContextType}`[];
    readonly documentUrls: string[];
  }): Promise<readonly unknown[]>;
  sendMessage(message: unknown): Promise<unknown>;
}

export interface OffscreenAudioTransport {
  play(request: OffscreenAnswerCompletionSoundRequest): Promise<OffscreenPlaybackResult>;
}

export function createOffscreenAudioTransport(
  offscreen: OffscreenApiLike,
  runtime: RuntimeContextLike,
  offscreenUrl: string,
): OffscreenAudioTransport {
  let creating: Promise<void> | null = null;

  async function ensureDocument(): Promise<void> {
    const filter = { contextTypes: ['OFFSCREEN_DOCUMENT'] as `${chrome.runtime.ContextType}`[], documentUrls: [offscreenUrl] };
    if ((await runtime.getContexts(filter)).length > 0) return;
    if (!creating) {
      creating = offscreen.createDocument({
        url: offscreenUrl,
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'ユーザーが指定した出力デバイスで回答完了音を再生するため',
      }).finally(() => { creating = null; });
    }
    await creating;
    if ((await runtime.getContexts(filter)).length === 0) throw new Error('Offscreen document is unavailable');
  }

  return {
    async play(request) {
      if (request.type !== OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND) return { ok: false, reason: 'playback-failed' };
      try {
        await ensureDocument();
        const result = await runtime.sendMessage(request);
        if (typeof result === 'object' && result !== null && 'ok' in result && result.ok === true) return { ok: true };
        if (typeof result === 'object' && result !== null && 'reason' in result
          && (result.reason === 'device-unavailable' || result.reason === 'permission-denied'
            || result.reason === 'sink-failed' || result.reason === 'playback-failed')) {
          return { ok: false, reason: result.reason };
        }
        return { ok: false, reason: 'playback-failed' };
      } catch {
        return { ok: false, reason: 'playback-failed' };
      }
    },
  };
}
