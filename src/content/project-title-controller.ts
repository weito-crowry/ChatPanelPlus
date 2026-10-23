import { resolveProjectContext } from './project-context.ts';
import {
  type ProjectNameSaveResult,
  type ProjectNamesLoadResult,
} from '../shared/project-names-repository.ts';

export const DEFAULT_PROJECT_PANEL_TITLE = 'ChatPanelPlus';
const ROUTE_POLL_MS = 250;
const DOM_UPDATE_DEBOUNCE_MS = 120;

export interface ProjectNamesRepositoryLike {
  loadNames(): Promise<ProjectNamesLoadResult>;
  saveName(projectId: string, projectName: string): Promise<ProjectNameSaveResult>;
}

export interface ProjectTitleControllerOptions {
  readonly document: Document;
  readonly window: Window;
  readonly repository: ProjectNamesRepositoryLike;
  readonly onTitleChange: (title: string) => void;
  readonly createMutationObserver?: (callback: () => void) => MutationObserver;
}

export class ProjectTitleController {
  private readonly options: ProjectTitleControllerOptions;
  private readonly observerFactory: (callback: () => void) => MutationObserver;
  private observer: MutationObserver | null = null;
  private routeTimer: number | undefined;
  private domUpdateTimer: number | undefined;
  private pathname: string;
  private projectId: string | null = null;
  private projectNameFromDom: string | null = null;
  private cacheRequestedId: string | null = null;
  private generation = 0;
  private title = '';
  private started = false;
  private disposed = false;

  constructor(options: ProjectTitleControllerOptions) {
    this.options = options;
    this.pathname = options.window.location.pathname;
    this.observerFactory = options.createMutationObserver ?? ((callback) => new MutationObserver(callback));
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.options.window.addEventListener('popstate', this.onNavigation);
    this.options.window.addEventListener('pageshow', this.onNavigation);
    this.options.window.addEventListener('pagehide', this.onPageHide);
    this.routeTimer = this.options.window.setInterval(this.checkPath, ROUTE_POLL_MS);
    if (this.options.document.documentElement) {
      this.observer = this.observerFactory(this.onDomChange);
      this.observer.observe(this.options.document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['aria-label', 'aria-hidden', 'aria-current', 'href', 'hidden', 'inert', 'style'],
      });
    }
    this.publish(DEFAULT_PROJECT_PANEL_TITLE);
    void this.refresh();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.options.window.removeEventListener('popstate', this.onNavigation);
    this.options.window.removeEventListener('pageshow', this.onNavigation);
    this.options.window.removeEventListener('pagehide', this.onPageHide);
    if (this.routeTimer !== undefined) this.options.window.clearInterval(this.routeTimer);
    if (this.domUpdateTimer !== undefined) this.options.window.clearTimeout(this.domUpdateTimer);
    this.routeTimer = undefined;
    this.domUpdateTimer = undefined;
    this.observer?.disconnect();
    this.observer = null;
  }

  private readonly onNavigation = (): void => {
    this.updatePath();
    void this.refresh();
  };

  private readonly onPageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) this.dispose();
  };

  private readonly checkPath = (): void => {
    if (this.options.window.location.pathname === this.pathname) return;
    this.updatePath();
    void this.refresh();
  };

  private readonly onDomChange = (): void => {
    if (this.disposed || this.domUpdateTimer !== undefined) return;
    this.domUpdateTimer = this.options.window.setTimeout(() => {
      this.domUpdateTimer = undefined;
      void this.refresh();
    }, DOM_UPDATE_DEBOUNCE_MS);
  };

  private updatePath(): void {
    const nextPath = this.options.window.location.pathname;
    if (nextPath === this.pathname) return;
    this.pathname = nextPath;
    this.generation += 1;
    this.projectId = null;
    this.projectNameFromDom = null;
    this.cacheRequestedId = null;
    this.publish(DEFAULT_PROJECT_PANEL_TITLE);
  }

  private async refresh(): Promise<void> {
    if (this.disposed) return;
    const context = resolveProjectContext(this.options.document, this.pathname);
    if (!context) {
      if (this.projectId !== null) this.generation += 1;
      this.projectId = null;
      this.projectNameFromDom = null;
      this.cacheRequestedId = null;
      this.publish(DEFAULT_PROJECT_PANEL_TITLE);
      return;
    }

    if (context.projectId !== this.projectId) {
      this.generation += 1;
      this.projectId = context.projectId;
      this.projectNameFromDom = null;
      this.cacheRequestedId = null;
      this.publish(DEFAULT_PROJECT_PANEL_TITLE);
    }

    if (context.projectName) {
      if (context.projectName !== this.projectNameFromDom) {
        this.projectNameFromDom = context.projectName;
        this.publish(context.projectName);
        void this.persistDomName(context.projectId, context.projectName);
      }
      return;
    }
    if (this.projectNameFromDom || this.cacheRequestedId === context.projectId) return;

    this.cacheRequestedId = context.projectId;
    const generation = this.generation;
    const loaded: ProjectNamesLoadResult = await this.options.repository.loadNames();
    if (this.disposed
      || generation !== this.generation
      || this.projectId !== context.projectId
      || this.projectNameFromDom !== null) return;
    const cachedName = loaded.ok ? loaded.names[context.projectId] : undefined;
    this.publish(cachedName || DEFAULT_PROJECT_PANEL_TITLE);
  }

  private async persistDomName(projectId: string, projectName: string): Promise<void> {
    const loaded = await this.options.repository.loadNames();
    if (this.disposed
      || this.projectId !== projectId
      || this.projectNameFromDom !== projectName
      || !loaded.ok
      || loaded.names[projectId] === projectName) return;
    await this.options.repository.saveName(projectId, projectName);
  }

  private publish(title: string): void {
    if (this.title === title) return;
    this.title = title;
    this.options.onTitleChange(title);
  }
}
