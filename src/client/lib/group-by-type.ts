import type { ProjectTypeCard } from '../../shared/project-types.js';

/**
 * 2.1.86 (M31, M52) — the one grouping rule of the project lists grouped by
 * type: `/welcome`, the project switcher and `Used skill projects`.
 *
 *  - `known`: one group per registry type that has an item, in the order of the
 *    `GET /api/workspace/project-types` array (never re-sorted here), headed by
 *    the type's `name`; a type with no item has no group;
 *  - `unknown`: one group per slug the registry does not carry, after every
 *    known group, alphabetically by slug, headed by the slug itself;
 *  - `untyped`: the items with no slug, last, with no header.
 *
 * No branch on a particular slug: the order comes from the registry alone. The
 * order of items inside a group is the order they come in.
 */
export interface KnownTypeGroup<T> {
  slug: string;
  name: string;
  items: T[];
}

export interface UnknownTypeGroup<T> {
  slug: string;
  items: T[];
}

export interface TypeGroups<T> {
  known: KnownTypeGroup<T>[];
  unknown: UnknownTypeGroup<T>[];
  untyped: T[];
}

export function groupByType<T>(
  items: readonly T[],
  typeOf: (item: T) => string | undefined,
  types: readonly ProjectTypeCard[],
): TypeGroups<T> {
  const bySlug = new Map<string, T[]>();
  const untyped: T[] = [];
  for (const item of items) {
    const slug = typeOf(item);
    if (slug === undefined) {
      untyped.push(item);
      continue;
    }
    const group = bySlug.get(slug);
    if (group) group.push(item);
    else bySlug.set(slug, [item]);
  }
  const known: KnownTypeGroup<T>[] = [];
  for (const t of types) {
    const groupItems = bySlug.get(t.slug);
    if (!groupItems) continue;
    known.push({ slug: t.slug, name: t.name, items: groupItems });
    bySlug.delete(t.slug);
  }
  const unknown = [...bySlug.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([slug, groupItems]) => ({ slug, items: groupItems }));
  return { known, unknown, untyped };
}
