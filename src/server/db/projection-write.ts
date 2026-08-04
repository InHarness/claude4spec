/**
 * Host API 2.0.0 (brief item 6) — the host writes the projection it generated.
 *
 * `projection.ts` derives a type's tables from its `data.schema`. This is the
 * other half: given the same declaration, write a row into those tables. With
 * both halves present, a type that declares its data needs no code at all to be
 * created, updated, indexed and restored — which is the sentence the whole
 * release is built around.
 *
 * WHY THIS EXISTS AT ALL, given every in-repo type still ships a
 * `backend.service`. 0.2.2 collapsed the writer's surface to one generic
 * `upsert(type, …)` but left the mechanism per-type: the call resolved through
 * `host.getEntityService(type)`, so a type with no service had no write door and
 * restore reported it as a skip. That made "active but unwritable" a reachable
 * state — a type could be read, indexed, searched and diffed, and then silently
 * dropped by the one operation that puts data back. This module removes that
 * state rather than documenting it.
 *
 * It is deliberately NOT a reimplementation of the six services. Those still own
 * their domain validation, their derived fields and their own slug allocation,
 * and are still preferred when present (`HostEntityWriter.upsert`). What this
 * covers is exactly what the declaration can justify: the columns
 * `generateProjectionDDL` emitted, the projection tables it emitted beside them,
 * the audit stamp, and the `entity_version` capture every other write path makes.
 *
 * SYMMETRY IS THE CONTRACT. Every value written here must read back through
 * `RawEntityReader.hydrate` as the value that went in — embedded collections and
 * objects as JSON text, booleans as 0/1, `systemManaged` columns from the stamp
 * and never from the payload. A field that cannot survive that round trip would
 * break the `file → index → file` fixpoint, which is the invariant this release
 * spends its correctness budget on.
 */

import type { Database } from 'better-sqlite3';
import {
  columnOf,
  hasProjectionTable,
  isEmbedded,
  type CollectionNode,
  type FieldNode,
} from '../../shared/plugin-host/data-schema.js';
import type { ChangedBy } from '../../shared/entities.js';
import type { WriteOpts } from '../core/plugin-host/types.js';
import type { UpsertResult } from '../serialization/writer.js';
import { resolveStamp } from '../entities/system-stamp.js';
import { DomainError } from '../services/tags.js';
import {
  bindingColumnOf,
  mainTableOf,
  projectionTableOf,
  type ProjectableModule,
} from './projection.js';

/**
 * `ProjectableModule` plus the one field the capture needs. Kept local rather
 * than widened in `projection.ts`, because the DDL generator has no business
 * knowing a payload version exists.
 */
export interface WritableModule extends ProjectableModule {
  payloadVersion?: number;
}

/**
 * What the door needs beyond the declaration.
 *
 * `versions` is typed structurally rather than as `VersionService` for the same
 * reason `EntityWriter` drives services by shape: this module lives under `db/`
 * and importing a service class here would invert the dependency the Single
 * Abstraction Rule test guards.
 */
export interface ProjectionWriteDeps {
  db: Database;
  versions: {
    captureEntitySnapshot(
      type: string,
      slug: string,
      op: 'create' | 'update' | 'delete',
      actor: ChangedBy,
      summary: string | null,
      serializerVersion: string,
    ): unknown;
  } | null;
}

/**
 * Encode one payload value for its column.
 *
 * The `null` return is "write SQL NULL", not "skip" — callers that need the
 * difference check for the key's presence before calling.
 */
function encode(node: FieldNode, value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  switch (node.kind) {
    case 'boolean':
      return value ? 1 : 0;
    case 'number':
      return typeof value === 'number' ? value : Number(value);
    case 'string':
    case 'enum':
      return typeof value === 'string' ? value : String(value);
    default:
      // object, record, and every embedded collection: JSON text, which is what
      // `hydrate` parses back by probing for a leading `[` or `{`.
      return JSON.stringify(value);
  }
}

/**
 * The value a column takes when the payload does not carry the field.
 *
 * Mirrors `projection.ts`'s `defaultClause` exactly — an embedded collection is
 * `'[]'` and never NULL, so a reader never has two empty cases. The DDL default
 * would cover the INSERT, but not the UPDATE arm of the upsert, which names
 * every column unconditionally.
 */
function absentValue(node: FieldNode): string | number | null {
  if (node.default !== undefined) return encode(node, node.default);
  if (node.kind === 'collection') return '[]';
  return null;
}

function enumViolation(node: FieldNode, value: unknown): string | null {
  if (node.kind !== 'enum' || value === null || value === undefined) return null;
  return node.values.includes(value as string)
    ? null
    : `expected one of ${node.values.join(', ')}, got '${String(value)}'`;
}

/**
 * Write one entity row plus its projection tables, and capture a version.
 *
 * `input` is a payload keyed by DECLARED FIELD NAMES (`designSystemSlug`), not
 * by column names (`design_system_slug`) — the same shape the snapshot carries,
 * so restore can hand its payload straight through.
 */
