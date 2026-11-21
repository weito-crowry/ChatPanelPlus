import {
  createCodexWorkModeMessageHandler,
  removeCodexWorkModeEntriesForTab,
} from './background/codex-work-mode.ts';
import {
  ConversationAudioMuteStore,
  createConversationAudioMuteMessageHandler,
  removeConversationAudioMuteEntriesForTab,
} from './background/conversation-audio-mute.ts';
import { createOutputDevicePlaybackMessageHandler } from './background/answer-completion-output-device.ts';
import { createOffscreenAudioTransport } from './background/offscreen-audio-transport.ts';
import { createChromeSoundAssetRepository } from './shared/answer-completion-sound-assets.ts';
import { createChromeAnswerCompletionOutputDeviceRepository } from './shared/answer-completion-output-device.ts';
import { ANSWER_COMPLETION_SOUND_PREVIEW, ANSWER_COMPLETION_SOUND_ROUTE } from './shared/answer-completion-output-device-protocol.ts';
import { CODEX_WORK_MODE_GET, CODEX_WORK_MODE_SET } from './shared/codex-work-mode-protocol.ts';
import { conversationAudioMuteRequestType } from './shared/conversation-audio-mute-protocol.ts';
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
  CODEX_BRIDGE_WATCH_ACK_EVENTS,
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

function isConversationAudioMuteMessage(message: unknown): boolean {
  return conversationAudioMuteRequestType(message) !== null;
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
    && (message.type === CODEX_BRIDGE_WATCH_ACK_EVENTS || message.type === CODEX_BRIDGE_WATCH_START || message.type === CODEX_BRIDGE_WATCH_STOP
      || message.type === CODEX_BRIDGE_WATCH_LIST || message.type === CODEX_BRIDGE_WATCH_READ
      || message.type === CODEX_BRIDGE_WATCH_FOREGROUND_REFRESH
      || message.type === CODEX_BRIDGE_WATCH_READ_FINAL_ANSWER);
}

const handleCodexWorkModeMessage = createCodexWorkModeMessageHandler(
  chrome.storage.session,
  chrome.runtime.id,
  (tabId, message) => chrome.tabs.sendMessage(tabId, message),
);
const conversationAudioMuteStore = new ConversationAudioMuteStore(chrome.storage.session);
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
  loadConversationMute: async (sender, conversationId) => {
    const tabId = sender.tab?.id;
    if (!Number.isSafeInteger(tabId) || (tabId ?? -1) < 0) return { ok: false };
    const loaded = await conversationAudioMuteStore.load(tabId!, conversationId);
    return loaded.ok ? { ok: true, muted: loaded.value.muted } : { ok: false };
  },
  playOffscreenWithMuteGuard: async (sender, conversationId, request) => {
    const tabId = sender.tab?.id;
    if (!Number.isSafeInteger(tabId) || (tabId ?? -1) < 0 || !offscreenTransport) return { ok: false, reason: 'mute-unavailable' };
    const result = await conversationAudioMuteStore.runIfUnmuted(tabId!, conversationId, () => offscreenTransport.play(request));
    return result.ok ? { ok: true, result: result.value } : {
      ok: false,
      reason: result.reason === 'muted' ? 'muted' : 'mute-unavailable',
    };
  },
  playOffscreen: (request) => offscreenTransport
    ? offscreenTransport.play(request)
    : Promise.resolve({ ok: false, reason: 'playback-failed' }),
});
const notification = createCodexBridgeNotificationHandler({
  settings: createChromeSettingsRepository(),
  outputDevice: outputDeviceRepository,
  assets: soundAssetRepository,
  audio: offscreenTransport,
  loadOwnerMute: async (event) => {
    if (event.ownerTabId === undefined || event.ownerConversationId === undefined || event.ownerMuted === undefined) return { ok: false };
    const loaded = await conversationAudioMuteStore.load(event.ownerTabId, event.ownerConversationId);
    if (!loaded.ok) return { ok: false };
    return { ok: true, muted: loaded.saved ? loaded.value.muted : event.ownerMuted };
  },
  playWithOwnerMuteGuard: async (event, action) => {
    if (event.ownerTabId === undefined || event.ownerConversationId === undefined) return { ok: false, reason: 'owner-unavailable' };
    const result = await conversationAudioMuteStore.runIfOwnerUnmuted(
      event.ownerTabId, event.ownerConversationId, event.ownerMuted, action,
    );
    if (!result.ok) return { ok: false, reason: result.reason === 'muted' ? 'muted' : 'owner-unavailable' };
    return result.value;
  },
});
const codexBridgeThreadMonitor = createDefaultCodexBridgeThreadMonitor(chrome.runtime.id, notification, async (tabId, conversationId) => {
  const mute = await conversationAudioMuteStore.load(tabId, conversationId);
  return mute.ok ? { ok: true, muted: mute.value.muted, revision: mute.value.revision } : { ok: false };
});
const handleConversationAudioMute = createConversationAudioMuteMessageHandler(
  conversationAudioMuteStore,
  chrome.runtime.id,
  async (tabId, conversationId, value) => codexBridgeThreadMonitor.monitor.updateOwnerMute(
    tabId, conversationId, value.muted, value.revision,
  ),
);

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
  void removeConversationAudioMuteEntriesForTab(chrome.storage.session, tabId, async (conversationId, value) => {
    await codexBridgeThreadMonitor.monitor.updateOwnerMute(tabId, conversationId, value?.muted ?? null, value?.revision);
  }).catch(() => {});
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
  if (isConversationAudioMuteMessage(message)) {
    void handleConversationAudioMute(message, sender).then((response) => {
      sendResponse(response ?? { ok: false, reason: 'storage-error' });
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
