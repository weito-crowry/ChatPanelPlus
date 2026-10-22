import {
  STATISTICS_STORAGE_KEY,
  createStatisticsStore,
  mergeStoredConversationStatistics,
  validateStatisticsStore,
  type StatisticsStore,
  type StoredConversationStatistics,
} from './conversation-statistics.ts';

export interface StatisticsStorageAreaLike {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface StatisticsLockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export type StatisticsRepositoryResult =
  | { readonly ok: true; readonly store: StatisticsStore }
  | { readonly ok: false; readonly reason: 'corrupt-data' | 'unsupported-version' | 'storage-failed' };

export type StatisticsSaveResult =
  | { readonly ok: true; readonly conversation: StoredConversationStatistics }
  | { readonly ok: false; readonly reason: 'corrupt-data' | 'unsupported-version' | 'storage-failed' };

export class ConversationStatisticsRepository {
  private readonly area: StatisticsStorageAreaLike;
  private readonly locks?: StatisticsLockManagerLike;
  private readonly baselines = new Map<string, StoredConversationStatistics>();

  constructor(area: StatisticsStorageAreaLike, locks?: StatisticsLockManagerLike) {
    this.area = area;
    this.locks = locks;
  }

  async loadStore(): Promise<StatisticsRepositoryResult> {
    const result = await this.readStore();
    if (result.ok) {
      this.baselines.clear();
      for (const [conversationId, conversation] of Object.entries(result.store.conversations)) {
        this.baselines.set(conversationId, conversation);
      }
    }
    return result;
  }

  private async readStore(): Promise<StatisticsRepositoryResult> {
    try {
      const stored = await this.area.get([STATISTICS_STORAGE_KEY]);
      if (!(STATISTICS_STORAGE_KEY in stored)) return { ok: true, store: createStatisticsStore() };
      const validation = validateStatisticsStore(stored[STATISTICS_STORAGE_KEY]);
      return validation.ok ? { ok: true, store: validation.store } : validation;
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }

  async saveConversation(
    conversationId: string,
    conversation: StoredConversationStatistics,
  ): Promise<StatisticsSaveResult> {
    const candidate = validateStatisticsStore({ schemaVersion: 1, conversations: { [conversationId]: conversation } });
    if (!candidate.ok) return { ok: false, reason: candidate.reason };
    try {
      const baseline = this.baselines.get(conversationId);
      const save = () => this.saveUnderLock(conversationId, candidate.store.conversations[conversationId]!, baseline);
      return this.locks ? await this.locks.request('chatPanelPlus.statistics.write', save) : await save();
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }

  private async saveUnderLock(
    conversationId: string,
    conversation: StoredConversationStatistics,
    baseline: StoredConversationStatistics | undefined,
  ): Promise<StatisticsSaveResult> {
    const current = await this.readStore();
    if (!current.ok) return { ok: false, reason: current.reason };
    const previous = current.store.conversations[conversationId];
    const merged = mergeStoredConversationStatistics(baseline, conversation, previous);
    if (previous && JSON.stringify(previous) === JSON.stringify(merged)) {
      this.baselines.set(conversationId, previous);
      return { ok: true, conversation: previous };
    }
    const next: StatisticsStore = {
      schemaVersion: 1,
      conversations: { ...current.store.conversations, [conversationId]: merged },
    };
    try {
      await this.area.set({ [STATISTICS_STORAGE_KEY]: next });
      this.baselines.set(conversationId, merged);
      return { ok: true, conversation: merged };
    } catch {
      return { ok: false, reason: 'storage-failed' };
    }
  }
}

export function createChromeConversationStatisticsRepository(): ConversationStatisticsRepository {
  const locks = typeof navigator !== 'undefined' && navigator.locks
    ? { request: <T>(name: string, callback: () => Promise<T>) => navigator.locks.request(name, () => callback()) }
    : undefined;
  return new ConversationStatisticsRepository(chrome.storage.local, locks);
}
