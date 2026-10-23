import {
  projectConversationFromPathname,
  projectIdFromPathname,
  projectIdFromProjectPathname,
} from '../shared/project-route.ts';

const CHATGPT_ORIGIN = 'https://chatgpt.com';
const PROJECT_LINK_SELECTOR = 'a[href]';

export interface ResolvedProjectContext {
  readonly projectId: string;
  readonly projectName?: string;
  readonly evidence: Element | null;
}

interface ProjectNameEvidence {
  readonly name: string;
  readonly element: Element;
}

interface ConversationReference {
  readonly conversationId: string;
  readonly projectId: string | null;
}

interface ActiveConversationReference extends ConversationReference {
  readonly element: Element;
}

function isHidden(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true' || current.hasAttribute('inert')) return true;
    const style = current.getAttribute('style') ?? '';
    if (/(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden)/iu.test(style)) return true;
    current = current.parentElement;
  }
  try {
    if (typeof (element as HTMLElement).checkVisibility === 'function'
      && !(element as HTMLElement).checkVisibility()) return true;
    return typeof (element as HTMLElement).getClientRects === 'function'
      && (element as HTMLElement).getClientRects().length === 0;
  } catch {
    return true;
  }
}

function visibleText(element: Element): string | null {
  if (isHidden(element)) return null;
  const text = (element as HTMLElement).innerText;
  if (typeof text !== 'string') return null;
  const normalized = text.replace(/\s+/gu, ' ').trim();
  return normalized || null;
}

function sameOriginPathname(element: Element): string | null {
  const href = element.getAttribute('href');
  if (!href) return null;
  try {
    const url = new URL(href, CHATGPT_ORIGIN);
    return url.origin === CHATGPT_ORIGIN ? url.pathname : null;
  } catch {
    return null;
  }
}

function isOutsideMain(element: Element): boolean {
  return element.closest('main') === null;
}

function conversationReferenceFromPathname(pathname: string): ConversationReference | null {
  const projectConversation = projectConversationFromPathname(pathname);
  if (projectConversation) return projectConversation;
  const regularConversation = /^\/c\/([A-Za-z0-9_-]+)\/?$/u.exec(pathname);
  return regularConversation?.[1]
    ? { conversationId: regularConversation[1], projectId: null }
    : null;
}

function activeConversationReferences(document: Document, conversationId: string): ActiveConversationReference[] {
  return Array.from(document.querySelectorAll(PROJECT_LINK_SELECTOR))
    .filter((link) => {
      const current = link.getAttribute('aria-current');
      return !isHidden(link)
        && isOutsideMain(link)
        && current?.toLowerCase() === 'page';
    })
    .flatMap((link) => {
      const pathname = sameOriginPathname(link);
      const reference = pathname ? conversationReferenceFromPathname(pathname) : null;
      return reference?.conversationId === conversationId ? [{ ...reference, element: link }] : [];
    });
}

function uniqueNameEvidence(elements: readonly Element[]): ProjectNameEvidence | null {
  const evidence = elements.flatMap((element) => {
    const name = visibleText(element);
    return name ? [{ element, name }] : [];
  });
  const names = new Set(evidence.map(({ name }) => name));
  return names.size === 1 ? evidence[0] ?? null : null;
}

function sidebarProjectNames(document: Document): ReadonlySet<string> {
  return new Set(Array.from(document.querySelectorAll('div[role]'))
    .filter((element) => element.getAttribute('role') === 'button')
    .filter((element) => (element.getAttribute('class') ?? '').split(/\s+/u).includes('sidebar-item'))
    .filter((element) => isOutsideMain(element))
    .flatMap((element) => {
      const name = visibleText(element);
      return name ? [name] : [];
    }));
}

function projectNameForId(document: Document, projectId: string): ProjectNameEvidence | null {
  const matchingProjectLinks = Array.from(document.querySelectorAll(PROJECT_LINK_SELECTOR))
    .filter((link) => !isHidden(link))
    .filter((link) => projectIdFromProjectPathname(sameOriginPathname(link) ?? '') === projectId);
  const sidebarLinks = matchingProjectLinks.filter(isOutsideMain);
  if (sidebarLinks.length > 0) return uniqueNameEvidence(sidebarLinks);

  const confirmedSidebarNames = sidebarProjectNames(document);
  const mainLinks = matchingProjectLinks.filter((link) => {
    if (isOutsideMain(link)) return false;
    const name = visibleText(link);
    return name !== null && confirmedSidebarNames.has(name);
  });
  return uniqueNameEvidence(mainLinks);
}

export function resolveProjectContext(document: Document, pathname: string): ResolvedProjectContext | null {
  const urlProjectId = projectIdFromPathname(pathname);
  if (urlProjectId) {
    const currentConversation = projectConversationFromPathname(pathname);
    if (currentConversation) {
      const matchingActiveLinks = activeConversationReferences(document, currentConversation.conversationId);
      if (matchingActiveLinks.some((link) => link.projectId !== null && link.projectId !== urlProjectId)) return null;
    }
    const nameEvidence = projectNameForId(document, urlProjectId);
    return {
      projectId: urlProjectId,
      ...(nameEvidence ? { projectName: nameEvidence.name } : {}),
      evidence: nameEvidence?.element ?? null,
    };
  }

  const conversationId = /^\/c\/([A-Za-z0-9_-]+)\/?$/u.exec(pathname)?.[1];
  if (!conversationId) return null;
  const activeLinks = activeConversationReferences(document, conversationId);
  if (activeLinks.length !== 1 || !activeLinks[0]?.projectId) return null;

  const projectId = activeLinks[0].projectId;
  const nameEvidence = projectNameForId(document, projectId);
  return {
    projectId,
    ...(nameEvidence ? { projectName: nameEvidence.name } : {}),
    evidence: nameEvidence?.element ?? activeLinks[0].element,
  };
}
