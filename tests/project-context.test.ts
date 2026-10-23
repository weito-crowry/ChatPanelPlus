import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProjectContext } from '../src/content/project-context.ts';
import {
  FakeProjectDocument,
  FakeProjectElement,
  PROJECT_ALPHA_ID,
  PROJECT_BETA_ID,
  PROJECT_DELTA_ID,
  PROJECT_GAMMA_ID,
  projectConversationLink,
  projectLink,
} from './project-dom-fixture.ts';

test('slug付きProject chat URLでcanonical IDを照合して正式Projectリンク名を使う', () => {
  const document = new FakeProjectDocument();
  const navigation = new FakeProjectElement('nav');
  navigation.append(
    projectConversationLink(PROJECT_GAMMA_ID, 'chat-1', '会話タイトル', true),
    projectConversationLink(PROJECT_BETA_ID, 'chat-2', '別Projectの会話'),
    projectLink(PROJECT_GAMMA_ID, 'ExampleProject'),
    projectLink(PROJECT_BETA_ID, '別Project'),
  );
  document.body.append(navigation);

  const mainHeader = new FakeProjectElement('header');
  mainHeader.append(projectLink(PROJECT_GAMMA_ID, 'コンテンツへスキップ'));
  document.main!.append(mainHeader, new FakeProjectElement('h1', {}, '会話タイトル'));

  const context = resolveProjectContext(
    document as unknown as Document,
    `/g/${PROJECT_GAMMA_ID}-example-project/c/chat-1`,
  );
  assert.equal(context?.projectId, PROJECT_GAMMA_ID);
  assert.equal(context?.projectName, 'ExampleProject');
});

test('slug付きProject URLで同IDのprojectリンクをmain内に置いても名前を使う', () => {
  const document = new FakeProjectDocument();
  const sidebar = new FakeProjectElement('div', { role: 'button', class: 'sidebar-item' }, 'SampleProject');
  const navigation = new FakeProjectElement('nav');
  navigation.append(
    projectConversationLink(PROJECT_DELTA_ID, 'chat-1', 'Sample chat', true),
    projectConversationLink(PROJECT_BETA_ID, 'other-chat', '別Projectの会話'),
    projectLink(PROJECT_BETA_ID, '別Project'),
  );
  document.body.append(sidebar, navigation);
  document.main!.append(projectLink(PROJECT_DELTA_ID, 'SampleProject'));

  const context = resolveProjectContext(
    document as unknown as Document,
    `/g/${PROJECT_DELTA_ID}-sample-project/c/chat-1`,
  );
  assert.equal(context?.projectId, PROJECT_DELTA_ID);
  assert.equal(context?.projectName, 'SampleProject');
});

test('main内の同IDスキップリンクはsidebar Project名で裏付けられなければ採用しない', () => {
  const document = new FakeProjectDocument();
  document.body.append(new FakeProjectElement('div', { role: 'button', class: 'sidebar-item' }, 'SampleProject'));
  document.main!.append(projectLink(PROJECT_DELTA_ID, 'コンテンツへスキップ'));

  const context = resolveProjectContext(
    document as unknown as Document,
    `/g/${PROJECT_DELTA_ID}-sample-project/c/chat-1`,
  );
  assert.equal(context?.projectId, PROJECT_DELTA_ID);
  assert.equal(context?.projectName, undefined);
});

test('URLにslugがなくてもURLのProject IDと同じsidebar表示リンク名を取得する', () => {
  const document = new FakeProjectDocument();
  const navigation = new FakeProjectElement('nav');
  navigation.append(projectLink(PROJECT_ALPHA_ID, 'Alpha計画'));
  document.body.append(navigation);

  const context = resolveProjectContext(
    document as unknown as Document,
    `/g/${PROJECT_ALPHA_ID}/c/chat-1`,
  );
  assert.equal(context?.projectId, PROJECT_ALPHA_ID);
  assert.equal(context?.projectName, 'Alpha計画');
});

test('URLにProject IDがない会話ではaria-current pageの一致する会話リンクだけから所属を解決する', () => {
  const document = new FakeProjectDocument();
  const navigation = new FakeProjectElement('nav');
  navigation.append(
    projectConversationLink(PROJECT_ALPHA_ID, 'chat-1', '会話タイトル', true),
    projectConversationLink(PROJECT_BETA_ID, 'chat-2', '別Projectの会話'),
    projectLink(PROJECT_ALPHA_ID, 'Alpha計画'),
    projectLink(PROJECT_BETA_ID, 'Beta計画'),
  );
  document.body.append(navigation);

  const context = resolveProjectContext(document as unknown as Document, '/c/chat-1');
  assert.equal(context?.projectId, PROJECT_ALPHA_ID);
  assert.equal(context?.projectName, 'Alpha計画');
});

