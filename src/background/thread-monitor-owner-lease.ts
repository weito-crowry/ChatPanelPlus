import { isConversationId } from '../shared/conversation-route.ts';
import { isCodexBridgeWatchIdentifier } from '../shared/codexbridge-thread-monitor-protocol.ts';

export const CODEX_BRIDGE_OWNER_LEASE_SESSION_PREFIX = 'chatPanelPlus.codexBridgeOwnerLease.session.v1:';

export type CodexBridgeOwnerIdentity = Readonly<{
  connectionId: string;
  targetId: string;
  conversationId: string;
}>;

export type CodexBridgeOwnerIdentityProbeResult = Readonly<{ kind: 'identity'; conversationId: string }>
  | Readonly<{ kind: 'closed' | 'unknown' }>;

export type CodexBridgeOwnerLeaseClaimResult = 'claimed' | 'current' | 'other-tab' | 'recovering' | 'storage-error';
export type CodexBridgeOwnerLeaseReleaseResult = 'released' | 'none' | 'storage-error';
export type CodexBridgeOwnerLeaseResolution = Readonly<{ kind: 'owner'; tabId: number }>
  | Readonly<{ kind: 'none' | 'recovering' | 'storage-error' }>;

export interface CodexBridgeOwnerLeaseSessionLike {
  get(keys: string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

type OwnerLease = CodexBridgeOwnerIdentity & Readonly<{ version: 1; epoch: string; tabId: number }>;
type LeaseReadResult = Readonly<{ ok: true; lease: OwnerLease | null }> | Readonly<{ ok: false }>;

function identityKey(identity: CodexBridgeOwnerIdentity): string {
  return `${identity.connectionId}\u0000${identity.targetId}\u0000${identity.conversationId}`;
}

function isIdentity(value: unknown): value is CodexBridgeOwnerIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isCodexBridgeWatchIdentifier(candidate.connectionId) && candidate.connectionId.length <= 96
    && isCodexBridgeWatchIdentifier(candidate.targetId) && isConversationId(candidate.conversationId);
}

function isOwnerLease(value: unknown): value is OwnerLease {
  if (!isIdentity(value) || Object.keys(value).length !== 6) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && typeof candidate.epoch === 'string' && candidate.epoch.length > 0
    && candidate.epoch.length <= 96 && Number.isSafeInteger(candidate.tabId) && (candidate.tabId as number) >= 0;
}

export function codexBridgeOwnerLeaseSessionKey(identity: CodexBridgeOwnerIdentity): string {
  return `${CODEX_BRIDGE_OWNER_LEASE_SESSION_PREFIX}${encodeURIComponent(JSON.stringify([
    identity.connectionId, identity.targetId, identity.conversationId,
  ]))}`;
}

function identityFromSessionKey(key: string): CodexBridgeOwnerIdentity | null {
  if (!key.startsWith(CODEX_BRIDGE_OWNER_LEASE_SESSION_PREFIX)) return null;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(key.slice(CODEX_BRIDGE_OWNER_LEASE_SESSION_PREFIX.length)));
    if (!Array.isArray(value) || value.length !== 3) return null;
    const identity = { connectionId: value[0], targetId: value[1], conversationId: value[2] };
    return isIdentity(identity) && codexBridgeOwnerLeaseSessionKey(identity) === key ? identity : null;
  } catch { return null; }
}

export class CodexBridgeSessionOwnerLeases {
  private readonly session: CodexBridgeOwnerLeaseSessionLike;
  private readonly inspectOwner: (tabId: number) => Promise<CodexBridgeOwnerIdentityProbeResult>;
  private readonly createEpoch: () => string;
  private readonly tails = new Map<string, Promise<void>>();

  constructor(
    session: CodexBridgeOwnerLeaseSessionLike,
    inspectOwner: (tabId: number) => Promise<CodexBridgeOwnerIdentityProbeResult>,
    createEpoch: () => string = () => globalThis.crypto.randomUUID(),
  ) {
    this.session = session;
    this.inspectOwner = inspectOwner;
    this.createEpoch = createEpoch;
  }

