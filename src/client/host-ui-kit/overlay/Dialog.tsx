import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { withStability } from '../stability.js';

/**
 * `Dialog` (group `overlay`, `experimental`) — a controlled modal shell: scrim +
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
  /** Open state, controlled by the consumer; with `false` the component renders nothing. */
  open: boolean;
  /**
   * Requested close — scrim mousedown, header ✕, or Escape. Required for both
   * `dismissible` variants; with `dismissible={false}` the consumer passes a no-op.
   */
  onClose: () => void;
  /** Optional header title; when set, a header row with a ✕ button is rendered. */
  title?: ReactNode;
  /** Optional footer slot (e.g. Save/Cancel), pinned under the scrollable body. */
  footer?: ReactNode;
  /** The dialog body; scrollable. */
  children: ReactNode;
  /**
   * Width tier: `sm` 420 px, `md` 560 px, `lg` 760 px. Defaults to `md`. It sets
   * the width only — the height cap is one for every tier
   * (`DIALOG_MAX_HEIGHT`). There is no `maxHeight` prop — a body taller than
   * the cap scrolls inside the panel, under a pinned footer.
   */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Exact panel width in px, taking precedence over `size`. For a variant
   * whose width is specified independently of the tiers (the host's
   * destructive-confirm is pinned at 400px) — so honouring it does not require
   * retuning a tier every other call site shares.
   * `width` does not touch the overflow contract: the height cap is the same
   * with or without it.
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
  /**
   * Accessible name when there is no `title` to derive one from. With a
   * `title`, the panel is labelled by it automatically and this is unnecessary.
   */
  ariaLabel?: string;
  /**
   * Overlay layer, written into the scrim's style; overrides the default 1200
   * (above `Popover` 1100, below `z-toast` 1300). 1200 is the `z-modal` token
   * of the design system, but the token bridge exposes no `--z-modal`
   * variable, so the component uses the number, not a variable.
   */
  zIndex?: number;
}

/**
 * The width tiers: `sm` 420 px, `md` 560 px, `lg` 760 px. A tier sets the panel
 * WIDTH only; an exact `width` prop takes precedence over it.
 */
export const DIALOG_SIZE_TIERS: Record<NonNullable<DialogProps['size']>, { width: number }> = {
  sm: { width: 420 },
  md: { width: 560 },
  lg: { width: 760 },
};

/**
 * The panel's height cap — one for every tier, and untouched by `width`. Past
 * it the body scrolls inside the panel, under the pinned footer.
 */
export const DIALOG_MAX_HEIGHT = 'calc(100vh - 48px)';

/** The panel's width cap — one for every tier. */
export const DIALOG_MAX_WIDTH = 'calc(100vw - 32px)';

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
  ariaLabel,
  zIndex = 1200,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

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
      // Focus may have left the panel entirely — a click on the scrim of a
      // non-dismissible dialog leaves `document.activeElement` on <body>, and
      // wrap-at-the-edges alone would then let Tab walk into the shell behind
      // the scrim. Pull it back before considering the edges.
      if (!panel.contains(document.activeElement)) {
        e.preventDefault();
        const firstOutside = panel.querySelector<HTMLElement>(FOCUSABLE);
        (firstOutside ?? panel).focus();
        return;
      }
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
      // Without one of these a screen reader announces only "dialog" — the user
      // lands in a modal with no idea what it is asking.
      aria-labelledby={title != null ? titleId : undefined}
      aria-label={title == null ? ariaLabel : undefined}
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)', zIndex }}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (!dismissible) {
          // Swallow it: without this the mousedown blurs whatever was focused
          // inside the panel and drops focus onto <body>, outside the trap.
          e.preventDefault();
          return;
        }
        onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        data-dialog-part="panel"
        className="rounded-lg outline-none flex flex-col"
        style={{
          // `width` takes precedence over the tier; both caps are shared by every tier.
          width: width ?? DIALOG_SIZE_TIERS[size].width,
          maxWidth: DIALOG_MAX_WIDTH,
          maxHeight: DIALOG_MAX_HEIGHT,
          background: 'var(--c-card)',
          border: '1px solid var(--c-hair-strong)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
        }}
      >
        {title != null && (
          <div
            data-dialog-part="header"
            className="flex items-center gap-2 px-5 py-3 shrink-0"
            style={{ borderBottom: '1px solid var(--c-hair)' }}
          >
            <div
              id={titleId}
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
        {/* Overflow contract: the body is the ONLY scroll container (min-h-0 lets
            it shrink below its content inside the capped flex column); the
            footer is its sibling, outside the overflow, so it stays visible
            whatever the scroll position. */}
        <div
          data-dialog-part="body"
          className="px-5 py-4 overflow-auto nice-scroll min-h-0 flex-1"
          style={{ overflowY: 'auto', minHeight: 0 }}
        >
          {children}
        </div>
        {footer != null && (
          <div
            data-dialog-part="footer"
            className="flex items-center justify-end gap-2 px-5 py-3 shrink-0"
            style={{ borderTop: '1px solid var(--c-hair)', flexShrink: 0 }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export const Dialog = withStability(DialogImpl, 'experimental');
