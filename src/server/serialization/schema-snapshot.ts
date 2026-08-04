/**
 * Snapshot and restore, generated from `data.schema` (brief items 10 and 11).
 *
 * This is the last of the six things a type used to hand-write about its own
 * fields — DDL, slug function, MCP input schemas, searchable paths, view
 * schemas, and this. Each was a separate description of one field set, kept in
 * sync by hand and free to drift; `endpoint`'s snapshot had in fact drifted,
 * emitting junction COLUMN names into the entity file and coercing an empty
 * `summary` to `null` against a declaration that says `required, default: ''`.
 *
 * The payload is keyed by DECLARED FIELD NAMES, and that is forced rather than
 * chosen: `restoreFromSchema` hands its payload straight to `EntityWriter.upsert`,
 * whose contract is already field-keyed. Any other rule would need an inverse map
 * on the restore side — two naming conventions where the projection already has
 * exactly one (`columnOf`).
 *
 * WHAT IS DELIBERATELY ABSENT from a snapshot, and why each one:
 *   - `systemManaged` (`createdAt`/`updatedAt`) — attached as an envelope by the
 *     chokepoint in `snapshot.ts`, so emitting them here would write them twice
 *     and let the two copies disagree.
 *   - `transientInput` (diagram's `caption`) — it seeds the slug and was never
 *     meant to survive the write; a snapshot that carried it would resurrect it
 *     on every rebuild.
 *   - `localSurrogate` (the rowid) — index-local by definition, and the one
 *     permitted exception to "every column is reproducible from the files".
 */

import type { RawEntity, RawEntityReader } from '../discovery/raw-entity-reader.js';
import {
  columnOf,
  hasProjectionTable,
  isKeyed,
  payloadFieldsOf,
  sortKeyFieldsOf,
  type CollectionNode,
  type FieldNode,
} from '../../shared/plugin-host/data-schema.js';
import type { RestoreContext, RestoreResult, SnapshotData } from './types.js';

/** The manifest surface the generator needs. Structural, so a fixture is one object literal. */
export interface SnapshottableModule {
  type: string;
  data?: { schema: Readonly<Record<string, FieldNode>> };
}

/** Fields that reach the snapshot at all. */
function emitted(schema: Readonly<Record<string, FieldNode>>): Array<[string, FieldNode]> {
  return Object.entries(schema).filter(
    ([, node]) => !node.systemManaged && !node.transientInput && !node.localSurrogate,
  );
}

/**
 * Compare two items of an `unordered` collection.
 *
 * String comparison of the sort-key fields, in declaration order, most
 * significant first — which reproduces the hand-written keys it replaces
 * (`` `${type}/${slug}` `` for `ac.verifies`, `` `${relation}:${dto_slug}:${status_code ?? ''}` ``
 * for the endpoint junction) without either type saying so.
 *
 * `null` and `undefined` collapse to `''` rather than to `'null'`: the endpoint
 * junction's `status_code` is nullable and IS part of its key, and sorting a
 * missing value under the letter `n` would interleave it with real values.
 */
function compareItems(keys: readonly string[], a: unknown, b: unknown): number {
  if (!keys.length) return String(a ?? '').localeCompare(String(b ?? ''));
  for (const key of keys) {
    const araw = (a as Record<string, unknown>)?.[key];
    const braw = (b as Record<string, unknown>)?.[key];
    /**
     * NUMBERS COMPARE AS NUMBERS. A keyed collection's key is a pair of
     * coordinates, and `String(10).localeCompare(String(2))` puts cell 10 before
     * cell 2 — so a snapshot sorted the string way is not sorted at all, and the
     * "two equivalent states produce an identical diff" guarantee this function
     * exists for would hold only for grids under ten rows.
     *
     * Confined to the both-numbers case so nothing else moves: the existing
     * string keys (`ac.verifies`' `type`/`slug`, the endpoint junction's
     * `relation`/`dto_slug`) keep the exact ordering they already have, including
     * the nullable `status_code` collapsing to `''` below.
     */
    if (typeof araw === 'number' && typeof braw === 'number') {
      if (araw !== braw) return araw - braw;
      continue;
    }
    const cmp = String(araw ?? '').localeCompare(String(braw ?? ''));
    if (cmp !== 0) return cmp;
  }
  return 0;
}

/**
 * A keyed collection's snapshot: COMPACTED and sorted by key (item 19, item 11).
 *
 * Two normalizations, both required for the snapshot to be a function of the
 * STATE rather than of the storage:
 *
 *   - Empty items are dropped. The store already holds no row for one, but a
 *     restore payload or a hand-edited file can carry them, and emitting one
 *     would put a cell in the entity file that the next rebuild refuses to
 *     store — a file that does not round-trip through its own index.
 *   - Items sort by the key tuple, unconditionally, without the `unordered`
 *     opt-in that value collections need. There is no authored order to
 *     preserve: a keyed collection's order IS its key, so sorting it is a
 *     normalization rather than the silent edit to authored content that
 *     sorting `design-system.groups[].tokens[]` would be.
 */
