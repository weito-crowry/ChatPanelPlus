export type BridgeSummaryPopoverPlacement = Readonly<{ top: number; left: number; width: number; maxHeight: number }>;

export function calculateBridgeSummaryPopoverPlacement(
  trigger: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>,
  viewportWidth: number,
  viewportHeight: number,
): BridgeSummaryPopoverPlacement {
  const padding = 12;
  const gap = 8;
  const width = Math.max(1, Math.min(320, viewportWidth - padding * 2));
  const left = Math.max(padding, Math.min(trigger.right - width, viewportWidth - width - padding));
  const maxAvailableHeight = Math.max(1, Math.min(360, viewportHeight - padding * 2));
  const aboveSpace = Math.max(0, trigger.top - gap - padding);
  const belowSpace = Math.max(0, viewportHeight - padding - trigger.bottom - gap);
  const placeAbove = aboveSpace >= Math.min(maxAvailableHeight, 180) || aboveSpace >= belowSpace;
  const maxHeight = Math.max(1, Math.min(maxAvailableHeight, placeAbove ? aboveSpace : belowSpace));
  const inset = Math.min(padding, Math.max(0, (viewportHeight - maxHeight) / 2));
  const proposedTop = placeAbove ? trigger.top - gap - maxHeight : trigger.bottom + gap;
  const top = Math.max(inset, Math.min(proposedTop, viewportHeight - inset - maxHeight));
  return { top, left, width, maxHeight };
}
