import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
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
 *  - opened by a click or by hovering the entry; at most ONE side menu is open
 *    (`openMenuId` below), so opening another closes the previous one;
 *  - its items are links: a click navigates to the item's route and closes the
 *    menu, Cmd/Ctrl+click is left to the browser (a new tab) and keeps it open;
 *  - keys (`l5pkeysm`): Esc closes and gives focus back to the entry, Enter goes
 *    to the highlighted item, Tab / Shift+Tab close, ↑ / ↓ move the highlight;
 *  - a11y: the entry announces `aria-expanded` / `aria-haspopup="menu"`, the
 *    list is a `role="menu"` of `role="menuitem"` links.
 *
 * Not a facade window: it never goes through `openPopover`, which serves forms
 * and takes coordinates only (`wkkqzeum`).
 */

/** The one open side menu, shared by every instance — `null` when none is open. */
let openMenuId: string | null = null;
const listeners = new Set<() => void>();

function setOpenMenu(id: string | null): void {
  if (openMenuId === id) return;
  openMenuId = id;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
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
  /** The entry's look, given whether its menu is open. */
  triggerStyle?: (open: boolean) => CSSProperties;
  /** The entry's content. */
  children: ReactNode;
}) {
  const id = useId();
  const menuId = `${id}-menu`;
  const open = useSyncExternalStore(
    subscribe,
    () => openMenuId === id,
    () => false,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** Opened by hovering: the next click keeps it open instead of toggling it shut. */
  const openedByHover = useRef(false);
  const [highlight, setHighlight] = useState(-1);

  const close = useCallback(() => {
    if (openMenuId === id) setOpenMenu(null);
  }, [id]);

  const show = (byHover: boolean) => {
    openedByHover.current = byHover;
    setHighlight(-1);
    setOpenMenu(id);
  };

  // An unmounted entry never leaves its menu registered as the open one.
  useEffect(
    () => () => {
      if (openMenuId === id) setOpenMenu(null);
    },
    [id],
  );

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
        onClick={() => {
          if (open && !openedByHover.current) close();
          else show(false);
        }}
        onMouseEnter={() => {
          if (!open) show(true);
        }}
        className={triggerClassName}
        style={triggerStyle?.(open)}
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
