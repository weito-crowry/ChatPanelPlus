import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { calculateBridgeSummaryPopoverPlacement, type BridgeSummaryPopoverPlacement } from './bridge-summary-popover-position.ts';

export const HOVER_OPEN_DELAY_MS = 200;

type Props = Readonly<{
  label: string;
  value: number | string;
  description: string;
  children: ReactNode;
  onActivate?: () => void;
  disabled?: boolean;
}>;

export function BridgeSummaryCounter({ label, value, description, children, onActivate, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<BridgeSummaryPopoverPlacement | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const popover = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const popoverId = useId();
  const ariaLabel = onActivate
    ? `${label} ${value}件。${disabled ? '現在は操作できません。' : description}`
    : `${label} ${value}件。${description}`;

  const clearTimers = useCallback(() => {
    if (openTimer.current !== undefined) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    openTimer.current = undefined;
    closeTimer.current = undefined;
  }, []);

  const show = useCallback(() => {
    clearTimers();
    setOpen(true);
  }, [clearTimers]);

  const scheduleShow = useCallback(() => {
    if (open || openTimer.current !== undefined) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = undefined;
      setOpen(true);
    }, HOVER_OPEN_DELAY_MS);
  }, [open]);

  const scheduleClose = useCallback(() => {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = undefined;
      setOpen(false);
    }, 140);
  }, []);

  function handleBlur(event: FocusEvent<HTMLElement>) {
    if (event.relatedTarget instanceof Node && popover.current?.contains(event.relatedTarget)) return;
    setOpen(false);
    clearTimers();
  }

  function handlePointerEnter() { clearTimers(); scheduleShow(); }
  function handlePointerLeave() { scheduleClose(); }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      setOpen(false);
      clearTimers();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [clearTimers, open]);

  useLayoutEffect(() => {
    if (!open) { setPlacement(null); return; }
    const reposition = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setPlacement(calculateBridgeSummaryPopoverPlacement(rect, window.innerWidth, window.innerHeight));
    };
    reposition();
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const triggerProps = {
    ref: (node: HTMLElement | null) => { trigger.current = node; },
    className: 'phase6-counter-trigger',
    'aria-label': ariaLabel,
    'aria-describedby': open ? popoverId : undefined,
    onFocus: show,
    onBlur: handleBlur,
    onPointerEnter: handlePointerEnter,
    onPointerLeave: handlePointerLeave,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); clearTimers(); }
    },
  };
  const triggerContent = <><span className="phase6-counter-label">{label}</span><strong>{value}</strong></>;
  const root = trigger.current?.getRootNode();
  const portalRoot = typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot ? root : document.body;

  return <div className="phase6-bridge-counter">
    {onActivate
      ? <button {...triggerProps} type="button" aria-disabled={disabled || undefined} aria-expanded={open}
        onClick={() => { if (!disabled) onActivate(); }}>{triggerContent}</button>
      : <div {...triggerProps} role="group" tabIndex={0} aria-expanded={open}>{triggerContent}</div>}
    {open && createPortal(<div ref={popover} id={popoverId} role="tooltip" className="phase6-counter-popover"
      style={placement ? { top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.maxHeight } : undefined}
      onPointerEnter={clearTimers} onPointerLeave={scheduleClose}>
      <strong className="phase6-counter-popover-heading">{label}</strong>
      <div className="phase6-counter-popover-body">{children}</div>
    </div>, portalRoot)}
  </div>;
}
