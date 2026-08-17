/**
 * M39 L2 — reading a KEYED collection: `collection_overview` and
 * `collection_window` (brief items 17, 18).
 *
 * A keyed collection is the one part of an entity that cannot be read whole.
 * Every other operation in this core answers with an entity or a page, because
 * those have a size the author chose; a grid does not — its size is the product
 * of two dimensions, so "read the entity" for a 500×40 sheet means twenty
 * thousand item bodies to answer a question that was usually about four of them.
 *
 * Hence two operations rather than one, and the split is the point:
 *
 *   - `overview` answers the SHAPE. Dimensions, the declared flags, and nothing
 *     from the collection's own table — not a `COUNT(*)`, not a `MAX(row)`. It
 *     reads the parent row and stops, which is what makes it cheap enough to be
 *     the thing a consumer calls first, every time, before deciding what to
 *     fetch.
 *   - `window` answers a RECTANGLE, 1-based inclusive on both axes, and returns
 *     exactly the rectangle asked for. A full row and a full column are
 *     DEGENERATE windows (one axis pinned, or one axis spanning its extent),
 *     deliberately not primitives of their own — three read shapes that must
 *     agree about sparseness, clamping and ordering are three chances for them
 *     to disagree.
 *
 * SPARSENESS IS INVISIBLE HERE. The store holds a row only for a non-empty item,
 * and neither operation lets a caller tell "this key was deleted" from "this key
 * was never written" — the window materializes both as the item's empty value.
 * That is the declared contract, not an implementation shortcut: the two states
 * are the same state, and exposing a difference would invite a consumer to
 * depend on one.
 */

import {
  axesOf,
  columnOf,
  isKeyed,
  payloadFieldsOf,
  type AxisSpec,
  type CollectionNode,
  type FieldNode,
} from '../../../shared/plugin-host/data-schema.js';
import {
  bindingColumnOf,
  mainTableOf,
  projectionTableOf,
  type ProjectableModule,
} from '../../db/projection.js';
import { decodeColumn, itemFieldsOf } from '../../db/projection-read.js';
import { entityNotFound, invalidArgument, invalidType } from '../errors.js';
import type {
  CollectionOverviewInput,
  CollectionOverviewResult,
  CollectionWindowInput,
  CollectionWindowResult,
  DiscoveryDeps,
} from '../types.js';

/** How wide a rectangle one call may ask for. */
export const MAX_WINDOW_CELLS = 10_000;

/**
 * Resolve `(type, field)` to a declared keyed collection, or refuse with the
 * alternatives that exist.
 *
 * Refusing with navigation rather than a bare "not a keyed collection" matters
 * more here than elsewhere: a keyed collection is the only field kind with its
 * own read surface, so a caller that names the wrong field has no way to
 * discover the right one from the entity payload — the field is deliberately
 * absent from it.
 */
function requireKeyedCollection(
  deps: DiscoveryDeps,
  type: string,
  field: string,
): { module: ProjectableModule; node: CollectionNode } {
  const module = deps.host.getEntity(type);
  if (!module) throw invalidType(type, deps.host.listEntities().map((m) => m.type));

  const node = module.data?.schema?.[field];
  if (!node || !isKeyed(node)) {
    const keyed = Object.entries(module.data?.schema ?? {})
      .filter(([, n]) => isKeyed(n))
      .map(([name]) => name);
    throw invalidArgument(
      `'${field}' is not a keyed collection of ${type}`,
      keyed.length
        ? `keyed collections of ${type}: ${keyed.join(', ')}.`
        : `${type} declares no keyed collection — read it with get_entities instead.`,
    );
  }
  /**
   * Registration guarantees two axes, so reaching here without them is a wiring
   * bug rather than a data condition — but it must still surface as an error
   * with a name on it. Without this the window builder indexes `bounds[0]!` on
   * an empty array and dies with a `TypeError` the transport reports as a bare
   * 500, which says nothing about which type is misdeclared.
   */
  if (axesOf(node).length !== 2) {
    throw invalidArgument(
      `${type}.${field} is a keyed collection but declares ${axesOf(node).length} axes, not 2 — ` +
        `it cannot be read as a window`,
      `this is a declaration bug in the type, not in the call; the plugin must declare exactly two axes.`,
    );
  }

  return { module: module as ProjectableModule, node };
}

