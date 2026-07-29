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

  /**
   * HOST TYPE DRIFT: `useTags()` returns `TagListItem`, which lacks the
   * `createdAt`/`updatedAt` present on the kit's `Tag` even though the two are
   * meant to be one shape. Neither `TagFilterBar` nor `EntityListRow` reads
   * either field, so the cast is safe — but it is the host's inconsistency, not
   * this package's, and it is filed as a patch.
   */
  const tagCatalog = tags as unknown as Tag[];
  const tagLookup = useMemo(() => new Map(tagCatalog.map((t) => [t.slug, t])), [tagCatalog]);

  const tagBar: TagBarProps = {
    tags: tagCatalog.filter((t) => (t.counts[type] ?? 0) > 0),
    tagFilter,
    onTagToggle,
    tagMode,
    onToggleMode: () => setTagMode((m) => (m === 'and' ? 'or' : 'and')),
    onClear: () => tagFilter.forEach(onTagToggle),
  };

  return { query, tags, tagLookup, tagBar };
}
