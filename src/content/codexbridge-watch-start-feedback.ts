export type CodexBridgeWatchStartIdentity = Readonly<{
  conversationId: string;
  targetId: string;
  threadId: string;
}>;

export type CodexBridgeWatchStartTicket = CodexBridgeWatchStartIdentity & Readonly<{ generation: number }>;

export function currentCodexBridgeWatchStartIdentity(
  selected: Readonly<{ targetId: string; threadId: string }> | null,
  conversationId: string | null,
): CodexBridgeWatchStartIdentity | null {
  return selected && conversationId ? { ...selected, conversationId } : null;
}

export function codexBridgeWatchStartFailureLabel(reason: unknown): string {
  if (reason === 'watch-limit') return '監視開始: 監視件数の上限に達しています。不要な監視を解除してください。';
  if (reason === 'owner-unavailable') return '監視開始: 登録元不明の既存watchは自動移管しません。管理者による整理が必要です。';
  if (reason === 'invalid-request') return '監視開始: 会話ページの送信元を確認できません。SPA遷移が完了してから再試行してください。';
  return '監視開始: 接続先または権限を確認できませんでした。';
}

export class CodexBridgeWatchStartFeedback {
  private generation = 0;

  begin(identity: CodexBridgeWatchStartIdentity): CodexBridgeWatchStartTicket {
    return { ...identity, generation: ++this.generation };
  }

  invalidate(): void { this.generation += 1; }

  isCurrent(ticket: CodexBridgeWatchStartTicket, identity: CodexBridgeWatchStartIdentity | null): boolean {
    return ticket.generation === this.generation && identity?.conversationId === ticket.conversationId
      && identity.targetId === ticket.targetId && identity.threadId === ticket.threadId;
  }

  recordFailure(ticket: CodexBridgeWatchStartTicket, identity: CodexBridgeWatchStartIdentity | null): boolean {
    return this.isCurrent(ticket, identity);
  }
}
