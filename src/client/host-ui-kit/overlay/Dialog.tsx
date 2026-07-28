import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { withStability } from '../stability.js';

/**
 * `Dialog` (Overlay/Create, `experimental`) — a controlled modal shell: scrim +
 * focus-trap + paper/terra panel. The presentational extraction of the host's
 * hand-written create dialogs (`CreateBriefDialog`, `NewEndpointDialog`, …) so a
 * plugin author composes "New button → dialog → form" instead of rebuilding the
 * scrim/panel/focus chrome per entity.
 *
 * Controlled: the consumer owns `open` and closes via `onClose` (scrim click,
 * the header ✕, or Escape — none of which exist when `dismissible` is false).
 * Pure-presentational — owns no data, fetches nothing.
 *
 * Distinct from the host-internal `ConfirmModal`/`ModalHost` (L5): that one is an
 * imperative event-bus singleton for destructive-confirm; this is controlled
 * props-in. Same visual anatomy, different contract.
 */
export interface DialogProps {
  /** Controlled visibility. When false the component renders nothing. */
  open: boolean;
  /** Requested close — scrim mousedown, header ✕, or Escape. */
  onClose: () => void;
  /** Optional header title; when set, a header row with a ✕ button is rendered. */
  title?: ReactNode;
  /** Optional footer slot (e.g. Save/Cancel), pinned bottom-right. */
  footer?: ReactNode;
  children: ReactNode;
  /** Panel width tier. Defaults to `md`. */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Exact panel width in px, overriding `size`. For a variant whose width is
   * specified independently of the tiers (the host's destructive-confirm is
   * pinned at 400px) — so honouring it does not require retuning a tier every
   * other call site shares.
   */
  width?: number;
  /**
   * Whether the dialog can be dismissed without answering it. Defaults to
   * `true`. With `false` the scrim click, `Escape` and the header ✕ are all
   * gone and the consumer calls `onClose()` itself after an explicit action —
   * for decision gates that must not be left unresolved (the project-local
   * plugin trust prompt, M33: a reflexive click beside the panel must not be
   * able to start running foreign code). Focus-trap, scrim and panel anatomy
   * are identical either way; the difference is purely behavioural. Forms stay
   * dismissible — there "Cancel" is a real answer.
   */
  dismissible?: boolean;
}

const SIZE_WIDTH: Record<NonNullable<DialogProps['size']>, number> = {
  sm: 420,
  md: 560,
  lg: 760,
};

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function DialogImpl({
  open,
  onClose,
  title,
  footer,
  children,
  size = 'md',
  width,
  dismissible = true,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Captured during the FIRST render that sees `open` — before the panel is
  // committed, so before a child's `autoFocus` runs. An effect would be too
  // late: `autoFocus` fires during commit, so `document.activeElement` would
  // already be inside the panel and the restore-on-close would be a no-op.
  if (open && restoreRef.current === null) {
    restoreRef.current = document.activeElement as HTMLElement | null;
  }

  // `onClose` is typically an inline arrow, so it changes identity on every
  // render of the consumer. Reading it through a ref keeps the focus effect
  // keyed on `open` alone — otherwise every re-render (a checkbox, an
  // expanding details block) would tear the effect down, restore focus behind
  // the scrim, and re-grab it on the panel's first focusable.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Read through a ref for the same reason as `onClose`: the keydown listener
  // is keyed on `open` alone, so it must not capture this at mount time.
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    // Move focus into the panel (first focusable, else the panel itself) —
    // unless something inside the panel (e.g. a child's `autoFocus`) already
    // claimed focus, in which case leave it alone.
    const t = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      if (panel.contains(document.activeElement)) return;
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      // Escape closes only a dismissible dialog. The Tab trap below stays
      // wired either way — a gate still confines focus to its own panel.
      if (e.key === 'Escape') {
        if (!dismissibleRef.current) return;
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // Trap Tab within the panel's focusable elements.
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      const restore = restoreRef.current;
      restoreRef.current = null;
      // Skip a detached opener: focusing it is a no-op that leaves
      // `document.activeElement` on `<body>`, which is worse than doing nothing.
      if (restore?.isConnected) restore.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)', zIndex: 1200 }}
      onMouseDown={(e) => {
        if (!dismissible) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="rounded-lg outline-none flex flex-col"
        style={{
          width: width ?? SIZE_WIDTH[size],
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 48px)',
          background: 'var(--c-card)',
          border: '1px solid var(--c-hair-strong)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
        }}
      >
        {title != null && (
          <div
            className="flex items-center gap-2 px-5 py-3"
            style={{ borderBottom: '1px solid var(--c-hair)' }}
          >
            <div
              className="text-[14px] font-semibold min-w-0"
              style={{ fontFamily: 'var(--font-heading)', color: 'var(--c-ink)' }}
            >
              {title}
            </div>
            <span className="flex-1" />
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-md p-1 btn-ghost"
                style={{ color: 'var(--c-muted)' }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
        <div className="px-5 py-4 overflow-auto nice-scroll">{children}</div>
        {footer != null && (
          <div
            className="flex items-center justify-end gap-2 px-5 py-3"
            style={{ borderTop: '1px solid var(--c-hair)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export const Dialog = withStability(DialogImpl, 'experimental');
