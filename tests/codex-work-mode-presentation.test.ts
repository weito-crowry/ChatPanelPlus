import assert from 'node:assert/strict';
import test from 'node:test';
import { getCodexWorkModePresentation as presentation } from '../src/content/codex-work-mode-presentation.ts';

test('loading and unknown states do not publish an ON/OFF value', () => {
  const loading = presentation({ status: 'loading' }, false);
  const unknown = presentation({ status: 'unknown', reason: 'invalid-data', saving: false }, true);
  const expandedUnknown = presentation({ status: 'unknown', reason: 'invalid-data', saving: false }, false);
  assert.equal(loading.ariaPressed, undefined);
  assert.equal(loading.ariaBusy, true);
  assert.equal(loading.retryOnToggle, false);
  assert.equal(loading.disabled, true);
  assert.equal(unknown.ariaPressed, undefined);
  assert.equal(unknown.ariaBusy, false);
  assert.equal(unknown.disabled, false);
  assert.equal(unknown.retryOnToggle, true);
  assert.equal(unknown.showInitialize, false);
  assert.equal(expandedUnknown.showInitialize, true);
});

test('ready state uses ON/OFF text, aria-pressed, and compact minimized labels', () => {
  const expanded = presentation({ status: 'ready', enabled: true, saving: false }, false);
  const minimized = presentation({ status: 'ready', enabled: true, saving: false }, true);
  assert.equal(expanded.label, 'Codex作業中: ON');
  assert.equal(expanded.ariaPressed, true);
  assert.match(expanded.ariaLabel, /手動表示/);
  assert.match(expanded.ariaLabel, /実稼働状態とは連動しません/);
  assert.equal(minimized.label, 'ON');
  assert.equal(minimized.ariaPressed, true);
});

test('saving disables repeated activation and write errors stay visible', () => {
  const saving = presentation({ status: 'ready', enabled: false, saving: true }, false);
  const initializing = presentation({ status: 'unknown', reason: 'invalid-data', saving: true }, true);
  const failed = presentation({ status: 'ready', enabled: false, saving: false, notice: 'write-failed' }, false);
  assert.equal(saving.disabled, true);
  assert.equal(saving.message?.role, 'status');
  assert.equal(initializing.disabled, true);
  assert.equal(initializing.ariaPressed, undefined);
  assert.equal(initializing.ariaBusy, true);
  assert.equal(initializing.message?.role, 'status');
  assert.match(initializing.message?.text ?? '', /初期化中/);
  assert.equal(initializing.showInitialize, false);
  assert.equal(failed.disabled, false);
  assert.equal(failed.message?.role, 'alert');
  assert.match(failed.message?.text ?? '', /保存できません/);
});
