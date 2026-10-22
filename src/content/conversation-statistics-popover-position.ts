export interface StatisticsPopoverPlacement {
  readonly side: 'above' | 'below';
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly maxHeight: number;
}

export function calculateStatisticsPopoverPlacement(
  trigger: DOMRect,
  viewportWidth: number,
  viewportHeight: number,
  composer: DOMRect | null,
): StatisticsPopoverPlacement {
  const padding = 12;
  const gap = 8;
  const width = Math.max(1, Math.min(320, viewportWidth - padding * 2));
  const left = Math.max(padding, Math.min(trigger.right - width, viewportWidth - width - padding));
  const composerOverlaps = Boolean(composer && left < composer.right && left + width > composer.left);
  const composerCrossesAboveEdge = composerOverlaps && composer!.top < trigger.top && composer!.bottom > trigger.top;
  const aboveBoundary = composerOverlaps && composer!.bottom <= trigger.top
    ? composer!.bottom + gap
    : composerCrossesAboveEdge ? trigger.top - gap : padding;
  const belowStart = composerOverlaps && composer!.top < trigger.bottom && composer!.bottom > trigger.bottom
    ? composer!.bottom + gap
    : trigger.bottom + gap;
  const bottomLimit = Math.min(viewportHeight - padding,
    composerOverlaps && composer!.top >= trigger.bottom ? composer!.top - gap : viewportHeight - padding);
  const aboveSpace = Math.max(0, trigger.top - gap - aboveBoundary);
  const belowSpace = Math.max(0, bottomLimit - belowStart);
  const side = aboveSpace >= 200 || aboveSpace >= belowSpace ? 'above' : 'below';
  const availableSpace = side === 'above' ? aboveSpace : belowSpace;
  const maxHeight = Math.min(480, availableSpace);
  const top = side === 'above' ? trigger.top - gap - maxHeight : belowStart;
  return { side, top, left, width, maxHeight };
}
