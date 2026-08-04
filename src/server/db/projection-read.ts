/**
 * Reading back a collection that projects to its OWN table.
 *
 * `projection.ts` emits the table, `projection-write.ts` fills it, and until now
 * nothing generic read it: the one type that has such a table (`endpoint`, whose
 * `linkedDtos` generates `endpoint_dto`) reached it through hand-written SQL in
 * its own serializer, via the deliberate `reader.db` escape hatch. That was
 * tenable while snapshots were hand-written and is not once the host generates
 * them — the generated snapshot has to answer `linkedDtos` for a type it knows
 * nothing about beyond the declaration.
 *
 * This is the mirror of `syncProjectionTable`, and it is written as one on
 * purpose: the same `itemFields` rule (an object's fields, or the single `value`
 * column for a scalar item), the same `columnOf` mapping, read in the opposite
 * direction. Where the writer maps FIELD NAME → column, this maps column →
 * FIELD NAME, because a snapshot is keyed by what the type declared, not by what
 * SQLite happens to call it.
 *
 * Deliberately NOT folded into `RawEntityReader.hydrate`. Hydrate runs once per
 * row of every list read; adding a query per row there would put a junction
 * lookup in the hot path of every page render, and would change the payload of
 * every generic view — neither of which this tier is asking for.
 */

import type { Database } from 'better-sqlite3';
import {
  columnOf,
  type CollectionNode,
  type FieldNode,
} from '../../shared/plugin-host/data-schema.js';
import { bindingColumnOf, projectionTableOf, type ProjectableModule } from './projection.js';

/** The item's named fields, or the single synthetic `value` column of a scalar item. */
export function itemFieldsOf(node: CollectionNode): Array<[string, FieldNode]> {
  return node.item.kind === 'object'
    ? Object.entries(node.item.fields)
    : [['value', node.item]];
}

/**
 * Decode one column value back to its declared shape.
 *
 * The inverse of `projection-write.ts#encode`, and it has to be exact: a value
 * that decodes differently from how it was encoded breaks the `file → index →
 * file` fixpoint, which is the invariant this release spends its correctness
 * budget on. `null` stays `null` for every kind — the column is nullable, the
 * declaration says the field is optional, and inventing a zero value here would
 * put a `0` or a `''` in the entity file that no one wrote.
 */
function decode(node: FieldNode, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (node.kind) {
    case 'boolean':
      return !!value;
    case 'number':
      return typeof value === 'number' ? value : Number(value);
    case 'string':
    case 'enum':
      return typeof value === 'string' ? value : String(value);
    default:
      if (typeof value !== 'string') return value;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
  }
}

/**
 * Every item of one entity's projected collection, keyed by declared field name.
 *
 * Row order is `rowid`, i.e. INSERTION order, which for a value collection is
 * the order the payload was written in. That is the right default: an ordered
 * collection keeps the order its author gave it, and an `unordered` one is
 * sorted by the snapshot generator afterwards rather than by SQL — one place
 * that decides what "sorted" means, shared with the embedded collections that
 * have no table to sort in.
 *
 * A missing table reads as `[]` rather than throwing. A type can be active with
 * its projection not yet applied (an envelope that failed to build, a database
 * restored from before the type existed), and a snapshot that 500s on a whole
 * release restore is a worse answer than one reporting an empty collection.
 */
export function readProjectionCollection(
  db: Database,
  module: ProjectableModule,
  field: string,
  node: CollectionNode,
  slug: string,
): Array<Record<string, unknown> | unknown> {
  const table = projectionTableOf(module, field, node);
  const binding = bindingColumnOf(module);
  const fields = itemFieldsOf(node);
  const columns = fields.map(([name, n]) => columnOf(name, n));

  let rows: Array<Record<string, unknown>>;
  try {
    rows = db
      .prepare(`SELECT ${columns.join(', ')} FROM ${table} WHERE ${binding} = ? ORDER BY rowid`)
      .all(slug) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }

  return rows.map((row) => {
    // A scalar item projects to one `value` column and comes back as the bare
    // value — `['a','b']`, not `[{value:'a'},{value:'b'}]`. The collection has
    // to read back as the shape that was written into it.
    if (node.item.kind !== 'object') return decode(node.item, row[columns[0]!]);
    const out: Record<string, unknown> = {};
    fields.forEach(([name, n], i) => {
      out[name] = decode(n, row[columns[i]!]);
    });
    return out;
  });
}
