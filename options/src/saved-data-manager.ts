import { CONFIG_STORAGE_KEY, VIEW_STATE_STORAGE_KEY, validateStoredViewState } from '../../src/shared/settings-repository.ts';
import { PROJECT_NAMES_STORAGE_KEY } from '../../src/shared/project-names-repository.ts';
import { PROJECT_FOLDER_PATTERNS_STORAGE_KEY, validateProjectFolderPatternsStore } from '../../src/shared/project-folder-patterns.ts';
import { CONVERSATION_PANEL_STATE_STORAGE_KEY, validateConversationPanelState } from '../../src/shared/conversation-panel-state-repository.ts';
import { STATISTICS_STORAGE_KEY, validateStatisticsStore } from '../../src/shared/conversation-statistics.ts';
import { CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY } from '../../src/shared/codexbridge-mcp-protocol.ts';
import { CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY } from '../../src/shared/codexbridge-thread-monitor-protocol.ts';
import { isCodexBridgeWatchIdentifier, isCodexBridgeWatchFetchOutcome } from '../../src/shared/codexbridge-thread-monitor-protocol.ts';
import { SOUND_ASSETS_STORAGE_KEY, validateSoundAssetMetadata } from '../../src/shared/answer-completion-sound-assets.ts';
import { ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY, validateAnswerCompletionOutputDevice } from '../../src/shared/answer-completion-output-device.ts';
import { validateExtensionSettings } from '../../src/shared/settings.ts';
import { isConversationId } from '../../src/shared/conversation-route.ts';
import { normalizeCachedProjectId } from '../../src/shared/project-route.ts';
import { isCodexBridgeTerminalEvent } from '../../src/shared/codexbridge-thread-monitor-protocol.ts';

export const KNOWN_LOCAL_DATA_KEYS = [CONFIG_STORAGE_KEY, VIEW_STATE_STORAGE_KEY, PROJECT_NAMES_STORAGE_KEY,
  PROJECT_FOLDER_PATTERNS_STORAGE_KEY, CONVERSATION_PANEL_STATE_STORAGE_KEY, STATISTICS_STORAGE_KEY,
  CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY, SOUND_ASSETS_STORAGE_KEY,
  ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY] as const;

export interface SavedDataRecord { readonly id: string; readonly summary: string; readonly details?: Readonly<Record<string, string | number | boolean>>; readonly deletable?: boolean; }
export interface SavedDataCategory {
  readonly key: string; readonly label: string; readonly count: number; readonly approximateBytes: number | null;
  readonly lastUpdated: string; readonly status: '利用可能' | '未保存' | '破損の可能性';
  readonly records: readonly SavedDataRecord[]; readonly deletable: boolean;
}
export interface SavedDataSnapshot { readonly categories: readonly SavedDataCategory[]; readonly session: { readonly tokenPresent: boolean }; }
type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;
const records = (rows: readonly SavedDataRecord[], key: string, label: string, raw?: unknown, deletable = false,
  lastUpdated = '不明', approximateBytes?: number, totalCount = rows.length): SavedDataCategory => ({ key, label, count: totalCount, approximateBytes: approximateBytes ?? safeJsonSize(rows),
  lastUpdated, status: raw === undefined ? '未保存' : '利用可能', records: rows.slice(0, 500), deletable });
const safeJsonSize = (value: unknown): number | null => { try { return new TextEncoder().encode(JSON.stringify(value)).length; } catch { return null; } };
const row = (id: string, summary: string, details?: Row, deletable = false): SavedDataRecord => ({ id, summary, deletable,
  ...(details ? { details: Object.fromEntries(Object.entries(details).filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) as Record<string, string | number | boolean> } : {}) });

