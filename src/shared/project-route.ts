const PROJECT_ID_PATTERN = /^g-p-[0-9a-f]{32}$/iu;

export function isProjectId(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_ID_PATTERN.test(value);
}

export function normalizeCachedProjectId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^g-p-([0-9a-f]{32})(?:-[A-Za-z0-9_-]+)?$/iu.exec(value);
  return match?.[1] ? `g-p-${match[1].toLowerCase()}` : null;
}

export function projectIdFromPathname(pathname: string): string | null {
  const match = /^\/g\/(g-p-[0-9a-f]{32})(?:-[A-Za-z0-9_-]+)?(?=\/|$)/iu.exec(pathname);
  return match?.[1]?.toLowerCase() ?? null;
}

export function projectIdFromProjectPathname(pathname: string): string | null {
  const match = /^\/g\/(g-p-[0-9a-f]{32})\/project\/?$/iu.exec(pathname);
  return match?.[1]?.toLowerCase() ?? null;
}

export interface ProjectConversationReference {
  readonly projectId: string;
  readonly conversationId: string;
}

export function projectConversationFromPathname(pathname: string): ProjectConversationReference | null {
  const match = /^\/g\/(g-p-[0-9a-f]{32})(?:-[A-Za-z0-9_-]+)?\/c\/([A-Za-z0-9_-]+)\/?$/iu.exec(pathname);
  if (!match?.[1] || !match[2]) return null;
  return { projectId: match[1].toLowerCase(), conversationId: match[2] };
}