/** The parent row, or an `ENTITY_NOT_FOUND` carrying the slugs that do exist. */
function requireParent(
  deps: DiscoveryDeps,
  module: ProjectableModule,
  slug: string,
  columns: readonly string[],
): Record<string, unknown> {
  const selection = columns.length ? columns.join(', ') : '1 AS present';
  const row = deps.db
    .prepare(`SELECT ${selection} FROM ${mainTableOf(module)} WHERE slug = ?`)
    .get(slug) as Record<string, unknown> | undefined;
  if (!row) throw entityNotFound(module.type, slug, deps.reader.listSlugs(module.type));
  return row;
}

/** The parent column holding an axis's length. */
function extentColumnOf(module: ProjectableModule, axis: AxisSpec): string {
  const node = module.data?.schema?.[axis.extent];
  return node ? columnOf(axis.extent, node) : axis.extent;
}

/** The projection column holding an axis's coordinate. */
function axisColumnOf(node: CollectionNode, axis: AxisSpec): string {
  return node.item.type === 'object' && node.item.fields[axis.key]
    ? columnOf(axis.key, node.item.fields[axis.key] as FieldNode)
    : axis.key;
}

/**
 * The shape of a keyed collection, WITHOUT materializing a single item.
 *
 * The dimensions come from the parent's declared extent fields rather than from
 * the collection's stored coordinates, and that is the whole reason this is
 * cheap. It is also the only answer consistent with sparseness: with an empty
 * value not stored, a `MAX(row)` would shrink the grid the moment the last cell
 * of the last row was cleared — trailing empty rows are metadata, and metadata
 * lives on the parent.
 */
export function collectionOverview(
  deps: DiscoveryDeps,
  input: CollectionOverviewInput,
): CollectionOverviewResult {
  const { module, node } = requireKeyedCollection(deps, input.type, input.field);
  const axes = axesOf(node);
  const columns = axes.map((axis) => extentColumnOf(module, axis));
  const row = requireParent(deps, module, input.slug, columns);

  return {
    type: module.type,
    slug: input.slug,
    field: input.field,
    axes: axes.map((axis, i) => ({
      key: axis.key,
      extent: axis.extent,
      length: Number(row[columns[i]!] ?? 0),
    })),
    itemFields: payloadFieldsOf(node),
    flags: {
      ...(node.required ? { required: true } : {}),
      ...(node.unordered ? { unordered: true } : {}),
      ...(node.item.type === 'object' ? {} : { scalarItem: node.item.type }),
    },
  };
}

/**
 * The declared rectangle, row-major, absent coordinates materialized as empty.
 *
 * "Exactly the declared rectangle" is load-bearing and is why the result is
 * built by iterating the COORDINATE SPACE and looking rows up, rather than by
 * mapping whatever the query returned. A sparse table returns fewer rows than
 * the rectangle has cells, and a caller handed a ragged array cannot address it
 * by coordinate — which is the only way anyone addresses a grid.
 *
 * The rectangle is NOT clamped to the extents. A window past the end comes back
 * as empty cells, because the alternative is a caller that asked for rows 1..20
 * of a 12-row sheet receiving a 12-row answer it has to re-measure to
 * understand. `overview` is where you learn the size; this is where you read.
 */
