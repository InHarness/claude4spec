import { TagChip } from '../../components/atoms.js';
import type { TagBarProps } from './useEntityListQuery.js';

export function TagFilterBar({
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
        <TagChip
          key={tag.slug}
          tag={tag}
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
