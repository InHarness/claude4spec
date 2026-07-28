import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { withStability } from '../stability.js';

/**
 * `Popover` (Overlay/feedback, `experimental`) — a controlled floating panel and
 * the ONLY popover anatomy in C4S (M34/L12 one-implementation rule). The host's
 * imperative `openPopover()` bus is a *facade* over this component, not a twin:
 * `PopoverShell` (`src/client/ui/Popover.tsx`) maps an event payload onto these
 * props. What differs there is the invocation surface, not the anatomy.
 *
 * Positioning accepts either of the two shapes callers actually have: an
 * element (`anchorRef`) or raw viewport coordinates (`at`) — the latter is what
 * `getBoundingClientRect()` and `editor.view.coordsAtPos(pos)` produce, so the
 * editor-driven popovers need no anchor element. Clamping to the viewport lives
 * here, never in a caller.
 */
export interface PopoverProps {
  open: boolean;
  onClose(): void;
  /** Anchor element to position against. Supply this or `at`. */
  anchorRef?: RefObject<HTMLElement>;
  /** Fixed viewport coordinates to position at. Wins over `anchorRef` if both are given. */
  at?: { x: number; y: number };
  placement?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
  /**
   * Panel width. 320 = create (full form), 280 = edit, 360 = multi-step with
   * picker lists. Omitted, the panel sizes to its content — which is what the
   * chip-anchored pickers want.
   */
  width?: number;
  /** Optional header: lucide icon + uppercase mono title. */
  title?: string;
  icon?: ReactNode;
  /** Caps the scrollable body's height; content beyond it scrolls internally instead of growing the panel. */
  maxHeight?: number;
  /** Optional slot rendered as a sibling below the (possibly scrollable) body, pinned outside its overflow. */
  footer?: ReactNode;
}

const GAP = 6;
const VIEWPORT_PAD = 8;

/**
 * Keeps a `width`×`height` panel fully on screen with `VIEWPORT_PAD` to spare.
 * Exported for unit tests — there is no React Testing Library in this repo, so
 * positioning is verified through this helper rather than by rendering.
 */
export function clampToViewport(
  x: number,
  y: number,
  width: number,
  height: number,
  viewport: { width: number; height: number } = {
    width: window.innerWidth,
    height: window.innerHeight,
  },
): { left: number; top: number } {
  const maxLeft = viewport.width - width - VIEWPORT_PAD;
  const maxTop = viewport.height - height - VIEWPORT_PAD;
  return {
    left: Math.max(VIEWPORT_PAD, Math.min(x, maxLeft)),
    top: Math.max(VIEWPORT_PAD, Math.min(y, maxTop)),
  };
}

function PopoverImpl({
  open,
  onClose,
  anchorRef,
  at,
  placement = 'bottom',
  children,
  width,
  title,
  icon,
  maxHeight,
  footer,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const measuredWidth = panel?.offsetWidth ?? width ?? 240;
    const height = panel?.offsetHeight ?? 120;

    // An explicit coordinate is always more specific than an anchor element.
    if (at) {
      setPos(clampToViewport(at.x, at.y, measuredWidth, height));
      return;
    }

    const anchor = anchorRef?.current;
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();

    let top = a.bottom + GAP;
    let left = a.left;
    if (placement === 'top') {
      top = a.top - height - GAP;
      left = a.left;
    } else if (placement === 'left') {
      top = a.top;
      left = a.left - measuredWidth - GAP;
    } else if (placement === 'right') {
      top = a.top;
      left = a.right + GAP;
    }

    setPos(clampToViewport(left, top, measuredWidth, height));
    // Deliberately NOT keyed on `children`: the clamp reads the panel's
    // measured height, so re-running it as content resizes would slide the
    // panel out from under the pointer — a filtered picker list shrinking on
    // each keystroke would walk the options the user is aiming at. The
    // position is settled once per open, per anchor.
  }, [open, anchorRef, at?.x, at?.y, placement, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
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
      aria-label={title}
      className="rounded-md shadow-lg flex flex-col"
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        zIndex: 'var(--z-popover)',
        visibility: pos ? 'visible' : 'hidden',
        ...(width != null ? { width } : null),
        background: 'var(--c-card)',
        border: '1px solid var(--c-hair-strong)',
        ...(maxHeight != null ? { maxHeight, overflow: 'hidden' } : null),
      }}
    >
      <div
        className={maxHeight != null ? 'overflow-auto nice-scroll' : undefined}
        style={{ padding: 10, ...(maxHeight != null ? { flex: '1 1 auto', minHeight: 0 } : null) }}
      >
        {title != null && (
          <div
            className="flex items-center gap-2 mb-2 text-[11px] uppercase font-mono tracking-wider"
            style={{ color: 'var(--c-subtle)' }}
          >
            {icon}
            <span>{title}</span>
          </div>
        )}
        {children}
      </div>
      {footer != null && (
        <div style={{ padding: '8px 10px', borderTop: '1px solid var(--c-hair)' }}>{footer}</div>
      )}
    </div>
  );
}

export const Popover = withStability(PopoverImpl, 'experimental');