export function collectionWindow(
  deps: DiscoveryDeps,
  input: CollectionWindowInput,
): CollectionWindowResult {
  const { module, node } = requireKeyedCollection(deps, input.type, input.field);
  const axes = axesOf(node);
  requireParent(deps, module, input.slug, []);

  const bounds = axes.map((axis, i) => {
    const from = i === 0 ? input.a1 : input.b1;
    const to = i === 0 ? input.a2 : input.b2;
    for (const [name, value] of [
      [i === 0 ? 'a1' : 'b1', from],
      [i === 0 ? 'a2' : 'b2', to],
    ] as const) {
      if (!Number.isInteger(value) || (value as number) < 1) {
        throw invalidArgument(
          `${name} must be an integer >= 1 — coordinates are 1-based inclusive, got ${String(value)}`,
          `collection_window({ type: "${input.type}", slug: "${input.slug}", field: "${input.field}", a1: 1, b1: 1, a2: 1, b2: 1 })`,
        );
      }
    }
    if ((to as number) < (from as number)) {
      throw invalidArgument(
        `the ${axis.key} axis runs from ${from} to ${to} — the upper bound must not be below the lower one`,
        `swap them: ${i === 0 ? 'a1' : 'b1'}=${to}, ${i === 0 ? 'a2' : 'b2'}=${from}`,
      );
    }
    return { axis, from: from as number, to: to as number };
  });

  const cells = bounds.reduce((acc, b) => acc * (b.to - b.from + 1), 1);
  if (cells > MAX_WINDOW_CELLS) {
    throw invalidArgument(
      `that window is ${cells} cells, past the per-call limit of ${MAX_WINDOW_CELLS}`,
      `ask for a smaller rectangle and page across it — call collection_overview first to see the dimensions.`,
    );
  }

  const table = projectionTableOf(module, input.field, node);
  const binding = bindingColumnOf(module);
  const fields = itemFieldsOf(node);
  const columns = fields.map(([name, n]) => columnOf(name, n));
  const axisColumns = bounds.map((b) => axisColumnOf(node, b.axis));

  let rows: Array<Record<string, unknown>> = [];
  try {
    rows = deps.db
      .prepare(
        `SELECT ${columns.join(', ')} FROM ${table} WHERE ${binding} = ? AND ` +
          axisColumns.map((c) => `${c} BETWEEN ? AND ?`).join(' AND '),
      )
      .all(input.slug, ...bounds.flatMap((b) => [b.from, b.to])) as Array<Record<string, unknown>>;
  } catch (err) {
    /**
     * A missing TABLE reads as an empty window, everything else rethrows —
     * the same split `readProjectionCollection` makes, and for the same reason:
     * a type can be active with its projection unapplied, and there is
     * genuinely nothing to read. Any other SQL error is a bug that must not be
     * laundered into "the grid is empty".
     */
    if (!/no such table/i.test((err as Error).message ?? '')) throw err;
  }

  const keyed = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    keyed.set(axisColumns.map((c) => Number(row[c])).join(':'), row);
  }

  const empty = emptyItemOf(node);
  const items: unknown[][] = [];
  for (let a = bounds[0]!.from; a <= bounds[0]!.to; a++) {
    const line: unknown[] = [];
    for (let b = bounds[1]!.from; b <= bounds[1]!.to; b++) {
      const row = keyed.get(`${a}:${b}`);
      line.push(row ? decodeItem(node, fields, columns, row) : empty);
    }
    items.push(line);
  }

  return {
    type: module.type,
    slug: input.slug,
    field: input.field,
    window: bounds.map((b) => ({ key: b.axis.key, from: b.from, to: b.to })),
    items,
  };
}

/**
 * One stored row, decoded to the shape a cell has — PAYLOAD FIELDS ONLY.
 *
 * The coordinates are deliberately dropped, and that is what keeps a present
 * cell and an absent one the same shape. A window is addressed by array
 * position, so `items[a - a1][b - b1]` already carries the coordinate; echoing
 * it inside the body would mean a caller could read `cell.r` on a written cell
 * and get `undefined` on an empty one sitting right beside it — two shapes for
 * one collection, and a consumer that works until the first gap in the grid.
 */
function decodeItem(
  node: CollectionNode,
  fields: Array<[string, FieldNode]>,
  columns: readonly string[],
  row: Record<string, unknown>,
): unknown {
  if (node.item.type !== 'object') return decodeColumn(node.item, row[columns[0]!]);
  const payload = new Set(payloadFieldsOf(node));
  const out: Record<string, unknown> = {};
  fields.forEach(([name, n], i) => {
    if (payload.has(name)) out[name] = decodeColumn(n, row[columns[i]!]);
  });
  return out;
}

/**
 * What an unwritten coordinate materializes as.
 *
 * A scalar item is its own empty value (`''` for a string cell); an object item
 * is an object whose payload fields are all `null`, and whose coordinates are
 * deliberately absent — the coordinate of an empty cell is the position it
 * occupies in the returned array, and duplicating it inside the item would
 * invite a consumer to read the key off a body that has no row behind it.
 */
function emptyItemOf(node: CollectionNode): unknown {
  if (node.item.type !== 'object') {
    return node.item.type === 'number' ? null : node.item.type === 'boolean' ? null : '';
  }
  const out: Record<string, unknown> = {};
  for (const name of payloadFieldsOf(node)) out[name] = null;
  return out;
}