function normalizeKeyed(node: CollectionNode, value: unknown): unknown {
  if (!Array.isArray(value)) return [];
  const keys = node.keyFields ?? [];
  const payload = payloadFieldsOf(node);
  return value
    .filter((entry) => {
      if (entry === null || typeof entry !== 'object') return false;
      const row = entry as Record<string, unknown>;
      return !payload.every((name) => {
        const v = row[name];
        return v === undefined || v === null || v === '';
      });
    })
    .sort((a, b) => compareItems(keys, a, b));
}

/**
 * Sort an `unordered` collection, and recurse into nested ones.
 *
 * Recursion matters for `design-system`: `groups` is unordered while
 * `groups[].tokens` is not, so the rule has to be per-node rather than
 * per-subtree. A blanket deep sort would reorder a `sm`/`md`/`xl` scale, which
 * is authored content, not incidental order.
 */
function normalizeCollection(node: CollectionNode, value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  let items: unknown[] = value;

  if (node.item.kind === 'object') {
    const nested = Object.entries(node.item.fields).filter(
      ([, f]) => f.kind === 'collection',
    ) as Array<[string, CollectionNode]>;
    if (nested.length) {
      items = items.map((entry) => {
        if (entry === null || typeof entry !== 'object') return entry;
        const out = { ...(entry as Record<string, unknown>) };
        for (const [name, child] of nested) out[name] = normalizeCollection(child, out[name]);
        return out;
      });
    }
  }

  if (!node.unordered) return items;
  return [...items].sort((a, b) => compareItems(sortKeyFieldsOf(node), a, b));
}

/**
 * The snapshot of one entity, derived entirely from its declaration.
 *
 * A field with no column reads as its declared `default`, or `[]` for a
 * collection, or `null`. Absent-means-null rather than absent-means-omitted so
 * that two entities of the same type always have the same key set — a snapshot
 * whose keys vary by which fields happen to be set produces a diff on every
 * field that was merely never filled in.
 */
export function snapshotFromSchema(
  module: SnapshottableModule,
  entity: RawEntity,
  reader: Pick<RawEntityReader, 'readCollection'>,
): SnapshotData {
  const schema = module.data?.schema;
  if (!schema) throw new Error(`type '${module.type}' declares no data.schema`);

  const out: Record<string, unknown> = { slug: entity.slug };

  for (const [name, node] of emitted(schema)) {
    if (node.kind === 'collection' && hasProjectionTable(node)) {
      const items = reader.readCollection(module.type, entity.slug, name);
      out[name] = isKeyed(node) ? normalizeKeyed(node, items) : normalizeCollection(node, items);
      continue;
    }
    const raw = entity.data[columnOf(name, node)];
    if (raw === undefined || raw === null) {
      out[name] = node.default ?? (node.kind === 'collection' ? [] : null);
      continue;
    }
    out[name] = node.kind === 'collection' ? normalizeCollection(node, raw) : raw;
  }

  // Tags are host-owned rather than declared, so they are appended rather than
  // walked. Always sorted: tag assignment order is not content.
  out.tags = [...entity.tags].sort();
  return out;
}

/**
 * Write a snapshot back, through the same door every other mutation uses.
 *
 * The payload handed to the writer is the snapshot minus `slug` and `tags`,
 * which the writer takes as its own arguments. Everything else passes through
 * unchanged — there is nothing per-type left to translate, which is the point.
 */
export function restoreFromSchema(
  module: SnapshottableModule,
  data: SnapshotData,
  ctx: RestoreContext,
): RestoreResult {
  const schema = module.data?.schema;
  if (!schema) throw new Error(`type '${module.type}' declares no data.schema`);

  const snap = (data ?? {}) as Record<string, unknown>;
  const slug = String(snap.slug ?? '');
  const payload: Record<string, unknown> = {};
  for (const [name] of emitted(schema)) {
    if (name in snap) payload[name] = snap[name];
  }
  // Some services derive the slug from the payload rather than the argument;
  // carrying it costs nothing and removes a per-service difference.
  payload.slug = slug;

  const result = ctx.writer.upsert(module.type, slug, payload, ctx.actor);
  if (!result) {
    // 0.2.2: the type is not active in this project. Report the skip; a
    // deactivated type must not abort a whole restore.
    return {
      op: 'noop',
      entity: null,
      warnings: [`entity service for type '${module.type}' is not available — restore skipped`],
    };
  }

  const tags = Array.isArray(snap.tags) ? (snap.tags as string[]) : [];
  ctx.writer.syncTags(module.type as never, slug, tags);

  return {
    op: result.op,
    entity: result.entity,
    ...(result.warnings?.length ? { warnings: result.warnings } : {}),
  };
}
