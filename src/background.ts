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
import {
  CODEX_BRIDGE_MCP_GET_STATUS,
  CODEX_BRIDGE_MCP_GET_TARGETS,
  CODEX_BRIDGE_MCP_GET_THREADS,
  CODEX_BRIDGE_MCP_TEST_MESSAGE,
} from './shared/codexbridge-mcp-protocol.ts';
import { createCodexBridgeMcpTestHandler } from './background/codexbridge-mcp.ts';
import { createDefaultCodexBridgePanelHandler } from './background/codexbridge-panel.ts';
import { createCodexBridgeNotificationHandler } from './background/codexbridge-notifications.ts';
import { createChromeSettingsRepository } from './shared/settings-repository.ts';
import {
  CODEX_BRIDGE_THREAD_MONITOR_ALARM,
  CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH,
  CODEX_BRIDGE_WATCH_LIST,
  CODEX_BRIDGE_WATCH_READ,
  CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER,
  CODEX_BRIDGE_WATCH_START,
  CODEX_BRIDGE_WATCH_STOP,
} from './shared/codexbridge-thread-monitor-protocol.ts';
import { createDefaultCodexBridgeThreadMonitor } from './background/codexbridge-thread-monitor.ts';

type OpenOptionsMessage = Readonly<{ type: 'OPEN_OPTIONS' }>;

function isOpenOptionsMessage(message: unknown): message is OpenOptionsMessage {
  return typeof message === 'object' && message !== null && 'type' in message && message.type === 'OPEN_OPTIONS';
}

function isCodexWorkModeMessage(message: unknown): boolean {
  return typeof message === 'object' && message !== null && 'type' in message
    && (message.type === CODEX_WORK_MODE_GET || message.type === CODEX_WORK_MODE_SET);
}

function isCodexBridgeMcpTestMessage(message: unknown): boolean {
  return typeof message === 'object' && message !== null && 'type' in message
    && message.type === CODEX_BRIDGE_MCP_TEST_MESSAGE;
}

function isCodexBridgePanelMessage(message: unknown): boolean {
  return typeof message === 'object' && message !== null && 'type' in message
    && (message.type === CODEX_BRIDGE_MCP_GET_TARGETS
      || message.type === CODEX_BRIDGE_MCP_GET_THREADS
      || message.type === CODEX_BRIDGE_MCP_GET_STATUS);
}

function isCodexBridgeWatchMessage(message: unknown): boolean {
  return typeof message === 'object' && message !== null && 'type' in message
    && (message.type === CODEX_BRIDGE_WATCH_START || message.type === CODEX_BRIDGE_WATCH_STOP
      || message.type === CODEX_BRIDGE_WATCH_LIST || message.type === CODEX_BRIDGE_WATCH_READ
      || message.type === CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH
      || message.type === CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER);
}

const handleCodexWorkModeMessage = createCodexWorkModeMessageHandler(
  chrome.storage.session,
  chrome.runtime.id,
  (tabId, message) => chrome.tabs.sendMessage(tabId, message),
);
const handleCodexBridgeMcpTest = createCodexBridgeMcpTestHandler({
  sessionStorage: chrome.storage.session,
  permissions: chrome.permissions,
  extensionId: chrome.runtime.id,
  optionsPageUrl: chrome.runtime.getURL('index.html'),
});
const handleCodexBridgePanel = createDefaultCodexBridgePanelHandler(chrome.runtime.id);

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
const notification = createCodexBridgeNotificationHandler({
  settings: createChromeSettingsRepository(),
  outputDevice: outputDeviceRepository,
  assets: soundAssetRepository,
  audio: offscreenTransport,
});
const codexBridgeThreadMonitor = createDefaultCodexBridgeThreadMonitor(chrome.runtime.id, notification);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CODEX_BRIDGE_THREAD_MONITOR_ALARM) {
    void codexBridgeThreadMonitor.monitor.refreshAlarm().catch(() => {});
  }
});
chrome.runtime.onStartup.addListener(() => {
  void codexBridgeThreadMonitor.monitor.restore().catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => {
  void codexBridgeThreadMonitor.monitor.restore().catch(() => {});
});
void codexBridgeThreadMonitor.monitor.restore().catch(() => {});

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeCodexWorkModeEntriesForTab(chrome.storage.session, tabId);
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isOpenOptionsMessage(message)) {
    void chrome.runtime.openOptionsPage();
    return;
  }
  if (isCodexBridgeMcpTestMessage(message)) {
    void handleCodexBridgeMcpTest(message, sender).then((response) => {
      sendResponse(response ?? { ok: false, reason: 'unknown-error' });
    }).catch(() => sendResponse({ ok: false, reason: 'unknown-error' }));
    return true;
  }
  if (isCodexBridgePanelMessage(message)) {
    void handleCodexBridgePanel(message, sender).then((response) => {
      sendResponse(response ?? { ok: false, reason: 'protocol-error' });
    }).catch(() => sendResponse({ ok: false, reason: 'unknown-error' }));
    return true;
  }
  if (isCodexBridgeWatchMessage(message)) {
    void codexBridgeThreadMonitor.handleMessage(message, sender).then((response) => {
      sendResponse(response ?? { ok: false, reason: 'invalid-request' });
    }).catch(() => sendResponse({ ok: false, reason: 'storage-error' }));
    return true;
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
