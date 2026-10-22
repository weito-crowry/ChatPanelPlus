import {
  createCodexWorkModeMessageHandler,
  removeCodexWorkModeEntriesForTab,
} from './background/codex-work-mode.ts';
import { createOutputDevicePlaybackMessageHandler } from './background/answer-completion-output-device.ts';
import { createOffscreenAudioTransport } from './background/offscreen-audio-transport.ts';
import { createChromeSoundAssetRepository } from './shared/answer-completion-sound-assets.ts';
import { createChromeAnswerCompletionOutputDeviceRepository } from './shared/answer-completion-output-device.ts';
import { ANSWER_COMPLETION_SOUND_PREVIEW, ANSWER_COMPLETION_SOUND_ROUTE } from './shared/answer-completion-output-device-protocol.ts';
import { CODEX_WORK_MODE_GET, CODEX_WORK_MODE_SET } from './shared/codex-work-mode-protocol.ts';

type OpenOptionsMessage = Readonly<{ type: 'OPEN_OPTIONS' }>;

function isOpenOptionsMessage(message: unknown): message is OpenOptionsMessage {
  return typeof message === 'object' && message !== null && 'type' in message && message.type === 'OPEN_OPTIONS';
}

function isCodexWorkModeMessage(message: unknown): boolean {
  return typeof message === 'object' && message !== null && 'type' in message
    && (message.type === CODEX_WORK_MODE_GET || message.type === CODEX_WORK_MODE_SET);
}

const handleCodexWorkModeMessage = createCodexWorkModeMessageHandler(
  chrome.storage.session,
  chrome.runtime.id,
  (tabId, message) => chrome.tabs.sendMessage(tabId, message),
);

const outputDeviceRepository = createChromeAnswerCompletionOutputDeviceRepository();
const soundAssetRepository = createChromeSoundAssetRepository();
const offscreenTransport = typeof chrome.offscreen?.createDocument === 'function'
  && typeof chrome.runtime.getContexts === 'function'
  ? createOffscreenAudioTransport(chrome.offscreen, chrome.runtime, chrome.runtime.getURL('offscreen.html'))
  : null;
const handleOutputDevicePlayback = createOutputDevicePlaybackMessageHandler({
  loadOutputDevice: () => outputDeviceRepository.load(),
  loadAssets: () => soundAssetRepository.loadAssets(),
  playOffscreen: (request) => offscreenTransport
    ? offscreenTransport.play(request)
    : Promise.resolve({ ok: false, reason: 'playback-failed' }),
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeCodexWorkModeEntriesForTab(chrome.storage.session, tabId);
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isOpenOptionsMessage(message)) {
    void chrome.runtime.openOptionsPage();
    return;
  }
  if (typeof message === 'object' && message !== null && 'type' in message
    && (message.type === ANSWER_COMPLETION_SOUND_ROUTE || message.type === ANSWER_COMPLETION_SOUND_PREVIEW)) {
    void handleOutputDevicePlayback(message, sender, chrome.runtime.id).then((response) => {
      sendResponse(response ?? { ok: false, reason: 'invalid-request' });
    }).catch(() => sendResponse({ ok: false, reason: 'storage-failed' }));
    return true;
  }
  if (!isCodexWorkModeMessage(message)) return;
  void handleCodexWorkModeMessage(message, sender).then((response) => {
    sendResponse(response);
  }).catch(() => {
    sendResponse({ ok: false, reason: 'storage-error' });
  });
  return true;
});
