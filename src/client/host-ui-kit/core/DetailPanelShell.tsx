import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { withStability } from '../stability.js';

/** One breadcrumb hop in the detail toolbar. */
export interface DetailBreadcrumb {
  label: ReactNode;
  /** Click handler for a navigable crumb. The last (current) crumb omits it. */
  onClick?: () => void;
}

/**
 * `DetailPanelShell` (Core, `stable`; contributed by M13) — the scaffold of an
 * entity detail page: a toolbar (breadcrumb + action slot) over scrollable
 * child content. The shared shell a plugin wraps its detail fields in, instead
 * of rebuilding the toolbar/breadcrumb per plugin.
 *
 * Pure-presentational: breadcrumb hops, actions and content are all props. No
 * router or host access — the caller wires navigation via `onClick`.
 */
export interface DetailPanelShellProps {
  /** Breadcrumb hops, left → right. The last is the current entity. */
  breadcrumb: DetailBreadcrumb[];
  /** Trailing toolbar slot (e.g. a view switcher, Edit/Delete buttons). */
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
                ) : (
                  <span
                    className="flex items-center gap-1.5"
                    style={last ? { color: 'var(--c-ink)', fontWeight: 600 } : undefined}
                  >
                    {crumb.label}
                  </span>
                )}
              </span>
            );
          })}
        </div>
        <span className="flex-1" />
        {actions}
      </div>
      <div className="flex-1 overflow-auto nice-scroll">{children}</div>
    </div>
  );
}

export const DetailPanelShell = withStability(DetailPanelShellImpl, 'stable');
