import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { withStability } from '../stability.js';

/** One breadcrumb hop in the detail toolbar. */
export interface DetailBreadcrumb {
  label: ReactNode;
  /** Click handler for a navigable crumb. Ignored on the last (current) crumb, which is never a link. */
  onClick?: () => void;
}

/**
 * `DetailPanelShell` (Core, `stable`; contributed by M13) — the scaffold of an
 * entity detail page: a toolbar (breadcrumb + action slot) over scrollable
 * child content. The shared shell a plugin wraps its detail fields in, instead
 * of rebuilding the toolbar/breadcrumb per plugin.
 *
 * Pure-presentational: breadcrumb hops, actions and content are all props. No
 * router or host access — the caller wires navigation via `onClick`. The
 * detail header is the LAST breadcrumb hop (no `title` prop), and there are no
 * dedicated Edit/Delete slots — the contract is the `detail-panel-shell` record.
 *
 * 2.1.33 — the last hop is never a link, even with an `onClick`: it renders as
 * the page heading (`role="heading"`, `aria-level={1}`, `aria-current="page"`).
 * The bar stands outside the scroll region; only the content under it scrolls.
 */
export interface DetailPanelShellProps {
  /** Breadcrumb hops, left → right. The last is the current entity — the page heading, never a link. */
  breadcrumb: DetailBreadcrumb[];
  /** Trailing toolbar slot (e.g. a view switcher, a Delete button). No dedicated Edit/Delete slots. */
  actions?: ReactNode;
  /** Detail body (field grid, description, related entities, …). */
  children: ReactNode;
}

const crumbLinkClass = 'inline-flex items-center gap-1.5 rounded px-1 -mx-1 transition';

function DetailPanelShellImpl({ breadcrumb, actions, children }: DetailPanelShellProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div
        className="flex items-center gap-2 px-5 py-2.5"
        style={{ borderBottom: '1px solid var(--c-hair)', background: 'var(--c-bg)' }}
      >
        <div
          className="flex items-center gap-1.5 text-[12px] min-w-0"
          style={{ color: 'var(--c-muted)' }}
        >
          {breadcrumb.map((crumb, i) => {
            const last = i === breadcrumb.length - 1;
            return (
              <span key={i} className="flex items-center gap-1.5 min-w-0">
                {i > 0 && <ChevronRight size={11} />}
                {crumb.onClick && !last ? (
                  <button
                    onClick={crumb.onClick}
                    className={crumbLinkClass}
                    style={{ color: 'var(--c-muted)' }}
                  >
                    {crumb.label}
                  </button>
                ) : last ? (
                  // The last hop is the detail header of the current entity —
                  // there is no separate `title` prop (record `detail-panel-shell`).
                  <span
                    role="heading"
                    aria-level={1}
                    aria-current="page"
                    data-detail-header=""
                    className="flex items-center gap-1.5"
                    style={{ color: 'var(--c-ink)', fontWeight: 600 }}
                  >
                    {crumb.label}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">{crumb.label}</span>
                )}
              </span>
            );
          })}
        </div>
        <span className="flex-1" />
        {actions}
      </div>
      {/* The only scroll region: the bar above stays put, the content scrolls under it. */}
      <div className="flex-1 overflow-auto nice-scroll">{children}</div>
    </div>
  );
}

export const DetailPanelShell = withStability(DetailPanelShellImpl, 'stable');
