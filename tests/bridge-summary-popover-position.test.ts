import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateBridgeSummaryPopoverPlacement } from '../src/content/bridge-summary-popover-position.ts';

test('Bridge counter popover stays inside viewport at each edge and scrolls within bounded height', () => {
  for (const trigger of [
    { top: 2, bottom: 30, left: 1, right: 45 },
    { top: 730, bottom: 758, left: 1200, right: 1278 },
  ]) {
    const placement = calculateBridgeSummaryPopoverPlacement(trigger, 1280, 768);
    assert.ok(placement.left >= 12);
    assert.ok(placement.left + placement.width <= 1268);
    assert.ok(placement.top >= 12);
    assert.ok(placement.top + placement.maxHeight <= 756);
    assert.ok(placement.maxHeight <= 360);
  }
});

test('narrow and short viewports still receive positive dimensions within the viewport', () => {
  const placement = calculateBridgeSummaryPopoverPlacement({ top: 3, bottom: 15, left: 0, right: 5 }, 30, 20);
  assert.deepEqual(placement, { top: 9.5, left: 12, width: 6, maxHeight: 1 });
  assert.ok(placement.top >= 0);
  assert.ok(placement.top + placement.maxHeight <= 20);
});
