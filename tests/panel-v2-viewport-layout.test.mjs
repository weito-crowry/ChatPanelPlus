import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('通常パネルはviewport内に収まり、ヘッダーを残して本文を内部スクロールする', async () => {
  const [styles, view] = await Promise.all([
    read('../src/content/panel-phase6.css'),
    read('../src/content/PanelView.tsx'),
  ]);
  assert.match(styles, /max-height:\s*calc\(100vh\s*-\s*16px\)/);
  assert.match(styles, /@supports\s*\(height:\s*100dvh\)[\s\S]*?max-height:\s*calc\(100dvh\s*-\s*16px\)/);
  assert.match(styles, /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/);
  assert.match(styles, /\.panel-content\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(view, /<header className="panel-header"[\s\S]*?<div className="panel-content"/);
  assert.match(styles, /\.codex-bridge-answer-text\s*\{\s*max-height:\s*32vh\s*;/);
});

test('本文スクロールはページのスクロール連鎖を阻害せず、最小化の既存上書きを保つ', async () => {
  const [styles, baseStyles] = await Promise.all([
    read('../src/content/panel-phase6.css'),
    read('../src/content/panel.css'),
  ]);
  assert.doesNotMatch(styles, /\.panel-content\s*\{[^}]*overscroll-behavior\s*:\s*contain/s);
  assert.doesNotMatch(styles, /\.codex-bridge-answer-text\s*\{[^}]*position\s*:\s*fixed/s);
  assert.match(styles, /\.panel\.is-minimized\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*0/);
  assert.match(baseStyles, /\.panel-content\[hidden\]\s*\{\s*display:\s*none;/);
});
