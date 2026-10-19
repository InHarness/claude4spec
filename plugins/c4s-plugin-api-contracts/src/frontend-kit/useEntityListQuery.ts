import { useMemo, useState } from 'react';
import { useTags, type Tag } from '@c4s/plugin-runtime';
import type { EntityType } from '../types.js';
// `TagFilterBarProps` is owned by the Host UI Kit's `TagFilterBar` (M34/L12); the app
// still builds the value and passes it into the kit component.
import type { TagFilterBarProps } from '@c4s/plugin-runtime/ui';

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

  // `useTags()` items are assignable to the M18 `Tag` as is: no adapter and no
  // cast. This is the plugin's OWN list screen — the one place a map comes from
  // `useTags`; a `renderRow` slot gets the host's `tagLookup` instead.
  const tagLookup = useMemo(() => new Map<string, Tag>(tags.map((t) => [t.slug, t])), [tags]);

  const tagBar: TagFilterBarProps = {
    tags: tags.filter((t) => (t.counts[type] ?? 0) > 0),
    tagFilter,
    onTagToggle,
    tagMode,
    onToggleMode: () => setTagMode((m) => (m === 'and' ? 'or' : 'and')),
    onClear: () => tagFilter.forEach(onTagToggle),
  };

  return { query, tags, tagLookup, tagBar };
}