function objectEntries(value: unknown): [string, unknown][] | null { return object(value) ? Object.entries(value) : null; }
function metadataFor(key: string, value: unknown): SavedDataCategory {
  if (value === undefined) return records([], key, key, undefined);
  if (key === CONFIG_STORAGE_KEY) {
    const validated = validateExtensionSettings(value);
    return validated.ok ? records([row('config', '共通設定（設定JSON対象）', {
      schemaVersion: validated.settings.schemaVersion, fields: Object.keys(validated.settings).length,
    })], key, key, value) : corrupt(key);
  }
  if (key === VIEW_STATE_STORAGE_KEY) {
    const state = validateStoredViewState(value);
    return state ? records([row('view', '共有パネル表示状態', { minimized: state.minimized,
      selectedTabId: state.selectedTabId ?? 'なし' })], key, key, value) : corrupt(key);
  }
  if (key === PROJECT_NAMES_STORAGE_KEY) {
    const entries = objectEntries(value);
    if (!entries || entries.some(([id, name]) => !normalizeCachedProjectId(id) || typeof name !== 'string' || !name.trim())) return corrupt(key);
    const canonicalCounts = new Map<string, number>();
    for (const [id] of entries) {
      const canonical = normalizeCachedProjectId(id);
      if (canonical) canonicalCounts.set(canonical, (canonicalCounts.get(canonical) ?? 0) + 1);
    }
    return records(entries.slice(0, 500).map(([id, name]) => row(id, name as string,
      undefined, /^g-p-[\da-f]{32}$/iu.test(id) && id === id.toLowerCase()
        && typeof name === 'string' && name === name.replace(/\s+/gu, ' ').trim() && canonicalCounts.get(id) === 1)),
      key, key, value, true, '不明', undefined, entries.length);
  }
  if (key === PROJECT_FOLDER_PATTERNS_STORAGE_KEY) {
    const normalized = validateProjectFolderPatternsStore(value);
    if (!normalized) return corrupt(key);
    const entries = Object.entries(normalized);
    return records(entries.slice(0, 500).map(([id, list]) => row(id,
      `${list.length}件のフォルダパターン`,
      Array.isArray(list) ? { patterns: list.join('\n') } : undefined,
      /^g-p-[\da-f]{32}$/iu.test(id))),
    key, key, value, true, '不明', undefined, entries.length);
  }
  if (key === CONVERSATION_PANEL_STATE_STORAGE_KEY) {
    if (!object(value) || value.schemaVersion !== 1 || !object(value.conversations)) return corrupt(key);
    const entries = Object.entries(value.conversations);
    if (entries.some(([id]) => !isConversationId(id))) return corrupt(key);
    const validated = entries.map(([id, state]) => [id, validateConversationPanelState(state)] as const);
    if (validated.some(([, state]) => !state)) return corrupt(key);
    return records(validated.slice(0, 500).map(([id, state]) => row(id, '会話別パネル状態', {
      selectedTabId: state!.selectedTabId ?? 'なし', minimized: state!.minimized, bridgeExpanded: state!.bridgeExpanded,
    }, true)), key, key, value, true, '不明', undefined, validated.length);
  }
  if (key === STATISTICS_STORAGE_KEY) {
    const validation = validateStatisticsStore(value);
    if (!validation.ok) return corrupt(key);
    const entries = Object.entries(validation.store.conversations);
    return records(entries.slice(0, 500).map(([id, stats]) => row(id, '会話統計', {
      turns: Object.keys(stats.turns).length, inputChars: sum(stats, 'inputChars'), outputChars: sum(stats, 'outputChars'),
    }, true)), key, key, value, true, '不明', undefined, entries.length);
  }
  if (key === CODEX_BRIDGE_THREAD_MONITOR_STORAGE_KEY) {
    if (!object(value) || (value.version !== 1 && value.version !== 2)
      || !Array.isArray(value.items) || !Array.isArray(value.events)) return corrupt(key);
    const events = value.events.filter(object);
    const items = value.items.filter(object);
    const validItems = items.filter(isSafeWatchRecord);
    const validEvents = events.filter(isCodexBridgeTerminalEvent);
    const rows = [...validItems.slice(0, 200).map((watch, index) => row(`watch-${index + 1}`,
      `監視中: ${watch.threadId}`, { threadId: watch.threadId, targetId: watch.targetId,
        status: watch.lastTurnStatus, execution: watch.currentExecutionState ?? '不明',
        observedAt: validDate(watch.observedAt) ?? '不明', fetchOutcome: watch.fetchOutcome })),
      ...validEvents.slice(0, 300).map((event, index) => row(text(event.eventId) ?? `event-${index + 1}`,
        `終了イベント / ${text(event.status) ?? '状態不明'}`, { threadId: event.threadId, targetId: event.targetId,
          status: event.status, notificationState: event.notificationState,
          acknowledged: Boolean(event.acknowledgedAt), detectedAt: validDate(event.detectedAt) ?? '不明' }))];
    const category = { ...records(rows, key, key, value, false), count: value.items.length + validEvents.length };
    return validItems.length === items.length && items.length === value.items.length && events.length === validEvents.length
      ? category : { ...category, status: '破損の可能性' };
  }
  if (key === SOUND_ASSETS_STORAGE_KEY) {
    const assets = validateSoundAssetMetadata(value);
    if (!assets) return corrupt(key);
    const safe = assets.slice(0, 500).map((asset) => row(asset.id, `${asset.name}（音源データは非表示）`, {
      mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, durationSeconds: asset.durationSeconds,
    }));
    const encodedBytes = assets.reduce((total, asset) => total + Math.ceil(asset.sizeBytes / 3) * 4, 0);
    return records(safe, key, key, value, false, '不明', encodedBytes + (safeJsonSize(safe) ?? 0));
  }
  if (key === ANSWER_COMPLETION_OUTPUT_DEVICE_STORAGE_KEY) {
    const device = validateAnswerCompletionOutputDevice(value);
    return device ? records([row('output-device', device.deviceId !== 'default' ? maskIdentifier(device.deviceId) : '既定の出力先',
      { deviceConfigured: device.deviceId !== 'default' })], key, key, value) : corrupt(key);
  }
  return records([], key, key, value);
}
function sum(stats: { readonly turns: Readonly<Record<string, { readonly inputChars?: number; readonly outputChars?: number }>> }, field: 'inputChars' | 'outputChars') {
  return Object.values(stats.turns).reduce((total, item) => total + (item[field] ?? 0), 0);
}
function validDate(value: unknown): string | null { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; }
function isSafeWatchRecord(value: Row): value is Row & { threadId: string; targetId: string; lastTurnStatus: string; currentExecutionState: string | null; observedAt: string | null; fetchOutcome: string } {
  const hasOwner = ['ownerTabId', 'ownerConversationId', 'ownerMuted', 'ownerMuteRevision'].some((key) => key in value);
  const validOwner = !hasOwner || (Number.isSafeInteger(value.ownerTabId) && (value.ownerTabId as number) >= 0
    && isConversationId(value.ownerConversationId) && (typeof value.ownerMuted === 'boolean' || value.ownerMuted === null)
    && Number.isSafeInteger(value.ownerMuteRevision) && (value.ownerMuteRevision as number) >= 0);
  const status = (state: unknown) => state === null || ['completed', 'failed', 'interrupted', 'in_progress', 'unknown'].includes(String(state));
  const nullableText = (entry: unknown, maxLength = 512) => entry === null || (typeof entry === 'string' && entry.length <= maxLength
    && !Array.from(entry).some((character) => { const code = character.codePointAt(0) ?? 0; return code <= 0x1f || (code >= 0x7f && code <= 0x9f); }));
  const baselineKind = value.baselineTurnKind === undefined
    ? (value.baselineTurnId === null ? 'unknown' : 'turn') : value.baselineTurnKind;
  const executionReason = value.currentExecutionReason === undefined ? null : value.currentExecutionReason;
  return validOwner && typeof value.watchId === 'string' && value.watchId.length > 0 && value.watchId.length <= 96
    && isCodexBridgeWatchIdentifier(value.connectionId) && value.connectionId.length <= 96
    && isCodexBridgeWatchIdentifier(value.targetId) && isCodexBridgeWatchIdentifier(value.threadId)
    && value.enabled === true && typeof value.baselineCaptured === 'boolean'
    && ['turn', 'none', 'unknown'].includes(String(baselineKind))
    && ((baselineKind === 'turn') === (typeof value.baselineTurnId === 'string'))
    && (baselineKind !== 'none' || value.baselineCaptured === true)
    && (value.baselineCaptured !== false || baselineKind === 'unknown')
    && (typeof value.baselineTurnId === 'string' || value.baselineTurnId === null)
    && status(value.baselineTurnStatus) && nullableText(value.lastObservedTurnId) && status(value.lastTurnStatus)
    && nullableText(value.statusState, 80) && nullableText(value.lastTurnEvidence, 80)
    && nullableText(value.currentExecutionState, 80) && nullableText(value.currentExecutionEvidence, 80)
    && nullableText(executionReason, 160) && nullableText(value.currentExecutionTurnId)
    && (typeof value.needsAttention === 'boolean' || value.needsAttention === null)
    && ['baseline', 'same', 'advanced', 'gap', 'unknown'].includes(String(value.turnChange))
    && nullableText(value.observedAt, 40) && nullableText(value.lastSuccessAt, 40)
    && isCodexBridgeWatchFetchOutcome(value.fetchOutcome)
    && Number.isSafeInteger(value.nextPollAt) && (value.nextPollAt as number) >= 0
    && Number.isSafeInteger(value.failureCount) && (value.failureCount as number) >= 0 && (value.failureCount as number) <= 8;
}
function corrupt(key: string): SavedDataCategory { return { ...records([], key, key, null), status: '破損の可能性', approximateBytes: null }; }

export function createSavedDataSnapshot(localData: Record<string, unknown>, session: { tokenPresent: boolean }): SavedDataSnapshot {
  return { categories: KNOWN_LOCAL_DATA_KEYS.map((key) => metadataFor(key, localData[key])), session: { tokenPresent: session.tokenPresent } };
}

export function hasSavedTokenKey(sessionData: Record<string, unknown>): boolean {
  return Object.hasOwn(sessionData, CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY);
}

export function isKnownLocalStorageChange(changes: Record<string, unknown>, areaName: string): boolean {
  return areaName === 'local' && KNOWN_LOCAL_DATA_KEYS.some((key) => key in changes);
}

export function getOldEventCandidates<T extends { readonly detectedAt?: unknown }>(events: readonly T[], now = Date.now(), ageMs = 90 * 86400000): T[] {
  return events.filter((event) => { const timestamp = typeof event.detectedAt === 'string' ? Date.parse(event.detectedAt) : NaN;
    return Number.isFinite(timestamp) && now - timestamp >= ageMs; });
}

export function maskIdentifier(value: string): string { return `••••••••${value.slice(-4)}`; }