test('sidebarの意味的なwrapperがnavでなくてもactive linkと正式Project linkを利用する', () => {
  const document = new FakeProjectDocument();
  const sidebar = new FakeProjectElement('div', { 'data-testid': 'sidebar' });
  sidebar.append(
    projectConversationLink(PROJECT_ALPHA_ID, 'chat-1', '会話タイトル', true),
    projectLink(PROJECT_ALPHA_ID, 'Alpha計画'),
  );
  document.body.append(sidebar);

  const context = resolveProjectContext(document as unknown as Document, '/c/chat-1');
  assert.equal(context?.projectId, PROJECT_ALPHA_ID);
  assert.equal(context?.projectName, 'Alpha計画');
});

test('active conversationのタイトルをProject名として使わず同じIDの正式Projectリンクを選ぶ', () => {
  const document = new FakeProjectDocument();
  const navigation = new FakeProjectElement('nav');
  navigation.append(
    projectConversationLink(PROJECT_ALPHA_ID, 'chat-1', '会話タイトル', true),
    projectLink(PROJECT_ALPHA_ID, 'ExampleProject'),
  );
  document.body.append(navigation);

  const context = resolveProjectContext(document as unknown as Document, '/c/chat-1');
  assert.equal(context?.projectName, 'ExampleProject');
});

test('Project URLと同一会話を示すactive linkのProject IDが食い違えばfallbackする', () => {
  const document = new FakeProjectDocument();
  const navigation = new FakeProjectElement('nav');
  navigation.append(
    projectConversationLink(PROJECT_BETA_ID, 'chat-1', '別Projectの会話', true),
    projectLink(PROJECT_ALPHA_ID, 'Alpha計画'),
  );
  document.body.append(navigation);

  assert.equal(
    resolveProjectContext(document as unknown as Document, `/g/${PROJECT_ALPHA_ID}/c/chat-1`),
    null,
  );
});

test('sidebarにProject一覧があるだけでは通常chatの所属を推定しない', () => {
  const document = new FakeProjectDocument();
  const navigation = new FakeProjectElement('nav', { 'aria-label': 'Projects' });
  navigation.append(projectLink(PROJECT_ALPHA_ID, 'Alpha計画'));
  document.body.append(navigation);

  assert.equal(resolveProjectContext(document as unknown as Document, '/c/chat-1'), null);
});

test('通常chatのaria-current linkやGPT routeをProjectとして扱わない', () => {
  const document = new FakeProjectDocument();
  const navigation = new FakeProjectElement('nav');
  navigation.append(
    new FakeProjectElement('a', { href: 'https://chatgpt.com/c/chat-1', 'aria-current': 'page' }, '通常会話'),
    projectLink(PROJECT_ALPHA_ID, 'Alpha計画'),
  );
  document.body.append(navigation);

  assert.equal(resolveProjectContext(document as unknown as Document, '/c/chat-1'), null);
  assert.equal(
    resolveProjectContext(document as unknown as Document, '/g/custom-gpt/c/chat-1'),
    null,
  );
});

test('hiddenな正式Projectリンクから名前を取得しない', () => {
  const document = new FakeProjectDocument();
  const navigation = new FakeProjectElement('nav');
  const hidden = projectLink(PROJECT_ALPHA_ID, '古いAlpha名');
  hidden.visible = false;
  navigation.append(hidden);
  document.body.append(navigation);

  const context = resolveProjectContext(
    document as unknown as Document,
    `/g/${PROJECT_ALPHA_ID}/c/chat-1`,
  );
  assert.equal(context?.projectId, PROJECT_ALPHA_ID);
  assert.equal(context?.projectName, undefined);
});

test('Project IDに対応する正式リンクがない時は会話タイトルを使わない', () => {
  const document = new FakeProjectDocument();
  document.main!.append(new FakeProjectElement('h1', {}, '古い通常chatタイトル'));

  const context = resolveProjectContext(
    document as unknown as Document,
    `/g/${PROJECT_ALPHA_ID}/c/chat-1`,
  );
  assert.equal(context?.projectId, PROJECT_ALPHA_ID);
  assert.equal(context?.projectName, undefined);
});

test('同一chatIdを指す複数の異なるactive Project linkは曖昧として採用しない', () => {
  const document = new FakeProjectDocument();
  const navigation = new FakeProjectElement('nav');
  navigation.append(
    projectConversationLink(PROJECT_ALPHA_ID, 'chat-1', 'Alpha会話', true),
    projectConversationLink(PROJECT_BETA_ID, 'chat-1', 'Beta会話', true),
    projectLink(PROJECT_ALPHA_ID, 'Alpha'),
    projectLink(PROJECT_BETA_ID, 'Beta'),
  );
  document.body.append(navigation);

  assert.equal(resolveProjectContext(document as unknown as Document, '/c/chat-1'), null);
});
