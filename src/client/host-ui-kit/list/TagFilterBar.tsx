import type { Tag } from '../../../shared/entities.js';
import { Badge } from '../actions/Badge.js';
import { withStability } from '../stability.js';

/**
 * `TagFilterBar` (List, `experimental`) — the tag-filter strip above an entity
 * list. Pure-presentational: tags, current filter and handlers are props. The
 * data side (`useTags` / `useEntityListQuery`) stays in the host app, which
 * builds `TagBarProps` and passes it in.
 *
 * Tag chips render via the kit's `Badge` (the single chip implementation).
 */
export interface TagBarProps {
  tags: Tag[];
  tagFilter: string[];
  onTagToggle: (slug: string) => void;
  tagMode: 'and' | 'or';
  onToggleMode: () => void;
  onClear: () => void;
}

function TagFilterBarImpl({
  tags,
  tagFilter,
  onTagToggle,
  tagMode,
  onToggleMode,
  onClear,
}: TagBarProps) {
  if (tags.length === 0) return null;

  return (
    <div
      className="px-8 py-3 flex items-center gap-2 flex-wrap"
      style={{ borderBottom: '1px solid var(--c-hair)' }}
    >
      <span
        className="text-[10.5px] uppercase font-mono tracking-wider"
        style={{ color: 'var(--c-subtle)' }}
      >
        Filter by tag:
      </span>
      {tags.map((tag) => (
        <Badge
          key={tag.slug}
          label={tag.name}
          color={tag.color ?? undefined}
          active={tagFilter.includes(tag.slug)}
          onClick={() => onTagToggle(tag.slug)}
          small
        />
      ))}
      <span className="flex-1" />
      {tagFilter.length > 1 && (
        <button
          onClick={onToggleMode}
          className="text-[10.5px] uppercase font-mono tracking-wider px-2 py-0.5 rounded"
          style={{ color: 'var(--c-muted)', background: 'var(--c-panel)' }}
          title="Toggle AND / OR filter"
        >
          match {tagMode}
        </button>
      )}
      {tagFilter.length > 0 && (
        <button
          onClick={onClear}
          className="text-[10.5px] font-mono px-2 py-0.5 rounded"
          style={{ color: 'var(--c-muted)' }}
        >
          clear
        </button>
      )}
    </div>
  );
}

export const TagFilterBar = withStability(TagFilterBarImpl, 'experimental');
