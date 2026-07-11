import type { LucideIcon } from 'lucide-react';
import type { Tag } from '../../../shared/entities.js';
import { Badge } from '../actions/Badge.js';
import { withStability } from '../stability.js';

/**
 * `EntityListRow` (List, `experimental`) — a styled, clickable entity-list row
 * with optional leading/trailing slots and a tag chip strip. Pure-presentational:
 * it renders tags from the supplied `tagLookup` map and never calls `useTags`
 * itself, so the host app owns the data side and passes the lookup in.
 *
 * Tag chips render via the kit's `Badge` (the single chip implementation).
 */
export interface EntityListRowProps {
  leading: React.ReactNode;
  /**
   * Optional leading icon — the same `LucideIcon` type as the `stable`
   * `EntityListHeader.icon` (M34/L12 type-consistency across tiers). Rendered
   * before `leading`; independent of it since some rows have no icon at all.
   */
  icon?: LucideIcon;
  onClick: () => void;
  tags?: string[];
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
  return (
    <button
      onClick={onClick}
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
    </button>
  );
}

export const EntityListRow = withStability(EntityListRowImpl, 'experimental');
