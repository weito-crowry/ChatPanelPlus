import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const rootDirectory = resolve(fileURLToPath(new URL('../', import.meta.url)));
const distDirectory = resolve(rootDirectory, 'dist');
const manifest = JSON.parse(await readFile(resolve(distDirectory, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(await readFile(resolve(rootDirectory, 'package.json'), 'utf8'));
const browserGlobalBindings = new Set(['document', 'navigator', 'window', 'console', 'performance']);

function collectBindingNames(name, names) {
  if (ts.isIdentifier(name)) {
    names.push(name.text);
    return;
  }

  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) collectBindingNames(element.name, names);
    }
  }
}

test('default build contains the complete extension output and no extra files', async () => {
  const entries = (await readdir(distDirectory)).sort();
  const assetEntries = (await readdir(resolve(distDirectory, 'assets'))).sort();

  assert.deepEqual(entries, [
    'assets',
    'background.js',
    'clipboard-probe.css',
    'clipboard-probe.html',
    'clipboard-probe.js',
    'content.js',
    'index.html',
    'manifest.json',
  ]);
  assert.equal(assetEntries.length, 2);
  assert.ok(assetEntries.some((entry) => /^index-.+\.js$/.test(entry)));
  assert.ok(assetEntries.some((entry) => /^index-.+\.css$/.test(entry)));
});

test('manifest has the production development identity and a package-matched version', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'ChatPanelPlus');
  assert.equal(manifest.version, '0.1.5');
  assert.equal(packageJson.version, manifest.version);
  assert.equal(manifest.description, 'ChatGPT上の入力欄へ定型文や現在時刻を挿入し、クリップボードの貼り付けと入力欄のクリアを行います。ボタン・タブの表示、順序、ラベル、色、定型文を設定できます。');
});

test('manifest declares only the expected ChatGPT content script, worker, and options page', async () => {
  assert.deepEqual(manifest.content_scripts, [{
    matches: ['https://chatgpt.com/*'],
    js: ['content.js'],
    run_at: 'document_idle',
  }]);
  assert.deepEqual(manifest.background, { service_worker: 'background.js' });
  assert.deepEqual(manifest.options_ui, { page: 'index.html', open_in_tab: true });
  assert.deepEqual(manifest.permissions, ['clipboardRead', 'storage']);
  for (const field of ['host_permissions', 'optional_host_permissions']) {
    assert.equal(field in manifest, false, `${field} must not be present.`);
  }

  for (const referencedFile of ['content.js', 'background.js', 'index.html']) {
    await assert.doesNotReject(readFile(resolve(distDirectory, referencedFile)));
  }
});

test('built output includes the panel bootstrap, options UI, and options message handler', async () => {
  const content = await readFile(resolve(distDirectory, 'content.js'), 'utf8');
  const background = await readFile(resolve(distDirectory, 'background.js'), 'utf8');
  const html = await readFile(resolve(distDirectory, 'index.html'), 'utf8');

  assert.match(content, /chatpanelplus-extension-root/);
  assert.match(content, /attachShadow/);
  assert.match(content, /ChatPanelPlus/);
  assert.match(background, /openOptionsPage/);
  assert.match(html, /assets\/index-.+\.js/);
  assert.match(html, /assets\/index-.+\.css/);
  assert.match(await readFile(resolve(distDirectory, 'clipboard-probe.html'), 'utf8'), /clipboard-probe\.js/);
  assert.match(await readFile(resolve(distDirectory, 'clipboard-probe.js'), 'utf8'), /execCommand\('paste'\)/);
  assert.match(await readFile(resolve(distDirectory, 'clipboard-probe.html'), 'utf8'), /clipboard-probe\.css/);
});

test('clipboard probe output parses and avoids duplicate classic-script globals', async () => {
  const probePath = resolve(distDirectory, 'clipboard-probe.js');
  const probe = await readFile(probePath, 'utf8');
  assert.doesNotThrow(() => new Script(probe, { filename: probePath }));

  const sourceFile = ts.createSourceFile(probePath, probe, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(sourceFile.parseDiagnostics.length, 0);
  const declaredBindings = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      collectBindingNames(declaration.name, declaredBindings);
    }
  }
  assert.deepEqual(declaredBindings.filter((name) => browserGlobalBindings.has(name)), []);

  const html = await readFile(resolve(distDirectory, 'clipboard-probe.html'), 'utf8');
  const probeScriptLoads = [...html.matchAll(/<script\b[^>]*\bsrc=["']clipboard-probe\.js["'][^>]*>\s*<\/script>/g)];
  assert.equal(probeScriptLoads.length, 1);
});