  claim(identity: CodexBridgeOwnerIdentity, tabId: number): Promise<CodexBridgeOwnerLeaseClaimResult> {
    if (!isIdentity(identity) || !Number.isSafeInteger(tabId) || tabId < 0) return Promise.resolve('storage-error');
    const key = codexBridgeOwnerLeaseSessionKey(identity);
    return this.serial(key, async () => {
      const loaded = await this.readLease(key, identity);
      if (!loaded.ok) return 'storage-error';
      const existing = loaded.lease;
      if (existing?.tabId === tabId) return 'current';
      if (existing) {
        let probe: CodexBridgeOwnerIdentityProbeResult;
        try { probe = await this.inspectOwner(existing.tabId); } catch { probe = { kind: 'unknown' }; }
        if (probe.kind === 'unknown') return 'recovering';
        if (probe.kind === 'identity' && probe.conversationId === identity.conversationId) return 'other-tab';
      }
      const next: OwnerLease = { version: 1, epoch: existing?.epoch ?? this.createEpoch(), ...identity, tabId };
      return await this.writeLease(key, next) ? 'claimed' : 'storage-error';
    });
  }

  resolveOwner(identity: CodexBridgeOwnerIdentity): Promise<CodexBridgeOwnerLeaseResolution> {
    if (!isIdentity(identity)) return Promise.resolve({ kind: 'none' });
    const key = codexBridgeOwnerLeaseSessionKey(identity);
    return this.serial(key, async () => {
      const loaded = await this.readLease(key, identity);
      if (!loaded.ok) return { kind: 'storage-error' };
      if (!loaded.lease) return { kind: 'none' };
      let probe: CodexBridgeOwnerIdentityProbeResult;
      try { probe = await this.inspectOwner(loaded.lease.tabId); } catch { probe = { kind: 'unknown' }; }
      if (probe.kind === 'unknown') return { kind: 'recovering' };
      return probe.kind === 'identity' && probe.conversationId === identity.conversationId
        ? { kind: 'owner', tabId: loaded.lease.tabId } : { kind: 'none' };
    });
  }

  release(identity: CodexBridgeOwnerIdentity): Promise<CodexBridgeOwnerLeaseReleaseResult> {
    if (!isIdentity(identity)) return Promise.resolve('storage-error');
    const key = codexBridgeOwnerLeaseSessionKey(identity);
    return this.serial(key, async () => {
      const loaded = await this.readLease(key, identity);
      if (!loaded.ok) return 'storage-error';
      if (!loaded.lease) return 'none';
      try { await this.session.remove([key]); return 'released'; }
      catch { return 'storage-error'; }
    });
  }

  async releaseTab(tabId: number, isClosed: () => Promise<boolean> = async () => true): Promise<void> {
    if (!Number.isSafeInteger(tabId) || tabId < 0) return;
    let stored: Record<string, unknown>;
    try { stored = await this.session.get(null); } catch { return; }
    const keys = Object.keys(stored).filter((key) => {
      const identity = identityFromSessionKey(key);
      return identity !== null && isOwnerLease(stored[key]) && (stored[key] as OwnerLease).tabId === tabId;
    });
    for (const key of keys) {
      const identity = identityFromSessionKey(key);
      if (!identity) continue;
      await this.serial(key, async () => {
        try { if (!await isClosed()) return; } catch { return; }
        const loaded = await this.readLease(key, identity);
        if (loaded.ok && loaded.lease?.tabId === tabId) {
          try { await this.session.remove([key]); } catch { /* The next verified claim can clear a closed tab lease. */ }
        }
      });
    }
  }

  private async readLease(key: string, identity: CodexBridgeOwnerIdentity): Promise<LeaseReadResult> {
    try {
      const stored = await this.session.get([key]);
      const value = stored[key];
      if (value === undefined) return { ok: true, lease: null };
      return isOwnerLease(value) && identityKey(value) === identityKey(identity)
        ? { ok: true, lease: value } : { ok: false };
    } catch { return { ok: false }; }
  }

  private async writeLease(key: string, lease: OwnerLease): Promise<boolean> {
    try { await this.session.set({ [key]: lease }); return true; }
    catch { return false; }
  }

  private serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    void tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return result;
  }
}
