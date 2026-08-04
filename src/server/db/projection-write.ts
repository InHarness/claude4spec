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
  axesOf,
  columnOf,
  hasProjectionTable,
  isEmbedded,
  isKeyed,
  payloadFieldsOf,
  type AxisSpec,
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

  /**
   * `newSlug` renames IN PLACE, and it has to be an UPDATE of the existing row
   * rather than an insert at the new slug (item 23).
   *
   * Every projection table binds to the parent with `ON UPDATE CASCADE`, so an
   * in-place `UPDATE … SET slug = ?` carries the whole collection across in the
   * SAME statement — which is exactly what item 23 asks for and what the six
   * hand-written services already do. Insert-then-delete would not: the new row
   * starts with an empty collection, and the delete then cascades the old rows
   * away, so a rename would silently empty a keyed collection of any size.
   *
   * This is the door a SERVICELESS type renames through. A type with a service
   * never reaches it (`HostEntityWriter` prefers the service, which does its own
   * rename), but a declaratively-authored type — the whole point of Host API
   * 2.0.0, and the likeliest author of a keyed collection — had no rename door
   * at all before this.
   */
  const requested = payload.newSlug;
  const renameTo =
    typeof requested === 'string' && requested.trim() && requested.trim() !== slug
      ? requested.trim()
      : null;
  if (renameTo && !existing) {
    throw new DomainError('NOT_FOUND', `${module.type} '${slug}' not found`);
  }
  if (renameTo && rowExists(db, table, renameTo)) {
    throw new DomainError(
      'SLUG_CONFLICT',
      `${module.type} slug '${renameTo}' already exists`,
    );
  }
  const target = renameTo ?? slug;
  if (renameTo) values[0] = target;

  const tx = db.transaction(() => {
    if (renameTo) {
      db.prepare(`UPDATE ${table} SET slug = ? WHERE slug = ?`).run(renameTo, slug);
      // `entity_tag` has no FK to the entity table, so it does not cascade —
      // the same explicit fix-up every hand-written service makes.
      db.prepare(
        `UPDATE entity_tag SET entity_slug = ? WHERE entity_type = ? AND entity_slug = ?`,
      ).run(renameTo, module.type, slug);
    }

    db.prepare(
      `INSERT INTO ${table} (${columns.join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})
       ON CONFLICT(slug) DO UPDATE SET ${assignments}`,
    ).run(...values);

    for (const [name, node] of Object.entries(schema)) {
      if (!hasProjectionTable(node)) continue;
      /**
       * SILENCE MEANS "LEAVE IT ALONE" for a keyed collection — and means
       * "empty" for a value one. The asymmetry is the whole distinction between
       * the two kinds, and getting it wrong here is not a subtle bug.
       *
       * A value collection IS the field: writing the entity writes all of it, so
       * an absent field is an absent collection and replacing it with `[]` is
       * correct. A keyed collection is addressed by key and read in windows; the
       * payload that carries it is a snapshot or a restore, and an ordinary
       * update never mentions it. Treating that silence as "empty" means every
       * rename, resize or title edit deletes the entire grid — which is exactly
       * what this loop did until a rename test caught it, because the field is
       * missing from the payload in precisely the operations that are NOT about
       * the cells.
       */
      if (isKeyed(node) && !Object.prototype.hasOwnProperty.call(payload, name)) continue;
      warnings.push(
        ...syncProjectionTable(db, module, target, name, node as CollectionNode, payload[name]),
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
        target,
        op === 'created' ? 'create' : 'update',
        actor,
        op === 'created' ? 'Created' : 'Updated',
      );
    }
  });
  tx();

  // `slug` LAST: the payload may still carry `newSlug`, and a caller reading
  // `.slug` off the result must get the slug that was actually written —
  // `HostEntityWriter` syncs projection tables against exactly this value.
  const entity = { ...payload, slug: target } as T;
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
    return reconcileKeyedCollection(db, module, slug, field, node, value);
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

