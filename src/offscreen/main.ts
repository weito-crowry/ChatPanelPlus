import { isTrustedOffscreenSender, playAnswerCompletionSoundOffscreen } from './answer-completion-audio.ts';
import { isOffscreenAnswerCompletionSoundRequest } from '../shared/answer-completion-output-device-protocol.ts';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isOffscreenAnswerCompletionSoundRequest(message)) return;
  if (!isTrustedOffscreenSender(sender, chrome.runtime.id)) {
    sendResponse({ ok: false, reason: 'playback-failed' });
    return false;
  }
  void playAnswerCompletionSoundOffscreen(message).then(sendResponse).catch(() => {
    sendResponse({ ok: false, reason: 'playback-failed' });
  });
  return true;
});
