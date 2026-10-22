import { isConversationId } from './conversation-route.ts';
import {
  CODEX_WORK_MODE_GET,
  CODEX_WORK_MODE_SET,
  CODEX_WORK_MODE_UPDATED,
} from './codex-work-mode-protocol.ts';

export type CodexWorkModeValue = Readonly<{
  schemaVersion: 1;
  enabled: boolean;
}>;

export type CodexWorkModeReadResult =
  | { readonly ok: true; readonly value: CodexWorkModeValue; readonly saved: boolean }
  | { readonly ok: false; readonly reason: 'invalid-data' | 'storage-error' };

export type CodexWorkModeWriteResult =
  | { readonly ok: true; readonly value: CodexWorkModeValue }
  | { readonly ok: false; readonly reason: 'storage-error' };

export type CodexWorkModeChange = Readonly<{
  conversationId: string;
  result: CodexWorkModeReadResult;
}>;

export interface CodexWorkModeRepositoryLike {
  load(conversationId: string): Promise<CodexWorkModeReadResult>;
  setEnabled(conversationId: string, enabled: boolean): Promise<CodexWorkModeWriteResult>;
  subscribe(listener: (change: CodexWorkModeChange) => void): () => void;
}

export interface CodexWorkModeRuntimeLike {
  readonly id?: string;
  sendMessage(message: unknown): Promise<unknown>;
  readonly onMessage: {
    addListener(listener: (message: unknown, sender: { readonly id?: string }) => void): void;
    removeListener(listener: (message: unknown, sender: { readonly id?: string }) => void): void;
  };
}

export function validateCodexWorkMode(value: unknown):
  | { readonly ok: true; readonly value: CodexWorkModeValue }
  | { readonly ok: false; readonly reason: 'invalid-data' } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'invalid-data' };
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 || typeof candidate.enabled !== 'boolean') {
    return { ok: false, reason: 'invalid-data' };
  }
  return { ok: true, value: { schemaVersion: 1, enabled: candidate.enabled } };
}

function parseReadResult(value: unknown): CodexWorkModeReadResult {
  if (typeof value !== 'object' || value === null || !('ok' in value)) {
    return { ok: false, reason: 'storage-error' };
  }
  const result = value as Record<string, unknown>;
  if (result.ok === false && (result.reason === 'invalid-data' || result.reason === 'storage-error')) {
    return { ok: false, reason: result.reason };
  }
  if (result.ok !== true || typeof result.saved !== 'boolean') return { ok: false, reason: 'storage-error' };
  const validated = validateCodexWorkMode(result.value);
  return validated.ok
    ? { ...validated, saved: result.saved }
    : { ok: false, reason: 'storage-error' };
}

function parseWriteResult(value: unknown): CodexWorkModeWriteResult {
  if (typeof value !== 'object' || value === null || !('ok' in value)) {
    return { ok: false, reason: 'storage-error' };
  }
  const result = value as Record<string, unknown>;
  if (result.ok !== true) return { ok: false, reason: 'storage-error' };
  const validated = validateCodexWorkMode(result.value);
  return validated.ok ? validated : { ok: false, reason: 'storage-error' };
}

function parseChange(message: unknown, senderId: string | undefined, extensionId: string | undefined): CodexWorkModeChange | null {
  if (senderId !== extensionId || typeof message !== 'object' || message === null || !('type' in message)) return null;
  const candidate = message as Record<string, unknown>;
  if (candidate.type !== CODEX_WORK_MODE_UPDATED || !isConversationId(candidate.conversationId)) return null;
  const result = parseReadResult(candidate.result);
  if (!result.ok && result.reason === 'storage-error') return null;
  return { conversationId: candidate.conversationId, result };
}

export class CodexWorkModeRepository implements CodexWorkModeRepositoryLike {
  private readonly runtime: CodexWorkModeRuntimeLike;
  private readonly subscribers = new Set<(change: CodexWorkModeChange) => void>();

  constructor(runtime: CodexWorkModeRuntimeLike) {
    this.runtime = runtime;
  }

  async load(conversationId: string): Promise<CodexWorkModeReadResult> {
    if (!isConversationId(conversationId)) return { ok: false, reason: 'storage-error' };
    try {
      const response = await this.runtime.sendMessage({ type: CODEX_WORK_MODE_GET, conversationId });
      return parseReadResult(response);
    } catch {
      return { ok: false, reason: 'storage-error' };
    }
  }

  async setEnabled(conversationId: string, enabled: boolean): Promise<CodexWorkModeWriteResult> {
    if (!isConversationId(conversationId) || typeof enabled !== 'boolean') {
      return { ok: false, reason: 'storage-error' };
    }
    try {
      const response = await this.runtime.sendMessage({ type: CODEX_WORK_MODE_SET, conversationId, enabled });
      return parseWriteResult(response);
    } catch {
      return { ok: false, reason: 'storage-error' };
    }
  }

  subscribe(listener: (change: CodexWorkModeChange) => void): () => void {
    const first = this.subscribers.size === 0;
    this.subscribers.add(listener);
    if (first) this.runtime.onMessage.addListener(this.handleMessage);
    return () => {
      this.subscribers.delete(listener);
      if (this.subscribers.size === 0) this.runtime.onMessage.removeListener(this.handleMessage);
    };
  }

  private readonly handleMessage = (message: unknown, sender: { readonly id?: string }): void => {
    const change = parseChange(message, sender.id, this.runtime.id);
    if (!change) return;
    this.subscribers.forEach((subscriber) => subscriber(change));
  };
}

export function createChromeCodexWorkModeRepository(): CodexWorkModeRepository {
  return new CodexWorkModeRepository(chrome.runtime);
}
