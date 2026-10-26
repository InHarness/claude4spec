import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Link } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { Popover } from '../../host-ui-kit/overlay-feedback/Popover.js';

/**
 * M50 `8h2a734u` — the sidebar side menu: ONE shell mechanism for OTHERS and
 * for every ELEMENTS entry the slot's module declares as opening a menu.
 *
 *  - anchored at its entry, opening to the right and bouncing off the window
 *    edge — the panel is the catalog `Popover` (`placement="right"`), which owns
 *    the z-tier, the viewport clamp and click-outside;
 *  - at most ONE side menu is open (`state` below), in one of two modes:
 *    - a hover opens a *preview*: once the pointer is outside the entry and the
 *      panel it closes after `SIDE_MENU_PREVIEW_DELAY_MS`; coming back before
 *      that cancels it, and hovering another menu entry swaps the preview to
 *      that entry after the same delay (a pointer crossing a neighbour on its
 *      way to the panel keeps the menu);
 *    - a click *pins* it: pointer movement no longer touches it, only a click
 *      on its entry (closes), on another entry (pins that one) or a closer;
 *      a click on a previewed entry, or focus entering its panel, pins it;
 *    - a device without hover never previews — a click opens the menu pinned;
 *  - its items are links: a click navigates to the item's route and closes the
 *    menu, Cmd/Ctrl+click is left to the browser (a new tab) and keeps it open;
 *  - keys (`l5pkeysm`): Esc closes and gives focus back to the entry, Enter goes
 *    to the highlighted item, Tab / Shift+Tab close, ↑ / ↓ move the highlight;
 *  - a11y: the entry announces `aria-expanded` (true in both modes) /
 *    `aria-haspopup="menu"`, the list is a `role="menu"` of `role="menuitem"` links.
 *
 * Not a facade window: it never goes through `openPopover`, which serves forms
 * and takes coordinates only (`wkkqzeum`).
 */

/** How long a preview survives the pointer being outside its entry and panel. */
export const SIDE_MENU_PREVIEW_DELAY_MS = 150;

type SideMenuMode = 'preview' | 'pinned';

/** The one open side menu, shared by every instance — `null` when none is open. */
let state: { mode: SideMenuMode; id: string } | null = null;
/** During a preview: the other menu entry under the pointer, previewed when the timer fires. */
let pendingId: string | null = null;
let previewTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function disarmPreviewTimer(): void {
  if (previewTimer !== null) clearTimeout(previewTimer);
  previewTimer = null;
}

function setState(next: { mode: SideMenuMode; id: string } | null): void {
  disarmPreviewTimer();
  pendingId = null;
  if (state?.mode === next?.mode && state?.id === next?.id) return;
  state = next;
  for (const listener of listeners) listener();
}

