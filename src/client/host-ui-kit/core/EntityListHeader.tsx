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
 *
 * Prop contract (`stable`, part of `hostApiVersion`; M19 `m19l12sc`, 2.1.16),
 * with no default values: `title` is required; `icon`, `count` ("N results"),
 * `search` + `onSearchChange` + `searchPlaceholder`, `filters` and `actions`
 * are optional. Omitting `search` hides the search box. Slot order, left to
 * right: icon, title, count, search, `filters` (between search and actions),
 * `actions` (trailing edge, e.g. a create button).
 *
 * 2.1.33 (record `entity-list-header`): `filters` shares the one header row with
 * title, search and actions, so it holds compact controls that fit that row —
 * e.g. `SegmentedControlTabs` (the AC list's status and kind switches) or a
 * select. The header has no place for `TagFilterBar`: a strip with a variable
 * number of chips would break the row, so the tag bar stands BELOW the header,
 * as its sibling in `EntityListLayout`'s `header` (M19 `thm8a14c`).
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
  /**
   * Filter slot, rendered between search and actions in the same row — for
   * compact one-row controls (segmented tabs, a select). Not for `TagFilterBar`,
   * which stands under the header as its sibling in `EntityListLayout.header`.
   */
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
      {filters}
      {actions}
    </div>
  );
}

export const EntityListHeader = withStability(EntityListHeaderImpl, 'stable');
