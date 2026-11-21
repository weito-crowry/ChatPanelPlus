import { DEFAULT_TABS, type TabId } from './default-ui.ts';
import { isConversationId } from './conversation-route.ts';

export const CONVERSATION_PANEL_STATE_STORAGE_KEY = 'chatPanelPlus.panelStateByConversation.v1';

export type ConversationPanelWatchSelection = Readonly<{ connectionId: string; targetId: string; threadId: string }>;

export interface ConversationPanelState {
  readonly schemaVersion: 1;
  readonly selectedTabId: TabId | null;
  readonly minimized: boolean;
  readonly bridgeExpanded: boolean;
  readonly bridgeWatchSelection: ConversationPanelWatchSelection | null;
  readonly bridgeEventSelection: string | null;
}

export type ConversationPanelStateInput = Omit<ConversationPanelState, 'bridgeWatchSelection' | 'bridgeEventSelection'>
  & Partial<Pick<ConversationPanelState, 'bridgeWatchSelection' | 'bridgeEventSelection'>>;
export type ConversationPanelStatePatch = Partial<Pick<ConversationPanelState,
  'selectedTabId' | 'minimized' | 'bridgeExpanded' | 'bridgeWatchSelection' | 'bridgeEventSelection'>>;

export interface PanelStateStorageAreaLike {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface PanelStateStorageChangesLike {
  addListener(listener: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void): void;
  removeListener(listener: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void): void;
}

export interface PanelStateLockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export type ConversationPanelStateResult =
  | { readonly ok: true; readonly state: ConversationPanelState; readonly saved: boolean }
  | { readonly ok: false; readonly reason: 'invalid-conversation-id' | 'corrupt-state' | 'unsupported-version' | 'storage-failed' };

export type ConversationPanelStateSaveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'invalid-conversation-id' | 'invalid-state' | 'corrupt-state' | 'unsupported-version' | 'storage-failed' };

const DEFAULT_PANEL_STATE: ConversationPanelState = {
  schemaVersion: 1,
  selectedTabId: null,
  minimized: false,
  bridgeExpanded: false,
  bridgeWatchSelection: null,
  bridgeEventSelection: null,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTabId(value: unknown): value is TabId | null {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  return DEFAULT_TABS.some((tab) => tab.id === value)
    || /^custom-tab-[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu.test(value);
}

function validIdentifier(value: unknown, maximumLength = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength && value.trim() === value
    && !Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    });
}

function validWatchSelection(value: unknown): value is ConversationPanelWatchSelection {
  return isObject(value) && Object.keys(value).length === 3
    && validIdentifier(value.connectionId) && validIdentifier(value.targetId) && validIdentifier(value.threadId);
}

function validateState(value: unknown): ConversationPanelState | null {
  if (!isObject(value) || value.schemaVersion !== 1 || !validTabId(value.selectedTabId)
    || typeof value.minimized !== 'boolean' || typeof value.bridgeExpanded !== 'boolean') return null;
  return {
    schemaVersion: 1,
    selectedTabId: value.selectedTabId,
    minimized: value.minimized,
    bridgeExpanded: value.bridgeExpanded,
    bridgeWatchSelection: validWatchSelection(value.bridgeWatchSelection) ? value.bridgeWatchSelection : null,
    bridgeEventSelection: validIdentifier(value.bridgeEventSelection, 96) ? value.bridgeEventSelection : null,
  };
}

function readBucket(value: unknown): { readonly ok: true; readonly conversations: Record<string, unknown> }
  | { readonly ok: false; readonly reason: 'corrupt-state' | 'unsupported-version' } {
  if (!isObject(value) || !('schemaVersion' in value)) return { ok: false, reason: 'corrupt-state' };
  if (value.schemaVersion !== 1) return { ok: false, reason: 'unsupported-version' };
  if (!isObject(value.conversations)) return { ok: false, reason: 'corrupt-state' };
  return { ok: true, conversations: value.conversations };
}

export class ConversationPanelStateRepository {
  private readonly area: PanelStateStorageAreaLike;
  private readonly changes?: PanelStateStorageChangesLike;
  private readonly locks?: PanelStateLockManagerLike;

  constructor(area: PanelStateStorageAreaLike, changes?: PanelStateStorageChangesLike, locks?: PanelStateLockManagerLike) {
    this.area = area;
    this.changes = changes;
    this.locks = locks;
  }

