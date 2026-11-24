import {
  OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND,
  isOffscreenAnswerCompletionSoundRequest,
  isOffscreenPlaybackResult,
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
  const failure = (outputCount: number): OffscreenPlaybackResult => ({
    ok: false, status: 'failed', outputCount, succeededCount: 0,
    failures: Array.from({ length: Math.max(1, outputCount) }, () => 'playback-failed'),
  });

  async function ensureDocument(): Promise<void> {
    const filter = { contextTypes: ['OFFSCREEN_DOCUMENT'] as `${chrome.runtime.ContextType}`[], documentUrls: [offscreenUrl] };
    if ((await runtime.getContexts(filter)).length > 0) return;
    if (!creating) {
      creating = offscreen.createDocument({
        url: offscreenUrl,
        reasons: ['AUDIO_PLAYBACK'],
        justification: '回答完了音とCodexBridge監視通知を既存設定の出力先で再生するため',
      }).finally(() => { creating = null; });
    }
    await creating;
    if ((await runtime.getContexts(filter)).length === 0) throw new Error('Offscreen document is unavailable');
  }

  return {
    async play(request) {
      if (request.type !== OFFSCREEN_PLAY_ANSWER_COMPLETION_SOUND || !isOffscreenAnswerCompletionSoundRequest(request)) return failure(1);
      try {
        await ensureDocument();
        const result = await runtime.sendMessage(request);
        return isOffscreenPlaybackResult(result) ? result : failure(request.deviceIds.length);
      } catch {
        return failure(request.deviceIds.length);
      }
    },
  };
}
