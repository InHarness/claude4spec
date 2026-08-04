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
import { typeTablePrefix } from '../../shared/plugin-host/composition.js';
import type { WriteOpts } from '../core/plugin-host/types.js';
import type { UpsertResult } from '../serialization/writer.js';
import {
  resolveStamp,
  resolveStampForUpdate,
  type EntityFileProbe,
} from '../entities/system-stamp.js';
import { DomainError } from '../services/tags.js';
import {
  bindingColumnOf,
  isNotNull,
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
  /**
   * The entity file store, so the pre-update `createdAt` can be read off the
   * FILE rather than the row (0.2.7's rule — see `resolveStampForUpdate`).
   * Optional only so a unit test need not stand one up; every production
   * construction site supplies it.
   */
  store?: EntityFileProbe;
  versions: {
    captureEntitySnapshot(
      type: string,
      slug: string,
      op: 'create' | 'update' | 'delete',
      actor: ChangedBy,
      summary: string | null,
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
 * Mirrors `projection.ts`'s `defaultClause` — an embedded collection is `'[]'`
 * and never NULL, so a reader never has two empty cases. The DDL default would
 * cover the INSERT, but not the UPDATE arm of the upsert, which names every
 * column unconditionally.
 *
 * `computedDefault` has to be honoured HERE, not left to the column DEFAULT.
 * `isNotNull` counts it as NOT NULL, so the generated column is
 * `NOT NULL DEFAULT (datetime('now'))` — and binding an explicit NULL defeats a
 * column default rather than falling back to it, which turned an absent
 * `computedDefault` field into `NOT NULL constraint failed` and, on the rebuild
 * path, into every entity of that type being skipped.
 */
function absentValue(node: FieldNode): string | number | null {
  if (node.default !== undefined) return encode(node, node.default);
  if (node.computedDefault === 'now') return new Date().toISOString();
  if (node.kind === 'collection') return '[]';
  return null;
}

/**
 * The value to bind for a field, given what the payload said about it.
 *
 * The subtlety is `null`. A payload may carry an explicit `null` for a field
 * whose column is NOT NULL — any serializer that passes an optional field
 * straight through emits that shape — and `null !== undefined`, so treating
 * "present" as "use the payload value" bound SQL NULL into a NOT NULL column and
 * killed the write. An explicit null is treated as absence for such a column:
 * the declaration says what empty means there, and it is never NULL.
 *
 * For a nullable column an explicit null still means null, because for those the
 * distinction is real and `clearable` depends on it.
 */
function valueFor(node: FieldNode, present: boolean, raw: unknown): string | number | null {
  if (!present || raw === undefined) return absentValue(node);
  if (raw === null) return isNotNull(node) ? absentValue(node) : null;
  return encode(node, raw);
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
    values.push(valueFor(node, present, raw));
  }

  if (violations.length) {
    throw new DomainError(
      'VALIDATION',
      `${module.type}/${slug}: ${violations.join('; ')}`,
    );
  }

  /**
   * The audit columns are read off the DECLARATION, and keyed by FIELD name.
   *
   * `createdAt`/`updatedAt` are ordinary `systemManaged` fields a type opts into;
   * the six built-ins all do, but a type is free not to, so probing for
   * `created_at` unconditionally would throw `no such column` on a leaner schema.
   *
   * Matching on the field name rather than the derived COLUMN name matters: a
   * type declaring `createdAt: { column: 'made_at', systemManaged: true }` was
   * skipped by the payload loop (it is `systemManaged`) AND missed by this one
   * (its column is not literally `created_at`), so nobody ever wrote it — the
   * column silently fell through to its DDL default and never appeared in the
   * UPDATE assignment list at all.
   */
  const stampColumns = new Map<'createdAt' | 'updatedAt', string>();
  for (const [name, node] of Object.entries(schema)) {
    if (!isEmbedded(node) || !node.systemManaged) continue;
    if (name === 'createdAt') stampColumns.set('createdAt', columnOf(name, node));
    else if (name === 'updatedAt') stampColumns.set('updatedAt', columnOf(name, node));
  }

  const createdColumn = stampColumns.get('createdAt');
  const existing = db
    .prepare(`SELECT ${createdColumn ? `${createdColumn} AS created_at` : '1 AS present'} FROM ${table} WHERE slug = ?`)
    .get(slug) as Record<string, unknown> | undefined;
  const op: 'created' | 'updated' = existing ? 'updated' : 'created';

  if (stampColumns.size) {
    /**
     * The pre-update `createdAt` comes from the FILE first, the row second.
     *
     * This is 0.2.7's rule and it has to hold here too. Reading it off the row
     * alone inverts the direction of flow: on any path that supplies no
     * `opts.stamp` (`VersionService.restore` deliberately withholds one), a row
     * whose `created_at` has drifted from the file would be written back, and
     * `entityStore.persist` then regenerates the FILE from that row — pushing the
     * divergence into the source of truth and stopping `file → index → file` from
     * converging. `resolveStampForUpdate` skips the file read entirely when a
     * stamp IS supplied, which is the whole rebuild path.
     */
    const rowStamp = existing && createdColumn ? { created_at: existing.created_at ?? null } : null;
    const stamp = deps.store
      ? resolveStampForUpdate(module.type, opts, deps.store, slug, rowStamp)
      : resolveStamp(module.type, opts, rowStamp);
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

  const warnings: string[] = [];

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO ${table} (${columns.join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})
       ON CONFLICT(slug) DO UPDATE SET ${assignments}`,
    ).run(...values);

    for (const [name, node] of Object.entries(schema)) {
      if (!hasProjectionTable(node)) continue;
      warnings.push(
        ...syncProjectionTable(db, module, slug, name, node as CollectionNode, payload[name]),
      );
    }

    /**
     * The capture belongs INSIDE the transaction, as it does in every service.
     *
     * `captureEntitySnapshot` deliberately rethrows on failure "so the caller's
     * transaction rolls back and the failure surfaces" (versions.ts). Capturing
     * after the commit broke that contract in one direction only: a throwing
     * capture left the row permanently committed with no `entity_version` row
     * attributing it — a mutation invisible to version history and to the next
     * release diff, and not undoable by re-running the restore.
     *
     * It still runs LAST within the transaction, because it re-reads the entity
     * through `RawEntityReader` and snapshots what it finds; running it first
     * would record the pre-write state.
     */
    if (opts.capture !== false && deps.versions) {
      deps.versions.captureEntitySnapshot(
        module.type,
        slug,
        op === 'created' ? 'create' : 'update',
        actor,
        op === 'created' ? 'Created' : 'Updated',
      );
    }
  });
  tx();

  const entity = { slug, ...payload } as T;
  return warnings.length ? { entity, op, warnings } : { entity, op };
}

/**
 * Delete one entity row and everything projected from it.
 *
 * The counterpart to the write door, and needed for the same reason: without it
 * a serviceless type gained a write door but no delete door, so
 * `ReleaseService.restoreEntity`'s delete branch reported a clean `noop` while
 * the entity survived in the index and on disk — the user told "restored to
 * release X" with the project not matching release X. That is the same silent
 * drop item 6 removed from the create/update half.
 *
 * Projection tables carry `ON DELETE CASCADE` to the parent, so deleting the row
 * takes their rows with it; `entity_tag` does not, and is cleaned explicitly.
 */
export function removeProjectionRow(
  deps: ProjectionWriteDeps,
  module: WritableModule,
  slug: string,
  actor: ChangedBy,
  opts: WriteOpts,
): { deleted: boolean } {
  if (!module.data?.schema) return { deleted: false };
  const { db } = deps;
  const table = mainTableOf(module);

  if (!rowExists(db, table, slug)) return { deleted: false };

  const tx = db.transaction(() => {
    /**
     * Capture BEFORE the row goes, unlike the upsert path. `captureEntitySnapshot`
     * snapshots the entity as it currently is, so a tombstone captured after the
     * delete would have nothing to record — its own doc calls this out.
     */
    if (opts.capture !== false && deps.versions) {
      deps.versions.captureEntitySnapshot(
        module.type,
        slug,
        'delete',
        actor,
        'Deleted',
      );
    }
    db.prepare(`DELETE FROM entity_tag WHERE entity_type = ? AND entity_slug = ?`).run(
      module.type,
      slug,
    );
    db.prepare(`DELETE FROM ${table} WHERE slug = ?`).run(slug);
  });
  tx();

  return { deleted: true };
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
/**
 * Warn about a SCALAR `ref` whose target does not exist.
 *
 * `syncProjectionTable` honours `onMissing: 'warn'` for refs carried by
 * COLLECTION ITEMS, and nothing honoured it for a ref sitting directly on the
 * entity row — `ui-view.designSystemSlug` is the one in this repo. The deleted
 * `uiViewRestore` used to emit that warning by hand, so removing it made a
 * dangling design-system reference completely silent: a rebuild or a release
 * restore reported clean success and the user found out by opening the view.
 *
 * A warning, never a block. The declaration says `onDelete: 'leave-dangling'`,
 * and there is no FK on the column precisely so the value survives its target.
 */
export function danglingScalarRefs(
  db: Database,
  module: WritableModule,
  slug: string,
  payload: unknown,
): string[] {
  const schema = module.data?.schema;
  if (!schema || payload === null || typeof payload !== 'object') return [];
  const input = payload as Record<string, unknown>;

  const warnings: string[] = [];
  for (const [name, node] of Object.entries(schema)) {
    if (node.kind === 'collection' || !node.ref || node.ref === '$type') continue;
    if (node.onMissing !== 'warn') continue;
    const target = input[name];
    if (typeof target !== 'string' || !target) continue;
    if (rowExists(db, typeTablePrefix(node.ref), target)) continue;
    warnings.push(
      `${module.type}/${slug}: ${name} references ${node.ref} '${target}', which does not exist (dangling)`,
    );
  }
  return warnings;
}

/**
 * Sync every projected collection the payload actually carries.
 *
 * Exported for the SERVICE branch of `HostEntityWriter.upsert`, which is the
 * hole tier B PR2 opened. A service like `EndpointService.upsert` writes only
 * its own row; the per-type `restore` slot used to call `syncEndpointDtos`
 * afterwards, and that slot is what this tier deletes. Without this, a boot
 * rebuild writes the endpoint row, leaves `endpoint_dto` empty, and the next
 * `persist` writes the emptied `linkedDtos` back into the entity file — data
 * loss at the source of truth, from a rebuild that reports success.
 *
 * `hasOwnProperty`, not truthiness: a payload that says nothing about a
 * collection must leave it alone, while one that says `[]` must clear it. A
 * partial update (`PATCH` with two fields) is the first case; a restore is the
 * second, and conflating them either loses links or refuses to remove them.
 *
 * NOT called on the projection branch — `upsertProjectionRow` already syncs
 * inside its own transaction, and doing it twice would open a window where the
 * junction is empty.
 */
export function syncProjectionTables(
  db: Database,
  module: WritableModule,
  slug: string,
  payload: unknown,
): string[] {
  const schema = module.data?.schema;
  if (!schema || payload === null || typeof payload !== 'object') return [];
  const input = payload as Record<string, unknown>;

  const warnings: string[] = [];
  const tx = db.transaction(() => {
    for (const [name, node] of Object.entries(schema)) {
      if (!hasProjectionTable(node)) continue;
      if (!Object.prototype.hasOwnProperty.call(input, name)) continue;
      warnings.push(...syncProjectionTable(db, module, slug, name, node as CollectionNode, input[name]));
    }
  });
  tx();
  return warnings;
}

function syncProjectionTable(
  db: Database,
  module: WritableModule,
  slug: string,
  field: string,
  node: CollectionNode,
  value: unknown,
): string[] {
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
  if (!items.length) return [];

  const item = node.item;
  const itemFields: Array<[string, FieldNode]> =
    item.kind === 'object' ? Object.entries(item.fields) : [['value', item]];
  const columns = [binding, ...itemFields.map(([name, n]) => columnOf(name, n))];
  const insert = db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  );

  /**
   * A dangling ref WARNS; it does not abort the write.
   *
   * `projectionTableDDL` gives every `ref` column a real `REFERENCES … ` FK, and
   * `foreign_keys` is ON, so inserting a row whose target no longer exists
   * throws `FOREIGN KEY constraint failed` and rolls back the whole transaction
   * — taking the parent row with it. That directly contradicts the flag the
   * field declares: `onMissing: 'warn'` is documented as "a broken ref never
   * blocks a write", and the per-type code this door replaces collects a warning
   * and keeps going. Without this, restoring a release whose refs point at an
   * entity deleted since capture aborts the entire restore.
   *
   * Only `onMissing: 'warn'` refs are skipped. A ref without that flag keeps the
   * FK's hard failure, which is the type asking for it.
   */
  const warnings: string[] = [];
  const refFields = itemFields.filter(
    ([, n]) => n.ref && n.ref !== '$type' && n.onMissing === 'warn',
  );

  /**
   * Dedup by the declared key BEFORE inserting.
   *
   * The junction carries `UNIQUE(binding, ...keyFields)`, and the per-type
   * `syncEndpointDtos` this door replaced built a `Map` keyed by exactly that
   * tuple, so a payload listing the same link twice collapsed to one row. This
   * did a plain INSERT per item, so the second one threw `UNIQUE constraint
   * failed` out through `restoreEntity` — and the indexer degrades a throwing
   * restore to "skip this entity", rolling back the savepoint. Net effect of one
   * duplicated line in a hand-edited file, or of a git merge of two branches that
   * each added the same link: the endpoint comes back with ZERO links instead of
   * the deduplicated set.
   */
  const keyOf = (row: Record<string, unknown>): string =>
    JSON.stringify((node.keyFields ?? itemFields.map(([n]) => n)).map((k) => row[k] ?? null));
  const seen = new Set<string>();

  for (const entry of items) {
    const row: Record<string, unknown> =
      item.kind === 'object' ? ((entry as Record<string, unknown>) ?? {}) : { value: entry };

    const key = keyOf(row);
    if (seen.has(key)) {
      warnings.push(
        `${module.type}/${slug}: ${field}[] lists ${key} more than once — kept the first`,
      );
      continue;
    }
    seen.add(key);

    /**
     * An item field's `enum` is validated HERE, because `upsertProjectionRow`'s
     * `enumViolation` sweep only walks the parent row's own fields.
     *
     * The declaration types `endpoint.linkedDtos[].relation` as
     * `['request','response','error']`, and until this check the generic door
     * inserted whatever the payload said — so a misspelled `"resposne"` in a file
     * landed in `endpoint_dto`, rendered on the detail page, and was written back
     * into the file as if it were real. The per-type `linkDto` this replaced
     * rejected it.
     *
     * Skipped with a warning rather than thrown, matching the dangling-ref rule
     * directly above: one bad row in a release restore must not abort the entity.
     */
    const badEnum = itemFields.find(([name, n]) => enumViolation(n, row[name]) !== null);
    if (badEnum) {
      const [name, n] = badEnum;
      warnings.push(
        `${module.type}/${slug}: ${field}[].${name} — ${enumViolation(n, row[name])} — row skipped`,
      );
      continue;
    }

    const dangling = refFields.find(([name, n]) => {
      const target = row[name];
      if (typeof target !== 'string' || !target) return false;
      return !rowExists(db, typeTablePrefix(n.ref as string), target);
    });
    if (dangling) {
      const [name, n] = dangling;
      warnings.push(
        `${module.type}/${slug}: ${field}[].${name} references ${n.ref} ` +
          `'${String(row[name])}', which does not exist — row skipped`,
      );
      continue;
    }

    try {
      insert.run(
        slug,
        ...itemFields.map(([name, n]) => {
          const raw = row[name];
          return raw === undefined ? absentValue(n) : encode(n, raw);
        }),
      );
    } catch (err) {
      /**
       * A constraint SQLite enforces that the checks above did not anticipate —
       * a FK on a ref without `onMissing: 'warn'`, a CHECK from `data.integrity`.
       * Degraded to a warning for the same reason as everything else in this
       * loop: escaping here aborts the whole entity, and the indexer turns that
       * into a silent skip that empties the collection rather than preserving it.
       */
      warnings.push(
        `${module.type}/${slug}: ${field}[] row rejected by the database — ${(err as Error).message}`,
      );
    }
  }
  return warnings;
}

/**
 * Does this entity have a projection row?
 *
 * Exported for `HostEntityWriter.syncTags`, which must ask about existence
 * WITHOUT going through the entity-service registry — that registry is exactly
 * what a serviceless type does not appear in.
 */
export function projectionRowExists(
  deps: ProjectionWriteDeps,
  module: WritableModule,
  slug: string,
): boolean {
  if (!module.data?.schema) return false;
  return rowExists(deps.db, mainTableOf(module), slug);
}

/** Does a row with this slug exist in a generated table? Tolerates a missing table. */
function rowExists(db: Database, table: string, slug: string): boolean {
  try {
    return db.prepare(`SELECT 1 FROM ${table} WHERE slug = ?`).get(slug) !== undefined;
  } catch {
    // The referenced type is not projected in this project (deactivated, or a
    // bundle carrying a type this installation never had). Treat as missing
    // rather than throwing — the caller degrades it to a warning.
    return false;
  }
}
