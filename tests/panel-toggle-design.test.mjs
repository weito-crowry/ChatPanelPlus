import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const panelPath = resolve(root, 'src/content/PanelView.tsx');
const stylePath = resolve(root, 'src/content/panel-phase6.css');

test('最小化トグルはChevronを使い、名称・展開状態・既存click操作を示す', async () => {
  const source = await readFile(panelPath, 'utf8');
  const svg = source.match(/const MIN_ICON_SVG = (<svg[\s\S]*?<\/svg>);/)?.[1];
  const button = source.match(/<button type="button" className=\{'panel-minimize-toggle'[\s\S]*?<\/button>/)?.[0];

  assert.ok(svg);
  assert.ok(button);
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.match(svg, /<path d="m7 10 5 5 5-5"/);
  assert.match(button, /aria-label=\{currentViewState\.minimized \? '復帰' : '最小化'\}/);
  assert.match(button, /aria-expanded=\{!currentViewState\.minimized\}/);
  assert.match(button, /onClick=\{onToggleMinimized\}/);
});

test('最小化はヘッダー内で30px以上の操作領域と可視Chevronを保つ', async () => {
  const [source, styles] = await Promise.all([readFile(panelPath, 'utf8'), readFile(stylePath, 'utf8')]);
  const headerStart = source.indexOf('<header className="panel-header">');
  const headerEnd = source.indexOf('</header>', headerStart);
  const togglePosition = source.indexOf("className={'panel-minimize-toggle'");
  const buttonRule = styles.match(/\.panel-options-toggle, \.panel-minimize-toggle\s*\{([^}]+)\}/)?.[1];
  const iconRule = styles.match(/\.panel-minimize-icon\s*\{([^}]+)\}/)?.[1];

  assert.ok(headerStart >= 0 && headerEnd > headerStart);
  assert.ok(togglePosition > headerStart && togglePosition < headerEnd);
  assert.match(source.slice(headerStart, headerEnd), /<CodexWorkModeToggle/);
  assert.match(source.slice(headerStart, headerEnd), /<ConversationStatistics/);
  assert.match(source.slice(headerStart, headerEnd), /panel-options-toggle/);
  assert.ok(buttonRule);
  assert.ok(iconRule);
  assert.match(buttonRule, /width:\s*30px/);
  assert.match(buttonRule, /height:\s*30px/);
  assert.match(iconRule, /width:\s*18px/);
  assert.match(iconRule, /height:\s*18px/);
});

test('最小化行は本文を隠し、3件数と復帰Chevronを残す', async () => {
  const [source, styles] = await Promise.all([readFile(panelPath, 'utf8'), readFile(stylePath, 'utf8')]);

  assert.match(source, /panel-content" hidden=\{currentViewState\.minimized\}/);
  assert.match(source, /currentViewState\.minimized && <BridgeSummaryBar compact/);
  assert.match(styles, /\.panel\.is-minimized\s*\{[^}]*height:\s*auto[^}]*min-height:\s*0/s);
  assert.match(styles, /\.panel\.is-minimized \.panel-minimize-toggle\s*\{[^}]*clip-path:\s*none/s);
  assert.match(styles, /\.panel\.is-minimized \.phase6-bridge-counters\s*\{[^}]*width:\s*100%/s);
  assert.match(styles, /\.panel-minimize-toggle\.is-minimized \.panel-minimize-icon\s*\{[^}]*rotate\(180deg\)/s);
});