// ─── keyed collections (tier C, items 17–23) ─────────────────────────────────

/**
 * The item's named fields, or the single synthetic `value` column of a scalar
 * item — the same rule `projection-read.ts#itemFieldsOf` reads back with.
 */
function itemFieldEntries(node: CollectionNode): Array<[string, FieldNode]> {
  return node.item.kind === 'object'
    ? Object.entries(node.item.fields)
    : [['value', node.item]];
}

/** The columns forming a keyed item's address, in declared axis order. */
function keyColumnsOf(node: CollectionNode): string[] {
  return (node.keyFields ?? []).map((key) =>
    node.item.kind === 'object' && node.item.fields[key]
      ? columnOf(key, node.item.fields[key] as FieldNode)
      : key,
  );
}

/**
 * SPARSE DISCIPLINE, in one predicate (item 19).
 *
 * "An empty value is not stored; writing an empty value deletes the key; a
 * rebuild skips empties; a snapshot never emits them." All four sentences are
 * the same rule, so they get one implementation — and the coordinates are
 * deliberately excluded from the judgement, because a coordinate is never empty:
 * it is what the key IS. Judging emptiness on the whole item would make cell
 * (3,4) permanently unstorable-as-empty while cell (0,0) vanished, which is not
 * a rule anyone declared.
 *
 * `0` and `false` are NOT empty. Only absence, `null` and the empty string are —
 * a spreadsheet cell holding `0` is a cell holding a number, and deleting it
 * because it looks falsy would lose authored content on every rebuild.
 */
function isEmptyKeyedItem(node: CollectionNode, row: Record<string, unknown>): boolean {
  return payloadFieldsOf(node).every((name) => {
    const value = row[name];
    return value === undefined || value === null || value === '';
  });
}

/**
 * Upsert the non-empty entries and delete the empty ones, in the caller's
 * transaction.
 *
 * The shared core of both keyed write doors. What differs between them is the
 * SCOPE of the operation — a reconcile also removes keys the dump did not
 * mention, a windowed write does not — and that difference is the caller's to
 * apply, not this function's.
 */
