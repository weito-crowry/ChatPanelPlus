import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ProjectTitleController,
  type ProjectNamesRepositoryLike,
} from '../src/content/project-title-controller.ts';
import {
  PROJECT_NAMES_STORAGE_KEY,
  ProjectNamesRepository,
  type ProjectNamesLoadResult,
} from '../src/shared/project-names-repository.ts';
import {
  FakeProjectDocument,
  FakeProjectElement,
  PROJECT_ALPHA_ID,
  PROJECT_DELTA_ID,
  PROJECT_GAMMA_ID,
  projectConversationLink,
  projectLink,
} from './project-dom-fixture.ts';

class FakeWindow {
  readonly location = { pathname: '/' };
  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  readonly intervals = new Map<number, () => void>();
  readonly timeouts = new Map<number, () => void>();
  private nextId = 0;

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: Event) => void>();
    listeners.add(listener as (event: Event) => void);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: EventListener): void { this.listeners.get(type)?.delete(listener as (event: Event) => void); }
  setInterval(callback: () => void): number { const id = ++this.nextId; this.intervals.set(id, callback); return id; }
  clearInterval(id: number): void { this.intervals.delete(id); }
  setTimeout(callback: () => void): number { const id = ++this.nextId; this.timeouts.set(id, callback); return id; }
  clearTimeout(id: number): void { this.timeouts.delete(id); }
  tick(): void { [...this.intervals.values()].forEach((callback) => callback()); }
  flushTimeouts(): void {
    const callbacks = [...this.timeouts.values()];
    this.timeouts.clear();
    callbacks.forEach((callback) => callback());
  }
  dispatch(type: string): void { this.listeners.get(type)?.forEach((listener) => listener(new Event(type))); }
}

function setup(
  pathname: string,
  names: Record<string, string> = {},
  repositoryOverride?: ProjectNamesRepositoryLike,
) {
  const document = new FakeProjectDocument();
  const window = new FakeWindow();
  window.location.pathname = pathname;
  const titles: string[] = [];
  const writes: Array<{ id: string; name: string }> = [];
  let notifyMutation = () => {};
  const repository: ProjectNamesRepositoryLike = repositoryOverride ?? {
    async loadNames() { return { ok: true as const, names: { ...names } }; },
    async saveName(id: string, name: string) {
      writes.push({ id, name });
      names[id] = name;
      return { ok: true as const };
    },
  };
  const controller = new ProjectTitleController({
    document: document as unknown as Document,
    window: window as unknown as Window,
    repository,
    onTitleChange: (title) => titles.push(title),
    createMutationObserver(callback) {
      notifyMutation = callback;
      return { observe() {}, disconnect() {} } as unknown as MutationObserver;
    },
  });
  return {
    document, window, controller, titles, writes,
    mutate() { notifyMutation(); window.flushTimeouts(); },
  };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

function addProjectNavigation(
  document: FakeProjectDocument,
  projectId: string,
  projectName: string,
  chatId = 'chat-1',
): FakeProjectElement {
  const navigation = new FakeProjectElement('nav');
  navigation.append(
    projectConversationLink(projectId, chatId, '会話タイトル', true),
    projectLink(projectId, projectName),
  );
  document.body.append(navigation);
  return navigation;
}

test('同じProject IDのキャッシュ名を再利用しDOMで確認した改名を保存する', async () => {
  const h = setup(`/g/${PROJECT_ALPHA_ID}-alpha-plan/c/chat-1`, { [PROJECT_ALPHA_ID]: '保存済みAlpha' });
  h.controller.start();
  await settle();
  assert.equal(h.titles.at(-1), '保存済みAlpha');

  addProjectNavigation(h.document, PROJECT_ALPHA_ID, 'Alpha新名称');
  h.mutate();
  await settle();

  assert.equal(h.titles.at(-1), 'Alpha新名称');
  assert.deepEqual(h.writes, [{ id: PROJECT_ALPHA_ID, name: 'Alpha新名称' }]);
  h.controller.dispose();
});

test('main内のprojectリンクが同IDの古いcache名より優先される', async () => {
  const h = setup(
    `/g/${PROJECT_DELTA_ID}-sample-project/c/chat-1`,
    { [PROJECT_DELTA_ID]: 'StaleCacheName' },
  );
  const sidebar = new FakeProjectElement('div', { role: 'button', class: 'sidebar-item' }, 'SampleProject');
  const navigation = new FakeProjectElement('nav');
  navigation.append(
    projectConversationLink(PROJECT_DELTA_ID, 'chat-1', 'Sample chat', true),
    projectConversationLink(PROJECT_ALPHA_ID, 'other-chat', '別Projectの会話'),
    projectLink(PROJECT_ALPHA_ID, '別Project'),
  );
  h.document.body.append(sidebar, navigation);
  h.document.main!.append(projectLink(PROJECT_DELTA_ID, 'SampleProject'));

  h.controller.start();
  await settle();

  assert.equal(h.titles.at(-1), 'SampleProject');
  assert.deepEqual(h.writes, [{ id: PROJECT_DELTA_ID, name: 'SampleProject' }]);
  h.controller.dispose();
});

test('遅れて返る古いcache名より現在DOMで確認したProject名を優先する', async () => {
  let resolveInitialLoad!: (result: ProjectNamesLoadResult) => void;
  const initialLoad = new Promise<ProjectNamesLoadResult>((resolve) => { resolveInitialLoad = resolve; });
  let loadCount = 0;
  const repository: ProjectNamesRepositoryLike = {
    loadNames() {
      loadCount += 1;
      return loadCount === 1
        ? initialLoad
        : Promise.resolve({ ok: true, names: { [PROJECT_ALPHA_ID]: '古いcache名' } });
    },
    async saveName() { return { ok: true }; },
  };
  const h = setup(`/g/${PROJECT_ALPHA_ID}/c/chat-1`, {}, repository);
  h.controller.start();
  await settle();

  addProjectNavigation(h.document, PROJECT_ALPHA_ID, '現在のDOM名');
  h.mutate();
  await settle();
  assert.equal(h.titles.at(-1), '現在のDOM名');

  resolveInitialLoad({ ok: true, names: { [PROJECT_ALPHA_ID]: '古いcache名' } });
  await settle();
  assert.equal(h.titles.at(-1), '現在のDOM名');
  h.controller.dispose();
});

test('DOMで保存したProject IDと名称の対応を次のページでも同じIDで再利用する', async () => {
  const data: Record<string, unknown> = {};
  const storage = {
    async get(keys: string[]) { return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]])); },
    async set(items: Record<string, unknown>) { Object.assign(data, items); },
  };
  const repository = new ProjectNamesRepository(storage);
  const firstDocument = new FakeProjectDocument();
  const firstWindow = new FakeWindow();
  firstWindow.location.pathname = `/g/${PROJECT_GAMMA_ID}-example-project/c/chat-1`;
  addProjectNavigation(firstDocument, PROJECT_GAMMA_ID, 'ExampleProject');
  const first = new ProjectTitleController({
    document: firstDocument as unknown as Document,
    window: firstWindow as unknown as Window,
    repository,
    onTitleChange() {},
    createMutationObserver: () => ({ observe() {}, disconnect() {} } as unknown as MutationObserver),
  });
  first.start();
  await settle();
  assert.deepEqual(data[PROJECT_NAMES_STORAGE_KEY], { [PROJECT_GAMMA_ID]: 'ExampleProject' });
  first.dispose();

  const secondDocument = new FakeProjectDocument();
  const secondWindow = new FakeWindow();
  secondWindow.location.pathname = `/g/${PROJECT_GAMMA_ID}-renamed-slug/c/chat-2`;
  const titles: string[] = [];
  const second = new ProjectTitleController({
    document: secondDocument as unknown as Document,
    window: secondWindow as unknown as Window,
    repository,
    onTitleChange: (title) => titles.push(title),
    createMutationObserver: () => ({ observe() {}, disconnect() {} } as unknown as MutationObserver),
  });
  second.start();
  await settle();
  assert.equal(titles.at(-1), 'ExampleProject');
  second.dispose();
});

