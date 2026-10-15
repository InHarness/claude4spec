/**
 * HOST-LOCAL — the catalog publishes the list PRESENTATION, not its query.
 *
 * `TagFilterBar` / `EntityListLayout` / `EntityListHeader` are all imported from
 * the kit below and in the list panels; what has no catalog counterpart is the
 * assembly above them — the search + tag-filter query key, the and/or tag mode,
 * and the `TagBarProps` value handed down to the kit component. No slot,
 * primitive or hook in `@c4s/plugin-runtime/ui` covers that, so this is a gap in
 * the surface rather than a copy of something already in it.
 */

import { useMemo, useState } from 'react';
import { useTags } from '@c4s/plugin-runtime';
import type { EntityType } from '../types.js';
// `TagBarProps` is owned by the Host UI Kit's `TagFilterBar` (M34/L12); the app
// still builds the value and passes it into the kit component.
import type { Tag, TagBarProps } from '@c4s/plugin-runtime/ui';

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

  // `useTags()` items are assignable to the kit's `Tag` as is (M34 `hpw2opbb`):
  // no adapter and no cast.
  const tagLookup = useMemo(() => new Map<string, Tag>(tags.map((t) => [t.slug, t])), [tags]);

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
