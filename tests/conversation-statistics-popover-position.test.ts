import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateStatisticsPopoverPlacement } from '../src/content/conversation-statistics-popover-position.ts';

const rect = (left: number, top: number, right: number, bottom: number) => ({
  left, top, right, bottom, width: right - left, height: bottom - top,
}) as DOMRect;

test('空きがある場合はポップオーバーをトリガーより上に置き入力欄から離す', () => {
  const placement = calculateStatisticsPopoverPlacement(rect(900, 520, 970, 550), 1_200, 900, rect(200, 800, 1_100, 890));
  assert.equal(placement.side, 'above');
  assert.ok(placement.top + placement.maxHeight < 520);
  assert.ok(placement.left + placement.width <= 1_188);
});

test('上側が狭い場合は入力欄より上に収まる下側配置を選ぶ', () => {
  const placement = calculateStatisticsPopoverPlacement(rect(800, 40, 970, 68), 1_000, 700, rect(100, 500, 950, 680));
  assert.equal(placement.side, 'below');
  assert.ok(placement.top >= 12);
  assert.ok(placement.top + placement.maxHeight < 500);
});

test('狭い画面では横位置と幅を画面内へ制限する', () => {
  const placement = calculateStatisticsPopoverPlacement(rect(180, 240, 215, 260), 240, 480, null);
  assert.ok(placement.left >= 12);
  assert.ok(placement.left + placement.width <= 228);
});

test('Composerがトリガーより上にある場合も小窓をComposerに重ねない', () => {
  const composer = rect(200, 500, 950, 580);
  const trigger = rect(800, 600, 970, 630);
  const placement = calculateStatisticsPopoverPlacement(trigger, 1_000, 700, composer);
  assert.equal(placement.side, 'below');
  assert.ok(placement.top >= 638);
});