function applyKeyedEntries(
  db: Database,
  module: WritableModule,
  slug: string,
  field: string,
  node: CollectionNode,
  rows: ReadonlyArray<Record<string, unknown>>,
): string[] {
  const table = projectionTableOf(module, field, node);
  const binding = bindingColumnOf(module);
  const fields = itemFieldEntries(node);
  const keyColumns = keyColumnsOf(node);
  const columns = [binding, ...fields.map(([name, n]) => columnOf(name, n))];

  const upsert = db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')})
     VALUES (${columns.map(() => '?').join(', ')})
     ON CONFLICT(${[binding, ...keyColumns].join(', ')}) DO UPDATE SET ${columns
       .filter((c) => c !== binding && !keyColumns.includes(c))
       .map((c) => `${c} = excluded.${c}`)
       .join(', ')}`,
  );
  const remove = db.prepare(
    `DELETE FROM ${table} WHERE ${binding} = ? AND ${keyColumns
      .map((c) => `${c} = ?`)
      .join(' AND ')}`,
  );

  const warnings: string[] = [];
  for (const row of rows) {
    const keyValues = (node.keyFields ?? []).map((k) => row[k]);
    if (keyValues.some((v) => v === undefined || v === null)) {
      warnings.push(
        `${module.type}/${slug}: ${field} entry is missing part of its key ` +
          `(${(node.keyFields ?? []).join(', ')}) — skipped`,
      );
      continue;
    }

    if (isEmptyKeyedItem(node, row)) {
      remove.run(slug, ...(keyValues as Array<string | number>));
      continue;
    }

    const badEnum = fields.find(([name, n]) => enumViolation(n, row[name]) !== null);
    if (badEnum) {
      const [name, n] = badEnum;
      warnings.push(
        `${module.type}/${slug}: ${field}.${name} — ${enumViolation(n, row[name])} — entry skipped`,
      );
      continue;
    }

    try {
      upsert.run(
        slug,
        ...fields.map(([name, n]) => {
          const raw = row[name];
          return raw === undefined ? absentValue(n) : encode(n, raw);
        }),
      );
    } catch (err) {
      /**
       * Degraded to a warning for the same reason the value path degrades: an
       * escape here aborts the whole entity, and the indexer turns a throwing
       * restore into "skip this entity" — which empties the collection rather
       * than preserving the rows that were fine.
       */
      warnings.push(
        `${module.type}/${slug}: ${field} entry ${JSON.stringify(keyValues)} rejected by the ` +
          `database — ${(err as Error).message}`,
      );
    }
  }
  return warnings;
}

/**
 * REPLACE-ALL reconciliation — the dump is the whole collection (item 10).
 *
 * The restore/rebuild door. Keys absent from the dump are removed in the SAME
 * atomic operation that upserts the ones present, which is what makes a restore
 * land the collection the snapshot describes rather than the union of it and
 * whatever was there before.
 *
 * Deliberately NOT a `DELETE` followed by re-INSERT of everything, though that
 * would produce the same final rows. Deleting first opens a window inside the
 * transaction where the collection is empty, and the projection table's rows are
 * exactly what a `CHECK` from `data.integrity` and the parent's FK cascade see;
 * reconciling by difference never presents a state the declaration forbids.
 */
export function reconcileKeyedCollection(
  db: Database,
  module: WritableModule,
  slug: string,
  field: string,
  node: CollectionNode,
  value: unknown,
): string[] {
  const table = projectionTableOf(module, field, node);
  const binding = bindingColumnOf(module);
  const keyColumns = keyColumnsOf(node);

  // Absent or non-array means the payload said "no items", which for a
  // replace-all is an instruction to empty the collection — the caller decides
  // whether to call at all (`hasOwnProperty`), and by the time we are here it has.
  const items = Array.isArray(value) ? value : [];
  const rows: Array<Record<string, unknown>> = items.map((entry) =>
    node.item.kind === 'object'
      ? ((entry as Record<string, unknown>) ?? {})
      : { value: entry },
  );

  const kept = new Set(
    rows
      .filter((row) => !isEmptyKeyedItem(node, row))
      .map((row) => JSON.stringify((node.keyFields ?? []).map((k) => row[k] ?? null))),
  );

  const existing = db
    .prepare(`SELECT ${keyColumns.join(', ')} FROM ${table} WHERE ${binding} = ?`)
    .all(slug) as Array<Record<string, unknown>>;

  const remove = db.prepare(
    `DELETE FROM ${table} WHERE ${binding} = ? AND ${keyColumns
      .map((c) => `${c} = ?`)
      .join(' AND ')}`,
  );
  for (const row of existing) {
    const key = JSON.stringify(keyColumns.map((c) => row[c] ?? null));
    if (kept.has(key)) continue;
    remove.run(slug, ...(keyColumns.map((c) => row[c]) as Array<string | number>));
  }

  return applyKeyedEntries(db, module, slug, field, node, rows);
}

/** One entry of a windowed keyed write: the item payload, coordinates included. */
export type KeyedEntry = Record<string, unknown>;

/**
 * The POINT and RANGE write door — a full domain mutation (items 21, 22).
 *
 * MERGE, not replace: only the keys named are touched, which is what lets two
 * writes to disjoint keys not collide. That is the whole difference from
 * `reconcileKeyedCollection` above, and it is why they are two functions rather
 * than one with a flag — the failure mode of picking the wrong one is silent
 * data loss, and a boolean argument at the call site is not a good place for
 * that decision to be visible.
 *
 * Two guarantees the brief names explicitly, both of which fall out of doing the
 * whole thing in ONE transaction with the capture at its close:
 *   - the PARENT's `updatedAt` is stamped, because a cell write is a mutation of
 *     the entity, not of some side table (item 21);
 *   - exactly ONE `entity_version` row per call, whether it carried one key or a
 *     hundred. The trigger is the operation closing — never a time window and
 *     never a change count, both of which were rejected as non-deterministic
 *     (item 22).
 */
export function writeKeyedWindow(
  deps: ProjectionWriteDeps,
  module: WritableModule,
  slug: string,
  field: string,
  entries: readonly KeyedEntry[],
  actor: ChangedBy,
  opts: WriteOpts,
): { warnings: string[] } {
  const { db } = deps;
  const node = requireKeyed(module, field);
  const table = mainTableOf(module);

  if (!rowExists(db, table, slug)) {
    throw new DomainError('NOT_FOUND', `${module.type} '${slug}' not found`);
  }

  const rows: Array<Record<string, unknown>> = entries.map((entry) =>
    node.item.kind === 'object' ? entry : { value: entry },
  );

  const warnings: string[] = [];
  const tx = db.transaction(() => {
    warnings.push(...applyKeyedEntries(db, module, slug, field, node, rows));
    stampParent(deps, module, slug, opts);
    capture(deps, module, slug, actor, opts);
  });
  tx();

  return { warnings };
}

/**
 * Insert or remove one position on an axis, shifting everything past it
 * (item 20).
 *
 * Its own operation rather than a side effect of writing the extent field, and
 * the difference is not cosmetic: writing `nRows = 4` on a 5-row grid says
 * nothing about WHICH row went, so inferring a delete from it would have to pick
 * one — silently dropping the last row's cells on what the caller thought was a
 * metadata edit. An axis operation names the position, so the shift is derivable
 * and the cells that go are the ones the caller asked to remove.
 *
 * "Keys are not a stable identity" is the consequence, and it is why M39 forbids
 * a consumer from caching keys across this call: every coordinate past `at`
 * changes, so a key read before the operation addresses a different item after.
 *
 * One `entity_version` entry, same rule as `writeKeyedWindow`.
 */
export function mutateAxis(
  deps: ProjectionWriteDeps,
  module: WritableModule,
  slug: string,
  field: string,
  axisKey: string,
  op: 'insert' | 'delete',
  at: number,
  actor: ChangedBy,
  opts: WriteOpts,
): { extent: number } {
  const { db } = deps;
  const node = requireKeyed(module, field);
  const axis = axesOf(node).find((a) => a.key === axisKey);
  if (!axis) {
    throw new DomainError(
      'VALIDATION',
      `${module.type}.${field} has no axis '${axisKey}' — declared axes are ` +
        `${axesOf(node).map((a) => a.key).join(', ') || 'none'}`,
    );
  }
  if (!Number.isInteger(at) || at < 1) {
    throw new DomainError('VALIDATION', `axis position must be an integer >= 1, got ${at}`);
  }

  const table = mainTableOf(module);
  const collectionTable = projectionTableOf(module, field, node);
  const binding = bindingColumnOf(module);
  const axisColumn = keyColumnAt(node, axis);
  const extentColumn = extentColumnOf(module, axis);

  const parent = db.prepare(`SELECT ${extentColumn} AS extent FROM ${table} WHERE slug = ?`).get(slug) as
    | { extent: number | null }
    | undefined;
  if (!parent) throw new DomainError('NOT_FOUND', `${module.type} '${slug}' not found`);

  const before = Number(parent.extent ?? 0);
  const after = op === 'insert' ? before + 1 : Math.max(0, before - 1);

  /**
   * Shift THROUGH negative coordinates, in two statements, never in one.
   *
   * `UNIQUE(binding, ...keyColumns)` is checked per row as SQLite applies an
   * UPDATE, so a bare `SET r = r + 1 WHERE r >= at` collides the moment it moves
   * row 3 onto an occupied row 4 — on any grid dense enough to have two adjacent
   * occupied positions, which is most of them. `ORDER BY … DESC` is the textbook
   * answer and is NOT available: this SQLite is built without
   * `SQLITE_ENABLE_UPDATE_DELETE_LIMIT`, so it rejects `ORDER BY without LIMIT
   * on UPDATE`.
   *
   * Parking the moved rows on negative coordinates sidesteps the ordering
   * question entirely: no positive coordinate can collide with a negative one,
   * so the first statement never conflicts, and the second brings them back into
   * a range the first statement has already vacated.
   */
  const shift = (delta: number, predicate: string, param: number): void => {
    db.prepare(
      `UPDATE ${collectionTable} SET ${axisColumn} = -(${axisColumn} + ${delta}) ` +
        `WHERE ${binding} = ? AND ${axisColumn} ${predicate} ?`,
    ).run(slug, param);
    db.prepare(
      `UPDATE ${collectionTable} SET ${axisColumn} = -${axisColumn} ` +
        `WHERE ${binding} = ? AND ${axisColumn} < 0`,
    ).run(slug);
  };

  const tx = db.transaction(() => {
    if (op === 'delete') {
      // The removed position's items go FIRST. Shifting them into `at - 1`
      // instead would overwrite whatever already lives there.
      db.prepare(
        `DELETE FROM ${collectionTable} WHERE ${binding} = ? AND ${axisColumn} = ?`,
      ).run(slug, at);
      shift(-1, '>', at);
    } else {
      shift(+1, '>=', at);
    }

    db.prepare(`UPDATE ${table} SET ${extentColumn} = ? WHERE slug = ?`).run(after, slug);
    stampParent(deps, module, slug, opts);
    capture(deps, module, slug, actor, opts);
  });
  tx();

  return { extent: after };
}

/** The declared keyed collection behind a field name, or a loud error. */
function requireKeyed(module: WritableModule, field: string): CollectionNode {
  const node = module.data?.schema?.[field];
  if (!node || node.kind !== 'collection' || node.collection !== 'keyed') {
    throw new DomainError(
      'VALIDATION',
      `${module.type}.${field} is not a keyed collection`,
    );
  }
  return node;
}

/** The projection column carrying an axis's coordinate. */
function keyColumnAt(node: CollectionNode, axis: AxisSpec): string {
  return node.item.kind === 'object' && node.item.fields[axis.key]
    ? columnOf(axis.key, node.item.fields[axis.key] as FieldNode)
    : axis.key;
}

/** The parent column carrying an axis's length. */
function extentColumnOf(module: WritableModule, axis: AxisSpec): string {
  const node = module.data?.schema?.[axis.extent];
  return node ? columnOf(axis.extent, node) : axis.extent;
}

/**
 * Stamp the parent's `updatedAt` for a mutation that did not go through
 * `upsertProjectionRow`.
 *
 * A keyed write changes the entity, so the entity's timestamp has to move —
 * otherwise `file → index → file` writes a file whose `updatedAt` predates its
 * own content, and every consumer that sorts by recency (the sidebar, the
 * release diff) reports the entity as untouched.
 *
 * Only `updatedAt`: `createdAt` is settled by whatever created the row, and
 * re-deriving it here would let a cell write rewrite the entity's birth date.
 */
function stampParent(
  deps: ProjectionWriteDeps,
  module: WritableModule,
  slug: string,
  opts: WriteOpts,
): void {
  const schema = module.data?.schema ?? {};
  const entry = Object.entries(schema).find(
    ([name, node]) => name === 'updatedAt' && isEmbedded(node) && node.systemManaged,
  );
  if (!entry) return;
  const column = columnOf(entry[0], entry[1]);
  const stamp = resolveStamp(module.type, opts, null);
  deps.db.prepare(`UPDATE ${mainTableOf(module)} SET ${column} = ? WHERE slug = ?`).run(
    stamp.updatedAt,
    slug,
  );
}

/** One capture per operation — see `writeKeyedWindow`'s note on item 22. */
function capture(
  deps: ProjectionWriteDeps,
  module: WritableModule,
  slug: string,
  actor: ChangedBy,
  opts: WriteOpts,
): void {
  if (opts.capture === false || !deps.versions) return;
  deps.versions.captureEntitySnapshot(module.type, slug, 'update', actor, 'Updated');
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
