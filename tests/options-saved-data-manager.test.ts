import assert from 'node:assert/strict';
import test from 'node:test';
import { CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY } from '../src/shared/codexbridge-mcp-protocol.ts';
import {
  KNOWN_LOCAL_DATA_KEYS, createSavedDataSnapshot, getOldEventCandidates, hasSavedTokenKey, isKnownLocalStorageChange, maskIdentifier,
} from '../options/src/saved-data-manager.ts';

test('saved data inventory reads a fixed allowlist and omits token and binary payloads', () => {
  assert.ok(KNOWN_LOCAL_DATA_KEYS.includes('chatPanelPlus.config'));
  const snapshot = createSavedDataSnapshot({
    'chatPanelPlus.answerCompletionSoundAssets': [{ id: 'user-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'tone', mimeType: 'audio/wav', data: 'AA==', sizeBytes: 1, durationSeconds: 0.1 }],
    'chatPanelPlus.statistics': { schemaVersion: 1, conversations: { c1: { turnOrder: ['t'], turns: { t: {} } } } },
    unknown: { secret: 'hidden' },
  }, { tokenPresent: true });
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes('SECRET'), false);
  assert.equal(serialized.includes('hidden'), false);
  assert.equal(snapshot.session.tokenPresent, true);
  assert.equal(snapshot.categories.find((entry) => entry.key.endsWith('SoundAssets'))?.count, 1);
  assert.equal(snapshot.categories.find((entry) => entry.key.endsWith('SoundAssets'))?.lastUpdated, '不明');
});

test('saved data inventory recognizes the versioned independent output-device selection without exposing IDs', () => {
  const snapshot = createSavedDataSnapshot({
    'chatPanelPlus.answerCompletionOutputDevice': {
      schemaVersion: 2,
      devices: [
        { deviceId: 'usb-private-1234', label: 'Desk speaker' },
        { deviceId: 'usb-private-5678', label: 'Headphones' },
      ],
    },
  }, { tokenPresent: false });
  const output = snapshot.categories.find((item) => item.key === 'chatPanelPlus.answerCompletionOutputDevice')!;
  assert.equal(output.status, '利用可能');
  assert.equal(output.deletable, false);
  assert.equal(JSON.stringify(output.records).includes('usb-private'), false);
  assert.equal(JSON.stringify(output.records).includes('Desk speaker'), false);
  assert.match(output.records[0]!.summary, /2台/u);
});

test('monitor details omit owner and connection identifiers while showing useful thread/event metadata', () => {
  const snapshot = createSavedDataSnapshot({ 'chatPanelPlus.codexBridgeThreadMonitor.v1': {
    version: 2,
    items: [{ watchId: 'watch-1', connectionId: 'conn-private', targetId: 'target-main', threadId: 'thread-123',
      enabled: true, baselineCaptured: true, baselineTurnKind: 'none', baselineTurnId: null, baselineTurnStatus: null,
      lastObservedTurnId: null, statusState: null, lastTurnStatus: 'unknown', lastTurnEvidence: null,
      currentExecutionState: 'in_progress', currentExecutionEvidence: 'turn', currentExecutionReason: null,
      currentExecutionTurnId: 'turn-1', needsAttention: false, turnChange: 'same', observedAt: null,
      lastSuccessAt: null, fetchOutcome: 'ok', nextPollAt: 0, failureCount: 0,
      ownerTabId: 73, ownerConversationId: 'private-conversation-id', ownerMuted: false, ownerMuteRevision: 1 }],
    events: [{ eventId: 'event-1', watchId: 'watch-1', connectionId: 'conn-private', targetId: 'target-main',
      threadId: 'thread-123', turnId: 'turn-1', status: 'completed', detectedAt: '2026-01-01T00:00:00Z',
      notificationState: 'played', notificationReason: null, acknowledgedAt: null, ownerTabId: 73,
      ownerConversationId: 'private-conversation-id', ownerMuted: false, ownerMuteRevision: 1 }],
  } }, { tokenPresent: false });
  const monitor = snapshot.categories.find((item) => item.key.endsWith('codexBridgeThreadMonitor.v1'))!;
  const rendered = JSON.stringify(monitor.records);
  assert.match(rendered, /thread-123/u);
  assert.match(rendered, /target-main/u);
  assert.match(rendered, /event-1/u);
  assert.doesNotMatch(rendered, /private-conversation-id|conn-private|ownerTabId|ownerMuteRevision/u);
  assert.equal(monitor.status, '利用可能');
});

test('legacy ownerless monitor entries remain readable with the storage reader defaults', () => {
  const snapshot = createSavedDataSnapshot({ 'chatPanelPlus.codexBridgeThreadMonitor.v1': {
    version: 1, items: [{ watchId: 'watch-legacy', connectionId: 'conn-legacy', targetId: 'target-main', threadId: 'thread-legacy',
      enabled: true, baselineCaptured: true, baselineTurnId: null, baselineTurnStatus: null, lastObservedTurnId: null,
      statusState: null, lastTurnStatus: null, lastTurnEvidence: null, currentExecutionState: null,
      currentExecutionEvidence: null, currentExecutionTurnId: null, needsAttention: null, turnChange: 'unknown',
      observedAt: null, lastSuccessAt: null, fetchOutcome: 'unknown', nextPollAt: 0, failureCount: 0 }], events: [],
  } }, { tokenPresent: false });
  const monitor = snapshot.categories.find((item) => item.key.endsWith('codexBridgeThreadMonitor.v1'))!;
  assert.equal(monitor.status, '利用可能');
  assert.match(monitor.records[0]?.summary ?? '', /thread-legacy/u);
});

test('only a known local key change marks the saved-data view stale', () => {
  assert.equal(isKnownLocalStorageChange({ 'chatPanelPlus.statistics': {} }, 'local'), true);
  assert.equal(isKnownLocalStorageChange({ unknown: {} }, 'local'), false);
  assert.equal(isKnownLocalStorageChange({ 'chatPanelPlus.statistics': {} }, 'session'), false);
});

test('session token is represented by key presence only, including an empty stored value', () => {
  assert.equal(hasSavedTokenKey({ [CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY]: '' }), true);
  assert.equal(hasSavedTokenKey({}), false);
});

test('old candidates require a valid event timestamp and include the exact 90-day boundary', () => {
  const now = Date.parse('2026-11-22T00:00:00Z');
  const events = [
    { eventId: 'old', detectedAt: new Date(now - 90 * 86400000).toISOString() },
    { eventId: 'new', detectedAt: new Date(now - 10).toISOString() },
    { eventId: 'missing' },
    { eventId: 'invalid', detectedAt: 'not-a-date' },
  ];
  assert.deepEqual(getOldEventCandidates(events, now).map((event) => event.eventId), ['old']);
  assert.equal(maskIdentifier('device-abcdef123456'), '••••••••3456');
});

test('large categories report the real count but cap rendered rows, and corrupt records are not deletable', () => {
  const conversations = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`conversation-${index}`, {
    schemaVersion: 1, selectedTabId: null, minimized: false, bridgeExpanded: false,
  }]));
  const snapshot = createSavedDataSnapshot({
    'chatPanelPlus.panelStateByConversation.v1': { schemaVersion: 1, conversations },
    'chatPanelPlus.projectFolderPatterns.v1': { version: 1, projects: 'broken' },
  }, { tokenPresent: false });
  const panel = snapshot.categories.find((item) => item.key.endsWith('panelStateByConversation.v1'))!;
  const folders = snapshot.categories.find((item) => item.key.endsWith('projectFolderPatterns.v1'))!;
  assert.equal(panel.count, 501);
  assert.equal(panel.records.length, 500);
  assert.equal(folders.status, '破損の可能性');
  assert.equal(folders.deletable, false);
});

test('canonical project name is not deletable when a legacy alias could restore it', () => {
  const id = 'g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const snapshot = createSavedDataSnapshot({ 'chatPanelPlus.projectNames': {
    [id]: 'Project', [`${id}-old-slug`]: 'Project',
  } }, { tokenPresent: false });
  const names = snapshot.categories.find((item) => item.key === 'chatPanelPlus.projectNames')!;
  assert.deepEqual(names.records.map((record) => record.deletable), [false, false]);
});

test('malformed monitor records are marked damaged and are not shown as deletable items', () => {
  const snapshot = createSavedDataSnapshot({ 'chatPanelPlus.codexBridgeThreadMonitor.v1': {
    version: 2, items: [{ threadId: 'thread-1' }], events: [],
  } }, { tokenPresent: false });
  const monitor = snapshot.categories.find((item) => item.key.endsWith('codexBridgeThreadMonitor.v1'))!;
  assert.equal(monitor.status, '破損の可能性');
  assert.equal(monitor.deletable, false);
  assert.equal(monitor.records.length, 0);
});
