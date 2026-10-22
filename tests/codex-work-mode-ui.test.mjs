import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('one work-mode control remains outside the panel content hidden during minimization', async () => {
  const source = await readFile(resolve(root, 'src/content/Panel.tsx'), 'utf8');
  const contentIndex = source.indexOf('className="panel-content"');
  const controlIndex = source.indexOf('<CodexWorkModeToggle');

  assert.equal([...source.matchAll(/<CodexWorkModeToggle\b/g)].length, 1);
  assert.ok(controlIndex >= 0);
  assert.ok(controlIndex < contentIndex);
  assert.match(source, /minimized=\{currentViewState\.minimized\}/);
});

test('toggle exposes native button semantics, retry and explicit reset controls with visible focus', async () => {
  const control = await readFile(resolve(root, 'src/content/CodexWorkModeToggle.tsx'), 'utf8').catch(() => null);
  const styles = await readFile(resolve(root, 'src/content/panel.css'), 'utf8');
  assert.ok(control, 'Codex work mode toggle should be implemented');
  assert.match(control, /type="button"/);
  assert.match(control, /aria-label=\{presentation\.ariaLabel\}/);
  assert.match(control, /aria-pressed=\{presentation\.ariaPressed\}/);
  assert.match(control, /aria-live=\{/);
  assert.match(control, /controller\.retry\(\)/);
  assert.match(control, /controller\.initializeOff\(\)/);
  assert.match(control, /controller\.dispose\(\)/);
  assert.match(styles, /\.codex-work-mode-toggle:focus-visible[^{]*\{[^}]*outline:\s*2px solid/s);
  assert.match(styles, /\.panel\.is-minimized\s+\.codex-work-mode-control\s*\{/);
  assert.match(styles, /\.panel\.is-minimized\s+\.codex-work-mode-message\s*\{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/s);
  assert.match(styles, /@container\s*\(max-width:\s*248px\)/);
});
