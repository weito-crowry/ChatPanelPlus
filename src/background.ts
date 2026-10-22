import {
  createCodexWorkModeMessageHandler,
  removeCodexWorkModeEntriesForTab,
} from './background/codex-work-mode.ts';
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

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeCodexWorkModeEntriesForTab(chrome.storage.session, tabId);
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isOpenOptionsMessage(message)) {
    void chrome.runtime.openOptionsPage();
    return;
  }
  if (!isCodexWorkModeMessage(message)) return;
  void handleCodexWorkModeMessage(message, sender).then((response) => {
    sendResponse(response);
  }).catch(() => {
    sendResponse({ ok: false, reason: 'storage-error' });
  });
  return true;
});
