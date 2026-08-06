/**
 * The type-entity icon — a single shared reference used in TWO places: the
 * `sidebarTab.icon` (see `src/frontend.tsx`) and the list-screen `EntityListHeader`
 * `icon` prop (see `routes.tsx`). The host has NO auto-contract for "type icon";
 * keeping ONE reference here is what keeps the sidebar tab and the list header in
 * sync (`ac-entitylistheader-renderuje-ikone-typu-en`).
 *
 * Inline SVG — no `lucide-react` dependency. The `icon` contract is loosely typed
 * (`ComponentType<{ size?: number | string }>`), so any icon component works.
 */

import type { CSSProperties, FC } from 'react';

/**
 * `DOSTOSUJ:` a derived plugin swaps this glyph for its own type icon.
 *
 * `stroke="currentColor"` + a forwarded `style` let each call site tint it: the
 * host's `EntityListHeader` passes `style={{ color: 'var(--c-accent)' }}`, and the
 * list row passes the same accent — one icon, colored per context.
 */
export const DatabaseTableIcon: FC<{
  className?: string;
  size?: number | string;
  style?: CSSProperties;
}> = ({ className, size = 16, style }) => (
  <svg
    className={className}
    style={style}
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
    <path d="M5 8h6M5 5.5h6M5 10.5h3" />
  </svg>
);
