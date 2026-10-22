import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertLocalAssetReferences } from '../scripts/deployment-assets.mjs';

const projectRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));

async function runIsolatedDeploymentValidation(manifest) {
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'chatpanelplus-deploy-validation-'));
  try {
    const project = join(sandboxRoot, 'project');
    const scripts = join(project, 'scripts');
    const dist = join(project, 'dist');
    const destination = join(sandboxRoot, 'ChatPanelPlus-Content-Probe-20261021');
    await Promise.all([
      mkdir(scripts, { recursive: true }),
      mkdir(dist, { recursive: true }),
      mkdir(destination, { recursive: true }),
    ]);
    await copyFile(join(projectRoot, 'scripts', 'deploy-chrome.mjs'), join(scripts, 'deploy-chrome.mjs'));
    await copyFile(join(projectRoot, 'scripts', 'deployment-assets.mjs'), join(scripts, 'deployment-assets.mjs'));
    await writeFile(join(project, 'package.json'), JSON.stringify({ version: manifest.version }));
    await mkdir(join(project, 'public'), { recursive: true });
    await writeFile(join(project, 'public', 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(dist, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(dist, 'content.js'), 'void 0;');
    await writeFile(join(dist, 'background.js'), 'void 0;');
    await writeFile(join(dist, 'index.html'), '<script src="https://invalid.test/options.js"></script>');
    await writeFile(join(destination, 'existing.txt'), 'must remain untouched');

    const result = spawnSync(process.execPath, [join(scripts, 'deploy-chrome.mjs')], {
      cwd: project,
      encoding: 'utf8',
    });
    const after = await readFile(join(destination, 'existing.txt'), 'utf8');
    return { ...result, after, sandboxRoot };
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
}

function validDeploymentManifest(overrides = {}) {
  return {
    manifest_version: 3,
    version: '0.1.5',
    content_scripts: [{ matches: ['https://chatgpt.com/*'], js: ['content.js'] }],
    background: { service_worker: 'background.js' },
    options_ui: { page: 'index.html' },
    permissions: ['clipboardRead', 'storage'],
    ...overrides,
  };
}

test('deployment accepts existing local Options assets', () => {
  const assets = new Set(['assets/options.js', 'assets/options.css']);
  assert.deepEqual(
    assertLocalAssetReferences('<script src="./assets/options.js"></script><link href="assets/options.css">', assets),
    ['assets/options.js', 'assets/options.css'],
  );
});

test('deployment rejects missing, external, and escaping Options assets', () => {
  const assets = new Set(['assets/options.js']);
  assert.throws(() => assertLocalAssetReferences('<script src="./assets/missing.js"></script>', assets), /missing asset/);
  assert.throws(() => assertLocalAssetReferences('<script src="https://example.test/app.js"></script>', assets), /local assets/);
  assert.throws(() => assertLocalAssetReferences('<script src="./assets/..\\outside.js"></script>', assets), /local assets/);
});

test('deployment validation accepts clipboardRead and storage before rejecting a later invalid asset', async () => {
  const result = await runIsolatedDeploymentValidation(validDeploymentManifest());

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /local assets/);
  assert.equal(result.after, 'must remain untouched');
});

test('deployment validation rejects unapproved additional permissions before any backup or copy', async () => {
  const result = await runIsolatedDeploymentValidation(validDeploymentManifest({
    permissions: ['clipboardRead', 'storage', 'tabs'],
  }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /permissions/);
  assert.equal(result.after, 'must remain untouched');
});

test('deployment validation requires both approved permissions exactly once', async () => {
  for (const permissions of [['storage'], ['clipboardRead', 'clipboardRead']]) {
    const result = await runIsolatedDeploymentValidation(validDeploymentManifest({ permissions }));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /only clipboardRead and storage permissions/);
    assert.equal(result.after, 'must remain untouched');
  }
});

test('deployment validation continues to reject host and optional host permissions', async () => {
  for (const field of ['host_permissions', 'optional_host_permissions']) {
    const result = await runIsolatedDeploymentValidation(validDeploymentManifest({ [field]: [] }));

    assert.notEqual(result.status, 0, `${field} must remain forbidden`);
    assert.match(result.stderr, new RegExp(field));
    assert.equal(result.after, 'must remain untouched');
  }
});
