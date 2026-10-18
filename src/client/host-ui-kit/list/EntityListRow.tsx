import type { LucideIcon } from 'lucide-react';
import type { Tag } from '../../../shared/plugin-host/ui-kit-surface.js';
import { Badge } from '../actions/Badge.js';
import { withStability } from '../stability.js';

/**
 * `EntityListRow` (List, `experimental`) — a styled, clickable entity-list row
 * with optional leading/trailing slots and a tag chip strip. Pure-presentational:
 * it renders tags from the supplied `tagLookup` map and never calls `useTags`
 * itself, so the host app owns the data side and passes the lookup in.
 *
 * Tag chips render via the kit's `Badge` (the single chip implementation). A tag
 * slug missing from `tagLookup` still renders, as its slug in Badge's default
 * colour. Anatomy (2.1.33): the `icon` is 16 px in `var(--c-accent)`, and the
 * `leading` slot follows it.
 */
export interface EntityListRowProps {
  /** General-purpose leading slot; use `icon` instead for the common plain-icon case. */
  leading?: React.ReactNode;
  /**
   * Leading icon, rendered before `leading` — the same `LucideIcon` type as the
   * `stable` `EntityListHeader.icon` (M34/L12 type-consistency across tiers).
   * The default styling (fixed size + accent color) covers the common case;
   * a row needing custom icon styling still uses `leading` directly instead.
   */
  icon?: LucideIcon;
  /**
   * With `onClick` the whole row is a `<button>`; without it a `<div>`
   * container for the row's own controls in its slots. Omit it when the row is an editing
   * surface rather than a link (e.g. `/tags`): the row then renders as a plain
   * container, so its own controls aren't nested inside a button.
   */
  onClick?: () => void;
  tags?: string[];
  /** slug → `Tag` for the chips; a tag missing from the map shows its slug in the default colour. */
  tagLookup: Map<string, Tag>;
  trailing?: React.ReactNode;
  align?: 'center' | 'start';
  style?: React.CSSProperties;
  children: React.ReactNode;
}

function EntityListRowImpl({
  leading,
  icon: Icon,
  onClick,
  tags,
  tagLookup,
  trailing,
  align = 'center',
  style,
  children,
}: EntityListRowProps) {
  const Root = onClick ? 'button' : 'div';

  return (
    <Root
      {...(onClick ? { onClick } : null)}
      className={`w-full text-left flex gap-3 px-4 py-3 rounded-md transition mb-1 ${
        align === 'start' ? 'items-start' : 'items-center'
      }`}
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)', ...style }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair-strong)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
    >
      {Icon && <Icon size={16} style={{ color: 'var(--c-accent)' }} />}
      {leading}
      <div className="flex-1 min-w-0">
        {children}
        {tags && tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap mt-1.5">
            {tags.map((ts) => {
              const tag = tagLookup.get(ts);
              return (
                <Badge key={ts} label={tag?.name ?? ts} color={tag?.color ?? undefined} small />
              );
            })}
          </div>
        )}
      </div>
      {trailing}
    </Root>
  );
}

export const EntityListRow = withStability(EntityListRowImpl, 'experimental');
