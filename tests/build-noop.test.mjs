import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('build:noop creates a separately testable metadata-only package', () => {
  const root = mkdtempSync(join(tmpdir(), 'chatpanel-noop-'));
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));

  try {
    mkdirSync(join(root, 'scripts'));
    copyFileSync(join(projectRoot, 'package.json'), join(root, 'package.json'));
    copyFileSync(join(projectRoot, 'scripts', 'build-noop.mjs'), join(root, 'scripts', 'build-noop.mjs'));
    execFileSync(process.execPath, [join(root, 'scripts', 'build-noop.mjs')], { cwd: root });

    const manifest = JSON.parse(readFileSync(join(root, 'dist', 'manifest.json'), 'utf8'));
    assert.deepEqual(readdirSync(join(root, 'dist')), ['manifest.json']);
    assert.deepEqual(Object.keys(manifest).sort(), ['description', 'manifest_version', 'name', 'version']);
    assert.equal(manifest.name, 'ChatPanelPlus (無機能検証版)');
    assert.equal(manifest.version, '0.1.5');
    for (const field of ['permissions', 'host_permissions', 'content_scripts', 'background', 'options_ui']) {
      assert.equal(field in manifest, false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