/** Starts the preview's countdown (pinned menus have none); a running one keeps going. */
function armPreviewTimer(): void {
  if (state?.mode !== 'preview' || previewTimer !== null) return;
  previewTimer = setTimeout(() => {
    previewTimer = null;
    setState(pendingId ? { mode: 'preview', id: pendingId } : null);
  }, SIDE_MENU_PREVIEW_DELAY_MS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A hover only previews on a device that has one — never on a touch screen. */
function canHover(e: ReactPointerEvent): boolean {
  if (e.pointerType === 'touch') return false;
  return typeof window.matchMedia !== 'function' || window.matchMedia('(hover: hover)').matches;
}

export interface SideMenuItem {
  /** The item's route (without the project prefix). */
  to: string;
  icon: LucideIcon;
  label: string;
  /** The current route is this item's — highlighted in the list. */
  active?: boolean;
  /** Trailing badges (counters). */
  extra?: ReactNode;
}

export function SidebarSideMenu({
  label,
  items,
  width = 200,
  title,
  triggerClassName,
  triggerStyle,
  children,
}: {
  /** Accessible name of the menu. */
  label: string;
  items: readonly SideMenuItem[];
  width?: number;
  /** Tooltip of the entry. */
  title?: string;
  triggerClassName?: string;
  /**
   * The entry's look, given whether its menu is pinned. A hover preview leaves
   * the entry looking as it did — only the shared `.sidebar-entry:hover` tint.
   */
  triggerStyle?: (pinned: boolean) => CSSProperties;
  /** The entry's content. */
  children: ReactNode;
}) {
  const id = useId();
  const menuId = `${id}-menu`;
  const mode = useSyncExternalStore(
    subscribe,
    () => (state?.id === id ? state.mode : null),
    () => null,
  );
  const open = mode !== null;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState(-1);

  const close = useCallback(() => {
    if (state?.id === id) setState(null);
  }, [id]);

  // Every opening starts without a highlighted item.
  useEffect(() => {
    if (!open) setHighlight(-1);
  }, [open]);

  // An unmounted entry never leaves its menu registered as the open one.
  useEffect(
    () => () => {
      if (state?.id === id) setState(null);
    },
    [id],
  );

  // A preview follows the pointer: on its entry or panel it stays, anywhere
  // else (a plain sidebar entry included) it closes after the delay — unless
  // the pointer rests on another menu entry, which is then previewed instead.
  // The panel is the whole Popover, its padding included; the gap between
  // entry and panel is bridged by the delay itself.
  useEffect(() => {
    if (mode !== 'preview') return;
    const onOver = (e: PointerEvent) => {
      const target = e.target as Element | null;
      const panel = menuRef.current?.closest('[role="dialog"]');
      if (target && (triggerRef.current?.contains(target) || panel?.contains(target))) {
        disarmPreviewTimer();
        pendingId = null;
        return;
      }
      const otherEntry = target?.closest?.('[data-side-menu-entry]')?.getAttribute('data-side-menu-entry');
      pendingId = otherEntry ?? null;
      armPreviewTimer();
    };
    const onOut = (e: PointerEvent) => {
      // The pointer left the window: nothing will be "over" to report it.
      if (e.relatedTarget !== null) return;
      pendingId = null;
      armPreviewTimer();
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
    };
  }, [mode]);

  useEffect(() => {
    if (!open) return;
    const itemEls = () =>
      Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const onKey = (e: KeyboardEvent) => {
      // The keys belong to the menu only while focus is on its entry or in its
      // list. A hover-opened menu leaves focus where it was (the editor, an
      // input): that field keeps its own ↑/↓/Enter/Tab, and Esc there is only
      // the Popover's own close — focus is not pulled to the entry.
      const active = document.activeElement;
      const inMenu = !!active && !!menuRef.current?.contains(active);
      if (!inMenu && !(active && triggerRef.current?.contains(active))) return;
      switch (e.key) {
        case 'Escape':
          close();
          triggerRef.current?.focus();
          return;
        case 'Tab':
          // Focus inside the list goes back to the entry first, so the browser's
          // Tab / Shift+Tab continues from next to the entry rather than from
          // <body> once the list unmounts; then the menu closes.
          if (inMenu) triggerRef.current?.focus();
          close();
          return;
        case 'ArrowDown':
        case 'ArrowUp': {
          const els = itemEls();
          if (els.length === 0) return;
          e.preventDefault();
          const focused = els.indexOf(document.activeElement as HTMLElement);
          const from = focused >= 0 ? focused : highlight;
          const next =
            e.key === 'ArrowDown'
              ? (from + 1) % els.length
              : from <= 0
                ? els.length - 1
                : from - 1;
          setHighlight(next);
          els[next]!.focus();
          return;
        }
        case 'Enter': {
          const els = itemEls();
          // A focused item activates natively (its own click).
          if (els.includes(document.activeElement as HTMLElement)) return;
          const target = els[highlight];
          if (!target) return;
          e.preventDefault();
          target.click();
          return;
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close, highlight]);

  const onItemClick = (e: ReactMouseEvent) => {
    // Cmd/Ctrl (or any modifier) click: the browser opens the route in a new
    // tab; this tab neither navigates nor closes the menu.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    close();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-side-menu-entry={id}
        onClick={() => {
          // Pinned here → closed; closed, previewed here or open elsewhere → pinned here.
          if (mode === 'pinned') close();
          else setState({ mode: 'pinned', id });
        }}
        onPointerEnter={(e) => {
          if (state === null && canHover(e)) setState({ mode: 'preview', id });
        }}
        className={triggerClassName}
        style={triggerStyle?.(mode === 'pinned')}
        title={title}
      >
        {children}
      </button>
      <Popover open={open} onClose={close} anchorRef={triggerRef} placement="right" width={width}>
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onFocus={() => {
            // Focus entering a previewed panel means the user works with it: pin it.
            if (state?.id === id && state.mode === 'preview') setState({ mode: 'pinned', id });
          }}
          onMouseLeave={() => setHighlight(-1)}
        >
          {items.map((item, i) => {
            const I = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                role="menuitem"
                tabIndex={-1}
                onClick={onItemClick}
                onMouseEnter={() => setHighlight(i)}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-[13px] outline-none"
                style={{
                  color: 'var(--c-ink)',
                  textDecoration: 'none',
                  fontWeight: item.active ? 600 : 400,
                  background:
                    i === highlight
                      ? 'var(--c-panel)'
                      : item.active
                        ? 'var(--c-accent-soft)'
                        : 'transparent',
                }}
              >
                <I size={13} />
                <span className="flex-1">{item.label}</span>
                {item.extra}
              </Link>
            );
          })}
        </div>
      </Popover>
    </>
  );
}