export function upsertProjectionRow<T = Record<string, unknown>>(
  deps: ProjectionWriteDeps,
  module: WritableModule,
  slug: string,
  input: unknown,
  actor: ChangedBy,
  opts: WriteOpts,
): UpsertResult<T> {
  const schema = module.data?.schema;
  if (!schema) {
    throw new DomainError(
      'VALIDATION',
      `type '${module.type}' declares no data.schema — the host has nothing to write`,
    );
  }
  if (!slug.trim()) throw new DomainError('VALIDATION', 'slug resolves to empty');

  const payload = (input ?? {}) as Record<string, unknown>;
  const { db } = deps;
  const table = mainTableOf(module);

  const columns: string[] = ['slug'];
  const values: Array<string | number | null> = [slug];
  const violations: string[] = [];

  for (const [name, node] of Object.entries(schema)) {
    if (!isEmbedded(node)) continue;
    // Written from the stamp below, never from the payload — that is what
    // `systemManaged` means and what keeps the timestamps the file's business.
    if (node.systemManaged) continue;

    const present = Object.prototype.hasOwnProperty.call(payload, name);
    const raw = present ? payload[name] : undefined;

    if (node.required && (raw === null || raw === undefined)) {
      violations.push(`${name} is required`);
      continue;
    }
    const bad = enumViolation(node, raw);
    if (bad) {
      // Reject rather than coerce. The retired per-type code mapped an unknown
      // `diagram.format` onto `mermaid` silently, which turned a typo into a
      // wrong diagram that rendered fine — the exact failure mode a declared
      // enum exists to make impossible.
      violations.push(`${name}: ${bad}`);
      continue;
    }

    columns.push(columnOf(name, node));
    values.push(present && raw !== undefined ? encode(node, raw) : absentValue(node));
  }

  if (violations.length) {
    throw new DomainError(
      'VALIDATION',
      `${module.type}/${slug}: ${violations.join('; ')}`,
    );
  }

  /**
   * The audit columns are read off the DECLARATION, not assumed.
   *
   * `created_at`/`updated_at` are ordinary `systemManaged` fields a type opts
   * into; the six built-ins all do, but a type is free not to. Probing for
   * `created_at` unconditionally would throw `no such column` on such a type —
   * turning "this type declared a leaner schema" into a write failure.
   */
  const stampColumns = new Map<'createdAt' | 'updatedAt', string>();
  for (const [name, node] of Object.entries(schema)) {
    if (!isEmbedded(node) || !node.systemManaged) continue;
    const column = columnOf(name, node);
    if (column === 'created_at') stampColumns.set('createdAt', column);
    else if (column === 'updated_at') stampColumns.set('updatedAt', column);
  }

  const createdColumn = stampColumns.get('createdAt');
  const existing = db
    .prepare(`SELECT ${createdColumn ?? '1 AS present'} FROM ${table} WHERE slug = ?`)
    .get(slug) as Record<string, unknown> | undefined;
  const op: 'created' | 'updated' = existing ? 'updated' : 'created';

  if (stampColumns.size) {
    const stamp = resolveStamp(
      module.type,
      opts,
      existing && createdColumn ? { created_at: existing[createdColumn] ?? null } : null,
    );
    const created = stampColumns.get('createdAt');
    if (created) {
      columns.push(created);
      values.push(stamp.createdAt);
    }
    const updated = stampColumns.get('updatedAt');
    if (updated) {
      columns.push(updated);
      values.push(stamp.updatedAt);
    }
  }

  const assignments = columns
    .filter((c) => c !== 'slug')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO ${table} (${columns.join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})
       ON CONFLICT(slug) DO UPDATE SET ${assignments}`,
    ).run(...values);

    for (const [name, node] of Object.entries(schema)) {
      if (!hasProjectionTable(node)) continue;
      syncProjectionTable(db, module, slug, name, node as CollectionNode, payload[name]);
    }
  });
  tx();

  /**
   * Capture AFTER the row lands, exactly as every service does: the capture
   * re-reads the entity through `RawEntityReader` and snapshots what it finds,
   * so a capture that ran first would record the pre-write state.
   */
  if (opts.capture !== false && deps.versions) {
    deps.versions.captureEntitySnapshot(
      module.type,
      slug,
      op === 'created' ? 'create' : 'update',
      actor,
      op === 'created' ? 'Created' : 'Updated',
      String(module.payloadVersion ?? 1),
    );
  }

  const entity = { slug, ...payload } as T;
  return { entity, op };
}

/**
 * Replace a collection's projection rows wholesale.
 *
 * Full replace is the declared semantics of a VALUE collection — "the collection
 * IS the field", so writing it writes all of it. A keyed collection reconciles
 * key-by-key instead and is tier C's; it is rejected loudly here rather than
 * quietly given the value treatment, because the two differ in exactly the case
 * that matters (a key absent from the payload).
 */
function syncProjectionTable(
  db: Database,
  module: WritableModule,
  slug: string,
  field: string,
  node: CollectionNode,
  value: unknown,
): void {
  if (node.collection === 'keyed') {
    throw new DomainError(
      'VALIDATION',
      `${module.type}.${field} is a keyed collection — generic writes for keyed ` +
        `collections are not implemented (tier C); it reconciles per key rather ` +
        `than replacing wholesale, so it must not fall through to a value write`,
    );
  }

  const table = projectionTableOf(module, field, node);
  const binding = bindingColumnOf(module);

  // Undefined means "the payload said nothing about this collection", which for
  // a value collection is indistinguishable from "empty" — the field IS the
  // collection, so an absent field is an absent collection.
  const items = Array.isArray(value) ? value : [];

  db.prepare(`DELETE FROM ${table} WHERE ${binding} = ?`).run(slug);
  if (!items.length) return;

  const item = node.item;
  const itemFields: Array<[string, FieldNode]> =
    item.kind === 'object' ? Object.entries(item.fields) : [['value', item]];
  const columns = [binding, ...itemFields.map(([name, n]) => columnOf(name, n))];
  const insert = db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  );

  for (const entry of items) {
    const row: Record<string, unknown> =
      item.kind === 'object' ? ((entry as Record<string, unknown>) ?? {}) : { value: entry };
    insert.run(
      slug,
      ...itemFields.map(([name, n]) => {
        const raw = row[name];
        return raw === undefined ? absentValue(n) : encode(n, raw);
      }),
    );
  }
}
