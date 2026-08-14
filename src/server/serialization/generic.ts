import type { RawEntity, RawSection } from '../discovery/raw-entity-reader.js';
import {
  columnOf,
  contentBearingKeys,
  contentBytes,
  type FieldNode,
} from '../../shared/plugin-host/data-schema.js';

/**
 * THE read record — the only shape an entity is ever read in.
 *
 * 0.2.9 renamed this from `fallback` (a type that declares its data and computes
 * nothing is fully served, not degraded); 0.2.23 made the name redundant in the
 * other direction. There is no non-generic payload left to distinguish this
 * from, so the provenance markers `_generic` / `_type` / `_view` go with the
 * distinction they described: a flag every row carries identically tells a
 * consumer nothing.
 *
 * Width is not decided here. This produces the widest honest record and
 * `discovery/project.ts` cuts it to the caller's `select`.
 */
export function genericEntity(
  entity: RawEntity,
  schema?: Readonly<Record<string, FieldNode>>,
): Record<string, unknown> {
  return {
    type: entity.type,
    slug: entity.slug,
    tags: entity.tags,
    ...byFieldName(entity.data, schema),
  };
}

/**
 * Re-key a hydrated row from COLUMN names to DECLARED field names.
 *
 * `RawEntityReader.hydrate` keys `data` by column, because a column is what it
 * read. That is invisible for a single-word field (`name` → `name`) and wrong
 * the moment a field has two words: `ui-view.designSystemSlug` projects to
 * `design_system_slug`, so a type with no computed view was serving snake_case
 * on a JSON API while its own declaration, its entity FILE and its snapshot all
 * said camelCase — the same entity, spelled two ways, depending on whether its
 * type happened to hand-write a view.
 *
 * 2.0.0 tier K makes that reachable rather than theoretical: a type that
 * declares only its data (item 63) computes NO views, so this is the only shape
 * it ever has. Fixed here, at the one place a raw row reaches a client, rather
 * than in `hydrate` — every other consumer of `entity.data` was written against
 * column keys, and re-keying the reader would move the inconsistency instead of
 * removing it.
 *
 * Unknown columns pass through untouched: a row may carry a column the schema no
 * longer declares (mid-migration), and dropping it silently would be worse than
 * serving it under the name the table uses.
 */
function byFieldName(
  data: Record<string, unknown>,
  schema: Readonly<Record<string, FieldNode>> | undefined,
): Record<string, unknown> {
  if (!schema) return data;

  const fieldByColumn = new Map<string, string>();
  for (const [field, node] of Object.entries(schema)) {
    fieldByColumn.set(columnOf(field, node), field);
  }

  const out: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(data)) {
    const field = fieldByColumn.get(column) ?? column;
    const node = schema[field];
    // 0.2.19 — a `contentBearing` field never travels in a view. What the caller
    // gets instead answers the two questions a view can honestly answer about a
    // body it is not carrying: is there one, and how big. The content itself is
    // read through the type's own operation.
    if (node?.contentBearing) {
      const keys = contentBearingKeys(field);
      const bytes = contentBytes(value);
      out[keys.has] = bytes > 0;
      out[keys.bytes] = bytes;
      continue;
    }
    out[field] = value;
  }

  // The two derived keys come from the SCHEMA, not from the row's key set: the
  // derived JSON Schema declares both `required` unconditionally, and a row
  // hydrated without the content column (or written before the field existed)
  // would otherwise produce a payload that fails its own schema. "No body" is
  // `false`/`0`, which is what the loop above already says for a null column.
  for (const [field, node] of Object.entries(schema)) {
    if (!node.contentBearing) continue;
    const keys = contentBearingKeys(field);
    if (keys.has in out) continue;
    out[keys.has] = false;
    out[keys.bytes] = 0;
  }
  return out;
}

export function genericSection(section: RawSection): Record<string, unknown> {
  return {
    type: 'section',
    anchor: section.anchor,
    pagePath: section.pagePath,
    headingPath: section.headingPath,
    headingText: section.headingText,
    headingLevel: section.headingLevel,
    lineStart: section.lineStart,
    lineEnd: section.lineEnd,
  };
}
