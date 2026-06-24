import { Search, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { withStability } from '../stability.js';

/**
 * `EntityListHeader` (Core, `stable`; contributed by M19) — the header of an
 * entity list: title + result counter, with slots for search/filter and
 * actions. The canonical host-supplied header a plugin renders instead of
 * hand-rebuilding one per plugin.
 *
 * Pure-presentational: every value and handler is a prop. No host access.
 */
export interface EntityListHeaderProps {
  /** Leading icon (e.g. a lucide icon component). */
  icon?: LucideIcon;
  title: string;
  /** Result counter; rendered as "N results" when provided. */
  count?: number;
  /** Search box state. Omit to hide the search box. */
  search?: string;
  onSearchChange?: (q: string) => void;
  searchPlaceholder?: string;
  /** Filter slot, rendered between search and actions. */
  filters?: ReactNode;
  /** Action slot (e.g. a create button), rendered at the trailing edge. */
  actions?: ReactNode;
}

function EntityListHeaderImpl({
  icon: Icon,
  title,
  count,
  search,
  onSearchChange,
  searchPlaceholder,
  filters,
  actions,
}: EntityListHeaderProps) {
  return (
    <div
      className="flex items-center gap-3 px-8 py-4"
      style={{ borderBottom: '1px solid var(--c-hair)' }}
    >
      {Icon && <Icon size={18} style={{ color: 'var(--c-accent)' }} />}
      <h2 className="text-[18px] font-semibold tracking-tight" style={{ color: 'var(--c-ink)' }}>
        {title}
      </h2>
      {count != null && (
        <span className="font-mono text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
          {count} {count === 1 ? 'result' : 'results'}
        </span>
      )}
      <span className="flex-1" />
      {filters}
      {search != null && (
        <div
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5"
          style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)', width: 280 }}
        >
          <Search size={13} style={{ color: 'var(--c-subtle)' }} />
          <input
            value={search}
            onChange={(e) => onSearchChange?.(e.target.value)}
            className="bg-transparent flex-1 text-[13px] outline-none"
            placeholder={searchPlaceholder}
            style={{ color: 'var(--c-ink)' }}
          />
        </div>
      )}
      {actions}
    </div>
  );
}

export const EntityListHeader = withStability(EntityListHeaderImpl, 'stable');
