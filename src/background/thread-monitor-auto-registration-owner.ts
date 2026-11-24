import type { CodexBridgeOwnerIdentity, CodexBridgeSessionOwnerLeases } from './thread-monitor-owner-lease.ts';
import type { AutoState } from './thread-monitor-auto-registration-state.ts';

export type OwnerMuteResult = { readonly ok: true; readonly muted: boolean; readonly revision: number }
  | { readonly ok: false };
export type OwnerMuteSnapshot = Readonly<{ muted: boolean | null; revision: number }>;
export type OwnerBinding = Readonly<{ ownerTabId: number; ownerConversationId: string; ownerMuted: boolean | null; ownerMuteRevision: number }>;
export type RuntimeOwnerClaim = 'current' | 'other-tab' | 'recovering' | 'storage-error';
export type OwnerClaimResult = RuntimeOwnerClaim | 'connection-unavailable';
type OwnerRecord = Readonly<{ connectionId: string; targetId: string; ownerConversationId?: string }>;

export function rebindAutoEntryState(state: AutoState, identity: CodexBridgeOwnerIdentity,
  binding: OwnerBinding): { state: AutoState; value: true } {
  let changed = false;
  const entries = state.entries.map((entry) => {
    if (entry.connectionId !== identity.connectionId || entry.targetId !== identity.targetId
      || entry.ownerConversationId !== identity.conversationId) return entry;
    changed = true;
    return { ...entry, ...binding, failure: entry.failure === 'owner-tab-unavailable' ? null : entry.failure };
  });
  return { state: changed ? { ...state, entries } : state, value: true };
}

export function hasOwnerRecords(identity: CodexBridgeOwnerIdentity, records: readonly OwnerRecord[]): boolean {
  return records.some((record) => record.connectionId === identity.connectionId && record.targetId === identity.targetId
    && record.ownerConversationId === identity.conversationId);
}

export async function claimOwnerForIdentity(
  targetId: string,
  conversationId: string,
  tabId: number,
  resolveConnectionId: () => Promise<string | null>,
  hasActiveWork: (identity: CodexBridgeOwnerIdentity) => Promise<boolean | null>,
  leases: Pick<CodexBridgeSessionOwnerLeases, 'release'>,
  claim: (identity: CodexBridgeOwnerIdentity, tabId: number) => Promise<RuntimeOwnerClaim>,
): Promise<OwnerClaimResult> {
  let connectionId: string | null;
  try { connectionId = await resolveConnectionId(); } catch { return 'connection-unavailable'; }
  if (!connectionId) return 'connection-unavailable';
  const identity = { connectionId, targetId, conversationId };
  let active: boolean | null;
  try { active = await hasActiveWork(identity); } catch { return 'storage-error'; }
  if (active === null) return 'storage-error';
  if (!active && await leases.release(identity) === 'storage-error') return 'storage-error';
  return claim(identity, tabId);
}

export async function readOwnerMute(
  load: (tabId: number, conversationId: string) => Promise<OwnerMuteResult>,
  tabId: number,
  conversationId: string,
): Promise<OwnerMuteSnapshot> {
  try {
    const value = await load(tabId, conversationId);
    return value.ok && typeof value.muted === 'boolean' && Number.isSafeInteger(value.revision) && value.revision >= 0
      ? { muted: value.muted, revision: value.revision } : { muted: null, revision: 0 };
  } catch { return { muted: null, revision: 0 }; }
}

export class CodexBridgeAutoRegistrationOwner {
  private readonly leases: Pick<CodexBridgeSessionOwnerLeases, 'claim'>;
  private readonly loadMute: (tabId: number, conversationId: string) => Promise<OwnerMuteResult>;
  private readonly persist: (identity: CodexBridgeOwnerIdentity, binding: OwnerBinding) => Promise<boolean>;
  private readonly rebind: (identity: CodexBridgeOwnerIdentity, binding: OwnerBinding) => Promise<void>;
  private readonly onClaim?: (identity: CodexBridgeOwnerIdentity, tabId: number) => Promise<void>;

  constructor(options: {
    leases: Pick<CodexBridgeSessionOwnerLeases, 'claim'>;
    loadMute: (tabId: number, conversationId: string) => Promise<OwnerMuteResult>;
    persist: (identity: CodexBridgeOwnerIdentity, binding: OwnerBinding) => Promise<boolean>;
    rebind: (identity: CodexBridgeOwnerIdentity, binding: OwnerBinding) => Promise<void>;
    onClaim?: (identity: CodexBridgeOwnerIdentity, tabId: number) => Promise<void>;
  }) {
    this.leases = options.leases;
    this.loadMute = options.loadMute;
    this.persist = options.persist;
    this.rebind = options.rebind;
    this.onClaim = options.onClaim;
  }

  async claim(identity: CodexBridgeOwnerIdentity, tabId: number): Promise<RuntimeOwnerClaim> {
    const result = await this.leases.claim(identity, tabId);
    if (result === 'other-tab' || result === 'recovering' || result === 'storage-error') return result;
    const mute = await readOwnerMute(this.loadMute, tabId, identity.conversationId);
    const binding = { ownerTabId: tabId, ownerConversationId: identity.conversationId,
      ownerMuted: mute.muted, ownerMuteRevision: mute.revision };
    if (!await this.persist(identity, binding)) return 'storage-error';
    try {
      await this.rebind(identity, binding);
      await this.onClaim?.(identity, tabId);
    } catch { return 'storage-error'; }
    return 'current';
  }
}
