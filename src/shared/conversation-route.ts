export function conversationIdFromPath(pathname: string): string | null {
  const match = /(?:^|\/)c\/([A-Za-z0-9_-]+)(?:\/|$)/u.exec(pathname);
  return match?.[1] ?? null;
}

export function isConversationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/u.test(value);
}
