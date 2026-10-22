import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const panelPath = resolve(root, 'src/content/Panel.tsx');
const stylePath = resolve(root, 'src/content/panel.css');

test('最小化トグルはTampermonkey v7.2のSVG viewBoxと全パス座標を保持する', async () => {
  const source = await readFile(panelPath, 'utf8');
  const svg = source.match(/const MIN_ICON_SVG = \(([\s\S]*?)\);/)?.[1];

  assert.ok(svg);
  assert.match(svg, /viewBox="0 0 320 120"/);
  assert.match(svg, /width="140" height="52"/);
  assert.match(svg, /<g fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">/);
  assert.deepEqual(
    [...svg.matchAll(/<path d="([^"]+)" \/>/g)].map(([, path]) => path),
    [
      'M40 60 L100 60',
      'M100 60 C110 60, 110 85, 130 85 L190 85',
      'M190 85 C210 85, 210 60, 220 60 L280 60',
      'M140 64 L160 78 L180 64',
    ],
  );
  assert.doesNotMatch(svg, /toggle-handle|M5 2h130/);
});

test('168x72のクリック領域は140x52のSVGと分離し、パネル操作列を避ける', async () => {
  const [source, styles] = await Promise.all([
    readFile(panelPath, 'utf8'),
    readFile(stylePath, 'utf8'),
  ]);
  const hostRule = styles.match(/:host\s*\{([^}]+)\}/)?.[1];
  const panelRule = styles.match(/\.panel\s*\{([^}]+)\}/)?.[1];
  const minimizedPanelRule = styles.match(/\.panel\.is-minimized\s*\{([^}]+)\}/)?.[1];
  const buttonRule = styles.match(/^\.panel-minimize-toggle\s*\{([^}]+)\}/m)?.[1];
  const minimizedButtonRule = styles.match(/\.panel\.is-minimized\s+\.panel-minimize-toggle\s*\{([^}]+)\}/)?.[1];
  const iconRule = styles.match(/\.panel-minimize-icon\s*\{([^}]+)\}/)?.[1];
  const value = (rule, property) => Number(rule?.match(new RegExp(`${property}:\\s*(-?\\d+)(?:px)?`))?.[1]);
  const lineHeight = Number(hostRule?.match(/line-height:\s*([\d.]+)/)?.[1]);
  const marginBottom = Number(hostRule?.match(/margin:\s*0 auto (\d+)px/)?.[1]);

  assert.ok(hostRule);
  assert.ok(panelRule);
  assert.ok(minimizedPanelRule);
  assert.ok(buttonRule);
  assert.ok(minimizedButtonRule);
  assert.ok(iconRule);
  assert.equal(value(buttonRule, 'width'), 168);
  assert.equal(value(buttonRule, 'height'), 72);
  assert.equal(value(buttonRule, 'top'), 0);
  assert.match(buttonRule, /left:\s*50%/);
  assert.match(buttonRule, /background:\s*transparent/);
  assert.match(buttonRule, /transform:\s*translate\(-50%,\s*-50%\)/);
  assert.equal(value(iconRule, 'width'), 140);
  assert.equal(value(iconRule, 'height'), 52);
  assert.ok(value(buttonRule, 'width') > value(iconRule, 'width'));
  assert.match(iconRule, /top:\s*50%/);
  assert.match(iconRule, /left:\s*50%/);
  assert.match(iconRule, /transform:\s*translate\(-50%,\s*-50%\)/);
  const clickRegionBottom = value(buttonRule, 'height') / 2;
  const firstActionsTop = value(panelRule, 'padding') + value(hostRule, 'font-size') * lineHeight + value(panelRule, 'gap');
  assert.ok(clickRegionBottom < firstActionsTop);
  const bottomInset = Number(minimizedButtonRule.match(/clip-path:\s*inset\(0 0 ([\d.]+)%\)/)?.[1]);
  const minimizedClickRegionBottom = value(buttonRule, 'height') * (1 - bottomInset / 100) - value(buttonRule, 'height') / 2;
  assert.ok(minimizedClickRegionBottom < value(minimizedPanelRule, 'height') + marginBottom);
  assert.match(iconRule, /pointer-events:\s*none/);
  assert.match(source, /className=\{`panel-minimize-toggle\$\{currentViewState\.minimized \? ' is-minimized' : ''\}`\}/);
});

test('原典の通常色・ホバー色を使い、最小化時はSVG全体を180度回転する', async () => {
  const styles = await readFile(stylePath, 'utf8');

  assert.match(styles, /\.panel-minimize-toggle\s*\{[^}]*color:\s*var\(--border-medium,\s*#c8ccd1\)/s);
  assert.match(styles, /\.panel-minimize-toggle:hover\s*\{[^}]*color:\s*var\(--text-tertiary,\s*#aeb6bf\)/s);
  assert.match(styles, /\.panel-minimize-toggle\.is-minimized\s+\.panel-minimize-icon\s*\{[^}]*rotate\(180deg\)/s);
});
