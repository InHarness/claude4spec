import { useMemo } from 'react';
import { useTags } from '../hooks/useTags.js';
import type { Tag } from '../../shared/plugin-host/tag.js';

/** The map a list hands its rows while `['tags']` has no data (or the project has no tags). */
const EMPTY_TAG_LOOKUP: ReadonlyMap<string, Tag> = new Map();

/**
 * 2.1.40 (M13 ← M18) — the `tagLookup` a list hands every `renderRow` slot.
 *
 * Called ONCE per list (`element_list`, `tagged_list`, `tagged_list_mixed`),
 * never per row: one host query under `['tags']`, one `slug → Tag` map, and the
 * same instance for every row of that list. Both pipelines — the Tiptap
 * NodeView and react-markdown — render a list through the same tag renderers,
 * so both get it from here. The slot itself never fetches tags.
 *
 * A changed tag (recolour, rename) invalidates `['tags']`; the new list yields a
 * new map, so the rows re-render with the new colours without a page reload.
 */
export function useListTagLookup(): ReadonlyMap<string, Tag> {
  const { data } = useTags();
  return useMemo(
    () => (data && data.length > 0 ? new Map(data.map((t) => [t.slug, t] as const)) : EMPTY_TAG_LOOKUP),
    [data],
  );
}
