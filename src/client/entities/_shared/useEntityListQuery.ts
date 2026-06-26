import { useMemo, useState } from 'react';
import { useTags } from '../../hooks/useTags.js';
import type { EntityType } from '../../../shared/entities.js';
// `TagBarProps` is owned by the Host UI Kit's `TagFilterBar` (M34/L12); the app
// still builds the value and passes it into the kit component.
import type { TagBarProps } from '../../host-ui-kit/index.js';

interface Options {
  search: string;
  tagFilter: string[];
  onTagToggle: (slug: string) => void;
  extraQuery?: Record<string, unknown>;
}

export function useEntityListQuery(type: EntityType, opts: Options) {
  const { search, tagFilter, onTagToggle, extraQuery } = opts;
  const [tagMode, setTagMode] = useState<'and' | 'or'>('or');
  const { data: tags = [] } = useTags();

  const extraKey = JSON.stringify(extraQuery ?? {});
  const query = useMemo(
    () => ({
      search: search || undefined,
      tags: tagFilter.length ? tagFilter : undefined,
      tagFilter: tagFilter.length ? tagMode : undefined,
      ...extraQuery,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search, tagFilter, tagMode, extraKey],
  );

  const tagLookup = useMemo(() => new Map(tags.map((t) => [t.slug, t])), [tags]);

  const tagBar: TagBarProps = {
    tags: tags.filter((t) => (t.counts[type] ?? 0) > 0),
    tagFilter,
    onTagToggle,
    tagMode,
    onToggleMode: () => setTagMode((m) => (m === 'and' ? 'or' : 'and')),
    onClear: () => tagFilter.forEach(onTagToggle),
  };

  return { query, tags, tagLookup, tagBar };
}
