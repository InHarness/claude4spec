import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { withStability } from '../stability.js';

/**
 * `Popover` (Overlay/feedback, `experimental`) — a controlled floating panel.
 * Pure-presentational: the consumer owns `open` state and anchors it to an
 * element via `anchorRef`; this component never mutates anything, it just
 * positions and renders `children` over `--z-popover`.
 *
 * Deliberately separate from the host-internal `openPopover()` / `PopoverHost`
 * event-bus (`src/client/ui/events.ts` + `ui/Popover.tsx`) — that's an
 * imperative, promise-resolving contract private to the host. This component
 * shares its visual anatomy (floating card, viewport clamping, click-outside +
 * Escape to dismiss) but not that contract.
 */
export interface PopoverProps {
  open: boolean;
  onClose(): void;
  anchorRef: RefObject<HTMLElement>;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
  /** Caps the scrollable body's height; content beyond it scrolls internally instead of growing the panel. */
  maxHeight?: number;
  /** Optional slot rendered as a sibling below the (possibly scrollable) body, pinned outside its overflow. */
  footer?: ReactNode;
}

const GAP = 6;
const VIEWPORT_PAD = 8;

function PopoverImpl({ open, onClose, anchorRef, placement = 'bottom', children, maxHeight, footer }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const width = panel?.offsetWidth ?? 240;
    const height = panel?.offsetHeight ?? 120;

    let top = a.bottom + GAP;
    let left = a.left;
    if (placement === 'top') {
      top = a.top - height - GAP;
      left = a.left;
    } else if (placement === 'left') {
      top = a.top;
      left = a.left - width - GAP;
    } else if (placement === 'right') {
      top = a.top;
      left = a.right + GAP;
    }

    const maxLeft = window.innerWidth - width - VIEWPORT_PAD;
    const maxTop = window.innerHeight - height - VIEWPORT_PAD;
    setPos({
      top: Math.max(VIEWPORT_PAD, Math.min(top, maxTop)),
      left: Math.max(VIEWPORT_PAD, Math.min(left, maxLeft)),
    });
  }, [open, anchorRef, placement, children]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      className="rounded-md shadow-lg flex flex-col"
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        zIndex: 'var(--z-popover)',
        visibility: pos ? 'visible' : 'hidden',
        background: 'var(--c-card)',
        border: '1px solid var(--c-hair-strong)',
        ...(maxHeight != null ? { maxHeight, overflow: 'hidden' } : null),
      }}
    >
      <div
        className={maxHeight != null ? 'overflow-auto nice-scroll' : undefined}
        style={{ padding: 10, ...(maxHeight != null ? { flex: '1 1 auto', minHeight: 0 } : null) }}
      >
        {children}
      </div>
      {footer != null && (
        <div style={{ padding: '8px 10px', borderTop: '1px solid var(--c-hair)' }}>{footer}</div>
      )}
    </div>
  );
}

export const Popover = withStability(PopoverImpl, 'experimental');