  async load(conversationId: string | null): Promise<ConversationPanelStateResult> {
    if (!isConversationId(conversationId)) return { ok: false, reason: 'invalid-conversation-id' };
    try {
      const stored = await this.area.get([CONVERSATION_PANEL_STATE_STORAGE_KEY]);
      if (!(CONVERSATION_PANEL_STATE_STORAGE_KEY in stored)) return { ok: true, state: DEFAULT_PANEL_STATE, saved: false };
      const bucket = readBucket(stored[CONVERSATION_PANEL_STATE_STORAGE_KEY]);
      if (!bucket.ok) return bucket;
      if (!(conversationId in bucket.conversations)) return { ok: true, state: DEFAULT_PANEL_STATE, saved: false };
      const state = validateState(bucket.conversations[conversationId]);
      return state ? { ok: true, state, saved: true } : { ok: false, reason: 'corrupt-state' };
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }

  async save(conversationId: string | null, state: ConversationPanelStateInput): Promise<ConversationPanelStateSaveResult> {
    if (!isConversationId(conversationId)) return { ok: false, reason: 'invalid-conversation-id' };
    const validated = validateState(state);
    if (!validated) return { ok: false, reason: 'invalid-state' };
    const save = () => this.saveUnderLock(conversationId, validated);
    try { return this.locks ? await this.locks.request('chatPanelPlus.panelStateByConversation.write', save) : await save(); }
    catch { return { ok: false, reason: 'storage-failed' }; }
  }

  async update(conversationId: string | null, patch: ConversationPanelStatePatch): Promise<ConversationPanelStateSaveResult> {
    if (!isConversationId(conversationId)) return { ok: false, reason: 'invalid-conversation-id' };
    if (!isValidPatch(patch)) return { ok: false, reason: 'invalid-state' };
    const update = () => this.updateUnderLock(conversationId, patch);
    try { return this.locks ? await this.locks.request('chatPanelPlus.panelStateByConversation.write', update) : await update(); }
    catch { return { ok: false, reason: 'storage-failed' }; }
  }

  subscribe(conversationId: string | null, listener: (result: ConversationPanelStateResult) => void): () => void {
    if (!this.changes || !isConversationId(conversationId)) return () => {};
    const resolve = (storedValue: unknown): ConversationPanelStateResult => {
      if (storedValue === undefined) return { ok: true, state: DEFAULT_PANEL_STATE, saved: false };
      const bucket = readBucket(storedValue);
      if (!bucket.ok) return bucket;
      if (!(conversationId in bucket.conversations)) return { ok: true, state: DEFAULT_PANEL_STATE, saved: false };
      const state = validateState(bucket.conversations[conversationId]);
      return state ? { ok: true, state, saved: true } : { ok: false, reason: 'corrupt-state' };
    };
    const handler = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local' || !(CONVERSATION_PANEL_STATE_STORAGE_KEY in changes)) return;
      const change = changes[CONVERSATION_PANEL_STATE_STORAGE_KEY];
      const previous = resolve(change?.oldValue);
      const next = resolve(change?.newValue);
      if (JSON.stringify(previous) !== JSON.stringify(next)) listener(next);
    };
    this.changes.addListener(handler);
    return () => this.changes?.removeListener(handler);
  }

  private async saveUnderLock(conversationId: string, state: ConversationPanelState): Promise<ConversationPanelStateSaveResult> {
    try {
      const stored = await this.area.get([CONVERSATION_PANEL_STATE_STORAGE_KEY]);
      const current = stored[CONVERSATION_PANEL_STATE_STORAGE_KEY];
      let conversations: Record<string, unknown> = {};
      if (current !== undefined) {
        const bucket = readBucket(current);
        if (!bucket.ok) return bucket;
        conversations = structuredClone(bucket.conversations);
      }
      conversations[conversationId] = state;
      await this.area.set({ [CONVERSATION_PANEL_STATE_STORAGE_KEY]: { schemaVersion: 1, conversations } });
      return { ok: true };
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }

  private async updateUnderLock(conversationId: string, patch: ConversationPanelStatePatch): Promise<ConversationPanelStateSaveResult> {
    try {
      const stored = await this.area.get([CONVERSATION_PANEL_STATE_STORAGE_KEY]);
      const current = stored[CONVERSATION_PANEL_STATE_STORAGE_KEY];
      let conversations: Record<string, unknown> = {};
      if (current !== undefined) {
        const bucket = readBucket(current);
        if (!bucket.ok) return bucket;
        conversations = structuredClone(bucket.conversations);
      }
      const existing = conversationId in conversations ? validateState(conversations[conversationId]) : DEFAULT_PANEL_STATE;
      if (!existing) return { ok: false, reason: 'corrupt-state' };
      conversations[conversationId] = { ...existing, ...patch };
      await this.area.set({ [CONVERSATION_PANEL_STATE_STORAGE_KEY]: { schemaVersion: 1, conversations } });
      return { ok: true };
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }
}

function isValidPatch(value: ConversationPanelStatePatch): boolean {
  if (typeof value !== 'object' || value === null || Object.keys(value).length === 0) return false;
  const candidate = value as Record<string, unknown>;
    return Object.keys(candidate).every((key) => ['selectedTabId', 'minimized', 'bridgeExpanded', 'bridgeWatchSelection', 'bridgeEventSelection'].includes(key))
    && (!('selectedTabId' in candidate) || validTabId(candidate.selectedTabId))
    && (!('minimized' in candidate) || typeof candidate.minimized === 'boolean')
    && (!('bridgeExpanded' in candidate) || typeof candidate.bridgeExpanded === 'boolean')
    && (!('bridgeWatchSelection' in candidate) || candidate.bridgeWatchSelection === null || validWatchSelection(candidate.bridgeWatchSelection))
    && (!('bridgeEventSelection' in candidate) || candidate.bridgeEventSelection === null || validIdentifier(candidate.bridgeEventSelection, 96));
}

export function createChromeConversationPanelStateRepository(): ConversationPanelStateRepository {
  const locks = typeof navigator !== 'undefined' && navigator.locks
    ? { request: <T>(name: string, callback: () => Promise<T>) => navigator.locks.request(name, () => callback()) }
    : undefined;
  return new ConversationPanelStateRepository(chrome.storage.local, chrome.storage.onChanged, locks);
}