test('Project名の表示後に通常chatへ移動すると旧Project名を残さない', async () => {
  const h = setup(`/g/${PROJECT_ALPHA_ID}/c/chat-1`);
  addProjectNavigation(h.document, PROJECT_ALPHA_ID, 'Alpha');
  h.controller.start();
  await settle();
  assert.equal(h.titles.at(-1), 'Alpha');

  h.window.location.pathname = '/c/regular-chat';
  h.window.tick();
  await settle();
  assert.equal(h.titles.at(-1), 'ChatPanelPlus');
  h.controller.dispose();
});

test('URLにIDがない初期表示ではactive sidebar conversationからProjectを解決する', async () => {
  const h = setup('/c/chat-1');
  addProjectNavigation(h.document, PROJECT_ALPHA_ID, 'Alpha');
  h.controller.start();
  await settle();

  assert.equal(h.titles.at(-1), 'Alpha');
  h.controller.dispose();
});

test('遅れて描画されたProject名をMutationObserver通知後に表示する', async () => {
  const h = setup(`/g/${PROJECT_ALPHA_ID}/c/chat-1`);
  h.controller.start();
  await settle();
  assert.equal(h.titles.at(-1), 'ChatPanelPlus');

  addProjectNavigation(h.document, PROJECT_ALPHA_ID, '遅延Alpha');
  h.mutate();
  await settle();

  assert.equal(h.titles.at(-1), '遅延Alpha');
  h.controller.dispose();
});

test('SPAの通常chat遷移とBFCache pageshowで既定見出しへ戻す', async () => {
  const h = setup(`/g/${PROJECT_ALPHA_ID}/c/chat-1`);
  addProjectNavigation(h.document, PROJECT_ALPHA_ID, 'Alpha');
  h.controller.start();
  await settle();

  h.window.location.pathname = '/c/regular-chat';
  h.window.tick();
  assert.equal(h.titles.at(-1), 'ChatPanelPlus');
  h.window.dispatch('pageshow');
  await settle();
  assert.equal(h.titles.at(-1), 'ChatPanelPlus');
  h.controller.dispose();
});
