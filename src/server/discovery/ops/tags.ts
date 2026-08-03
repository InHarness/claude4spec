/**
 * M39 — `list_tags`.
 *
 * Counts become OPT-IN. Full counts are a cartesian product of tags × active
 * types, and every caller paid for it whether or not it looked. `minCount`
 * filters, and `coOccurringWith` is the only way to discover a taxonomy without
 * already knowing it: give it a tag and it answers which tags share entities
 * with it, and how often.
 */

import type { Database } from 'better-sqlite3';
import { DEFAULT_LIMITS, paginate } from '../pagination.js';
import type { RawEntityReader } from '../raw-entity-reader.js';
import type { ListTagsInput, ListTagsResult, TagListItem } from '../types.js';

export function listTags(db: Database, reader: RawEntityReader, input: ListTagsInput = {}): ListTagsResult {
  const withCounts = input.withCounts ?? false;
  // `minCount` only means something against counts, so asking for it turns
  // them on rather than filtering on numbers nobody computed.
  const needCounts = withCounts || input.minCount !== undefined;

  const coOccurrence = input.coOccurringWith
    ? coOccurrenceFor(db, input.coOccurringWith, reader.listTypes())
    : null;

  let items: TagListItem[] = reader.listTags().map((tag) => {
    const total = needCounts ? Object.values(tag.counts).reduce((n, c) => n + c, 0) : 0;
    return {
      slug: tag.slug,
      name: tag.name,
      color: tag.color,
      description: tag.description,
      ...(withCounts ? { counts: tag.counts } : {}),
      ...(coOccurrence ? { coOccurrence: coOccurrence.get(tag.slug) ?? 0 } : {}),
      _total: total,
    } as TagListItem & { _total: number };
  });

  if (input.minCount !== undefined) {
    const min = input.minCount;
    items = items.filter((t) => (t as TagListItem & { _total: number })._total >= min);
  }
  if (coOccurrence) {
    // Asking which tags co-occur with X and being handed every tag in the
    // project, most of them with 0, is not an answer to the question.
    items = items.filter((t) => (t.coOccurrence ?? 0) > 0 && t.slug !== input.coOccurringWith);
  }

  for (const item of items) delete (item as TagListItem & { _total?: number })._total;

  items.sort((a, b) =>
    coOccurrence
      ? (b.coOccurrence ?? 0) - (a.coOccurrence ?? 0) || a.slug.localeCompare(b.slug)
      : a.slug.localeCompare(b.slug),
  );

  return paginate(items, input, DEFAULT_LIMITS.listTags);
}

/**
 * How many entities each other tag shares with `slug`.
 *
 * 0.2.7 — scoped to the ACTIVE types, for the same reason the counts above are:
 * a deactivated type's assignments now survive the rebuild, and counting them
 * here would answer "these tags co-occur on N entities" about entities the
 * project does not serve.
 */
function coOccurrenceFor(db: Database, slug: string, activeTypes: string[]): Map<string, number> {
  if (activeTypes.length === 0) return new Map();
  const placeholders = activeTypes.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT other.tag_slug AS slug, COUNT(*) AS c
         FROM entity_tag base
         JOIN entity_tag other
           ON other.entity_type = base.entity_type
          AND other.entity_slug = base.entity_slug
        WHERE base.tag_slug = ? AND other.tag_slug != base.tag_slug
          AND base.entity_type IN (${placeholders})
        GROUP BY other.tag_slug`,
    )
    .all(slug, ...activeTypes) as Array<{ slug: string; c: number }>;
  return new Map(rows.map((r) => [r.slug, r.c]));
}
