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

import type { Database, Statement } from 'better-sqlite3';
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

    /**
     * `required` means "the column may not hold NULL", and a declared default
     * satisfies that without the payload carrying anything.
     *
     * 0.2.9 item 27 — the check used to fire on any absent `required` field,
     * defaults included, which put it at odds with the two descriptions on
     * either side of it: `isNotNull` counts `default`/`computedDefault` as
     * satisfying NOT NULL, and `valueFor`/`absentValue` on the very next line
     * fills the value in. `diagram.source` is `required: true, default: ''`, so
     * a create omitting it passed the generated input schema (which reads the
     * same three flags) and was then rejected here — the schema and the only
     * write door it feeds disagreeing about the same declaration.
     *
     * An EXPLICIT `null` is still a violation for a required field, since that
     * is the caller asking for the one value the column cannot hold.
     */
    const fillable = node.default !== undefined || node.computedDefault !== undefined;
    if (node.required && (raw === null || (raw === undefined && !fillable))) {
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
   * `newSlug` is REFUSED here, and belongs to `renameProjectionRow` instead.
   *
   * An earlier revision of this tier handled it inline, and a review found what
   * that costs. This function is a FULL-REPLACE door: every declared column is
   * named unconditionally, so a field the payload omits is written back as its
   * default. That is correct for the payloads it exists to serve (a restore, a
   * rebuild — both complete), and catastrophic for a rename, which is inherently
   * partial: `{ name, newSlug }` renamed the row and reset `nRows`/`nCols` to 0,
   * so the grid reported itself as 0×0 while its cells sat untouched in the
   * table, and every window came back empty.
   *
   * Refused rather than ignored. A caller that passes `newSlug` believes it is
   * renaming; silently dropping it would leave them with an un-renamed entity
   * and no error, which is the failure this one is meant to replace.
   */
  if (typeof payload.newSlug === 'string' && payload.newSlug.trim() && payload.newSlug.trim() !== slug) {
    throw new DomainError(
      'VALIDATION',
      `${module.type}/${slug}: this door replaces every declared field, so it cannot carry a ` +
        `rename — a partial payload would reset the fields it does not mention. Call ` +
        `renameProjectionRow(…) instead`,
    );
  }
  const target = slug;

  const tx = db.transaction(() => {
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
     * After the parent row is written, so it reads the extents the caller just
     * set — and inside this transaction, so a shrink and its pruning commit
     * together or not at all.
     *
     * The `continue` above is what makes this necessary. Skipping a keyed
     * collection the payload does not mention is correct (silence is not
     * "empty"), but it means a SHRINK — a write to `nRows` alone — leaves the
     * cells beyond the new extent behind.
     */
    pruneBeyondExtents(db, module, target);

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
 * Move an entity to a new slug, and NOTHING else (item 23).
 *
 * Its own operation rather than a flag on the upsert, because the upsert is a
 * full-replace door: a rename payload is partial by nature, and running it
 * through a door that names every column writes the omitted ones back as their
 * defaults. That is how an earlier revision renamed a grid and reset its
 * dimensions to 0×0 in the same statement.
 *
 * The rename is an in-place `UPDATE … SET slug = ?`, which is what carries a
 * keyed collection across: every projection table binds to the parent with
 * `ON UPDATE CASCADE`, so the rows follow in the same statement. Insert-then-
 * delete would not — the new row would start empty and the delete would cascade
 * the old rows away.
 *
 * This is the door a SERVICELESS type renames through. A type with a service
 * never reaches it (`HostEntityWriter` prefers the service, which does its own
 * rename), but a declaratively-authored type — the point of Host API 2.0.0, and
 * the likeliest author of a keyed collection — had none at all.
 */
export function renameProjectionRow(
  deps: ProjectionWriteDeps,
  module: WritableModule,
  slug: string,
  newSlug: string,
  actor: ChangedBy,
  opts: WriteOpts,
): { renamed: boolean } {
  if (!module.data?.schema) {
    throw new DomainError('VALIDATION', `type '${module.type}' declares no data.schema`);
  }
  const { db } = deps;
  const table = mainTableOf(module);
  const to = newSlug.trim();

  if (!to) throw new DomainError('VALIDATION', 'newSlug resolves to empty');
  if (to === slug) return { renamed: false };
  if (!rowExists(db, table, slug)) {
    throw new DomainError('NOT_FOUND', `${module.type} '${slug}' not found`);
  }
  if (rowExists(db, table, to)) {
    throw new DomainError('SLUG_CONFLICT', `${module.type} slug '${to}' already exists`);
  }

  const tx = db.transaction(() => {
    try {
      db.prepare(`UPDATE ${table} SET slug = ? WHERE slug = ?`).run(to, slug);
    } catch (err) {
      /**
       * A declared `fk` from ANOTHER type lands as a plain
       * `FOREIGN KEY (col) REFERENCES <table>(slug)` with no `ON UPDATE
       * CASCADE` (see `projection.ts`), so renaming a row something else
       * references raises a bare SqliteError — which the HTTP layer reports as
       * `500 INTERNAL: FOREIGN KEY constraint failed`. That is a refusal, not a
       * server fault, and it has to read as one.
       */
      const message = (err as Error).message ?? '';
      if (/FOREIGN KEY constraint failed/i.test(message)) {
        throw new DomainError(
          'SLUG_CONFLICT',
          `${module.type} '${slug}' cannot be renamed: another entity references it through a ` +
            `declared foreign key. Repoint or remove those references first`,
        );
      }
      throw err;
    }
    // `entity_tag` carries no FK to the entity table, so it does not cascade —
    // the same explicit fix-up every hand-written service makes.
    db.prepare(
      `UPDATE entity_tag SET entity_slug = ? WHERE entity_type = ? AND entity_slug = ?`,
    ).run(to, module.type, slug);

    stampParent(deps, module, to, opts);
    capture(deps, module, to, actor, opts);
  });
  tx();

  return { renamed: true };
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
 * Walk one declared subtree, reporting every `onMissing: 'warn'` ref that does
 * not resolve.
 *
 * Deliberately the SAME recursion `ref-rewrite`'s `rewriteValue` performs for
 * renames, and that symmetry is the argument for it: a ref the rename path can
 * repoint is a ref the warning path must be able to report, or the two layers
 * disagree about what a reference is.
 *
 * A ref node is a scalar, so there is nothing below it to descend into — the
 * early return after reporting is not an optimisation.
 */
function walkRefs(
  db: Database,
  node: FieldNode,
  value: unknown,
  path: string,
  out: string[],
  siblingType?: unknown,
): void {
  if (node.ref && node.onMissing === 'warn') {
    const target = node.ref === '$type' ? String(siblingType ?? '') : node.ref;
    if (!target || typeof value !== 'string' || !value) return;
    if (rowExists(db, typeTablePrefix(target), value)) return;
    out.push(`${path} references ${target} '${value}', which does not exist (dangling)`);
    return;
  }

  if (node.kind === 'collection') {
    if (!Array.isArray(value)) return;
    value.forEach((item, i) => walkRefs(db, node.item, item, `${path}[${i}]`, out, siblingType));
    return;
  }

  if (node.kind === 'record') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walkRefs(db, node.value, v, `${path}.${k}`, out, siblingType);
    }
    return;
  }

  if (node.kind === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    // This object's own `type` field, if any, discriminates every `$type` ref
    // below it — the same rule `rewriteValue` applies.
    const nested = 'type' in record ? record.type : siblingType;
    for (const [name, child] of Object.entries(node.fields)) {
      walkRefs(db, child, record[name], `${path}.${name}`, out, nested);
    }
  }
}

/**
 * Warn about a `ref` whose target does not exist — ANYWHERE the declaration
 * puts one that a projection table is not already answering for.
 *
 * This was scalar-and-top-level-only, and `syncProjectionTable` covered the
 * direct fields of a TABLE-BACKED collection's item. Between them sat a hole the
 * width of every embedded container: `database-table.columns[].fk.table` is a
 * ref inside an object inside an embedded value collection, and neither path
 * could see it — the reference dangled and every write reported clean. The
 * declaration said `ref` + `onMissing: 'warn'` and the host silently did
 * nothing with it, which is the failure mode the flag screening in
 * `data-schema-validation` exists to prevent everywhere else.
 *
 * A warning, never a block. The declaration says `onDelete: 'leave-dangling'`,
 * and an embedded ref has no FK to enforce precisely so the value survives its
 * target.
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
    /**
     * A table-backed collection is `syncProjectionTable`'s to report, and it
     * both warns AND drops the offending row. Walking it here too would
     * double-report and then contradict itself.
     */
    if (hasProjectionTable(node)) continue;
    walkRefs(db, node, input[name], `${module.type}/${slug}: ${name}`, warnings);
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
    pruneBeyondExtents(db, module, slug);
  });
  tx();
  return warnings;
}

/**
 * Drop keyed rows sitting past their axis's declared extent.
 *
 * UNCONDITIONAL, on every entity write, because "past the extent" is already
 * invalid everywhere else in the host and the projection was the one place that
 * disagreed. `writeKeyedWindow` refuses such a coordinate; `mutateAxis` refuses
 * such a position; `collectionOverview` reports the grid FROM the extents, so a
 * row beyond them is unreadable by construction. Leaving it in the table made
 * the projection the only component that believed it existed.
 *
 * Runs on EVERY entity write, for every keyed collection, whether or not the
 * payload mentioned the collection — because the case that needs it is exactly
 * the one where it did not. Shrinking a grid is a write to `nRows` alone;
 * `syncProjectionTables` skips a field the payload omits, so the cells beyond
 * the new extent stayed in the table. They were invisible — `overview` reports
 * from the extent columns and `collectionWindow` is bounded by the caller's
 * rectangle — right up until someone grew the axis back, at which point content
 * the user had deleted reappeared. Worse, the snapshot reads the projection, so
 * those rows were also being written into the entity file, which is the source
 * of truth: the deletion did not survive a round trip.
 *
 * v1 got this for free by densifying `1..nRows × 1..nCols` in its own snapshot
 * and letting anything outside fall off the end. The generated snapshot has no
 * reason to know about extents, so the rule moves to where the extents live.
 *
 * Deleting is safe precisely because it is unreachable data: no read can address
 * a coordinate past the extent, and no write can create one — the write door
 * refuses it. This only ever removes rows a previous shrink orphaned.
 */
function pruneBeyondExtents(db: Database, module: WritableModule, slug: string): void {
  const schema = module.data?.schema;
  if (!schema) return;
  const binding = bindingColumnOf(module);

  for (const [field, node] of Object.entries(schema)) {
    if (node.kind !== 'collection' || !isKeyed(node)) continue;
    const collection = node as CollectionNode;
    const axes = axesOf(collection);
    if (!axes.length) continue;

    const table = projectionTableOf(module, field, collection);

    const extents = db
      .prepare(
        `SELECT ${axes.map((a, i) => `${extentColumnOf(module, a)} AS e${i}`).join(', ')} ` +
          `FROM ${mainTableOf(module)} WHERE slug = ?`,
      )
      .get(slug) as Record<string, unknown> | undefined;
    if (!extents) continue;

    for (const [i, axis] of axes.entries()) {
      const raw = extents[`e${i}`];
      const extent = Number(raw);
      // A non-numeric or negative extent is not authority to empty the
      // collection — that is a broken declaration, not a shrink.
      if (raw == null || !Number.isFinite(extent) || extent < 0) continue;
      const column = keyColumnAt(collection, axis);
      db.prepare(`DELETE FROM ${table} WHERE ${binding} = ? AND ${column} > ?`).run(slug, extent);
    }
  }
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
/**
 * The coordinate a key field carries, or `null` when it is not a usable one.
 *
 * A coordinate must be a positive integer, and that is enforced on the WRITE
 * side rather than trusted, for a reason specific to this tier: `mutateAxis`
 * shifts rows by parking them on NEGATIVE coordinates, which is only collision-
 * free while no real row is negative. One stored `row: -1` — a client bug, a
 * hand-edited file, a restore from elsewhere — turns every later axis insert or
 * delete on that entity into a permanent `UNIQUE constraint failed`, and the
 * 1-based window read can never address the offending cell to remove it.
 *
 * Numeric strings are accepted and NORMALIZED. A coordinate arriving as `"3"`
 * (a CSV import, a hand edit, a JSON round trip through a lax writer) is the
 * same cell as `3`, and returning the number here is what keeps the reconcile
 * pass comparing like with like against the INTEGER column it reads back.
 */
function coordinateOf(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * The normalized key tuple of one entry, or `null` when any coordinate is
 * unusable. Shared by the reconcile pass and the apply pass so the two cannot
 * disagree about which stored row an entry refers to.
 */
function keyTupleOf(node: CollectionNode, row: Record<string, unknown>): number[] | null {
  const out: number[] = [];
  for (const name of node.keyFields ?? []) {
    const coordinate = coordinateOf(row[name]);
    if (coordinate === null) return null;
    out.push(coordinate);
  }
  return out.length ? out : null;
}

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
  const payloadColumns = fields.filter(([name]) => !(node.keyFields ?? []).includes(name));

  const remove = db.prepare(
    `DELETE FROM ${table} WHERE ${binding} = ? AND ${keyColumns
      .map((c) => `${c} = ?`)
      .join(' AND ')}`,
  );

  /**
   * One prepared upsert PER SET OF CARRIED FIELDS, not one for the whole call.
   *
   * A windowed write is documented as a merge, and an earlier revision merged
   * only at KEY granularity: it named every item column unconditionally and
   * bound `absentValue` for the ones the entry omitted, so updating a cell's
   * `value` silently nulled its `note`. Naming only the columns the entry
   * actually carries makes the merge hold at FIELD granularity too — an omitted
   * field keeps whatever is stored.
   *
   * Cached by column set because a payload is overwhelmingly homogeneous (every
   * cell of a grid carries the same fields), so this is one prepare in practice.
   */
  const upserts = new Map<string, Statement<Array<string | number | null>>>();
  const upsertFor = (carried: Array<[string, FieldNode]>) => {
    const cols = [binding, ...keyColumns, ...carried.map(([name, n]) => columnOf(name, n))];
    const cacheKey = cols.join(',');
    const cached = upserts.get(cacheKey);
    if (cached) return cached;
    {
      const assignments = carried.map(([name, n]) => {
        const column = columnOf(name, n);
        return `${column} = excluded.${column}`;
      });
      const statement = db.prepare<Array<string | number | null>>(
        `INSERT INTO ${table} (${cols.join(', ')})
         VALUES (${cols.map(() => '?').join(', ')})
         ON CONFLICT(${[binding, ...keyColumns].join(', ')}) DO ${
           /**
            * `DO NOTHING` when the entry carries no payload field at all.
            * Emitting `DO UPDATE SET ` with an empty assignment list is a raw
            * SQL syntax error thrown by `prepare`, before a single row is
            * looked at — which would abort the whole entity's transaction with
            * an opaque database message.
            */
           assignments.length ? `UPDATE SET ${assignments.join(', ')}` : 'NOTHING'
         }`,
      );
      upserts.set(cacheKey, statement);
      return statement;
    }
  };

  /**
   * Does the STORED row still hold content in fields this entry did not name?
   *
   * Only asked when an entry looks empty, so it costs one point SELECT on the
   * clearing path and nothing at all on the ordinary one. Cached by column set
   * for the same reason the upserts are: a payload is homogeneous.
   */
  const probes = new Map<string, Statement<Array<string | number | null>>>();
  const storedHasContent = (
    slug: string,
    key: ReadonlyArray<string | number>,
    omitted: Array<[string, FieldNode]>,
  ): boolean => {
    if (!omitted.length) return false;
    const cols = omitted.map(([name, n]) => columnOf(name, n));
    const cacheKey = cols.join(',');
    let probe = probes.get(cacheKey);
    if (!probe) {
      probe = db.prepare<Array<string | number | null>>(
        `SELECT ${cols.join(', ')} FROM ${table} WHERE ${binding} = ? AND ${keyColumns
          .map((c) => `${c} = ?`)
          .join(' AND ')}`,
      );
      probes.set(cacheKey, probe);
    }
    const stored = probe.get(slug, ...key) as Record<string, unknown> | undefined;
    if (!stored) return false;
    // Same rule as `isEmptyKeyedItem`: `0` and `false` are content.
    return cols.some((c) => stored[c] !== undefined && stored[c] !== null && stored[c] !== '');
  };

  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const key = keyTupleOf(node, row);
    if (!key) {
      warnings.push(
        `${module.type}/${slug}: ${field} entry has an unusable key ` +
          `(${(node.keyFields ?? []).join(', ')} must each be an integer >= 1, got ` +
          `${JSON.stringify((node.keyFields ?? []).map((k) => row[k]))}) — skipped`,
      );
      continue;
    }

    /**
     * FIRST ENTRY WINS, with a warning — the same rule the value path applies,
     * and it has to be the same one. Last-wins let a duplicated line whose
     * second copy is empty delete the content the first copy wrote: the
     * reconcile pass keeps the key (it IS in the dump) and then the apply pass
     * removes it, so a git merge that duplicated one row silently emptied a
     * cell with nothing logged.
     */
    const dedupe = JSON.stringify(key);
    if (seen.has(dedupe)) {
      warnings.push(
        `${module.type}/${slug}: ${field} lists ${dedupe} more than once — kept the first`,
      );
      continue;
    }
    seen.add(dedupe);

    /**
     * Both arms are inside the try, and that is a fix rather than tidiness. The
     * delete used to sit outside it while binding RAW payload values, so a
     * coordinate SQLite cannot bind threw straight out of the caller's
     * transaction — and the indexer turns a throwing restore into "skip this
     * entity", emptying the collection. The identical value in a non-empty cell
     * was caught and warned, so the safe and unsafe paths were inverted.
     */
    try {
      if (isEmptyKeyedItem(node, row)) {
        /**
         * Emptiness is judged on the MERGED item, not on the entry alone.
         *
         * The upsert below merges at FIELD granularity — an omitted field keeps
         * whatever is stored — and the delete has to agree with it, or the two
         * halves of one write disagree about what the entry said. They did:
         * clearing a cell's `value` while leaving its `note` alone sent
         * `{r, c, value: ''}`, whose OMITTED `note` read as empty, so the whole
         * row was deleted and the note the caller never mentioned went with it.
         *
         * An entry carrying NO payload field at all is still a plain deletion —
         * "remove this key" needs a spelling, and naming every field of a wide
         * item just to clear it is not one.
         */
        const omitted = payloadColumns.filter(
          ([name]) => !Object.prototype.hasOwnProperty.call(row, name),
        );
        if (omitted.length < payloadColumns.length && storedHasContent(slug, key, omitted)) {
          // Fall through: clear the fields the entry named, keep the rest.
        } else {
          remove.run(slug, ...key);
          continue;
        }
      }

      const carried = payloadColumns.filter(([name]) =>
        Object.prototype.hasOwnProperty.call(row, name),
      );

      const badEnum = carried.find(([name, n]) => enumViolation(n, row[name]) !== null);
      if (badEnum) {
        const [name, n] = badEnum;
        warnings.push(
          `${module.type}/${slug}: ${field}.${name} — ${enumViolation(n, row[name])} — entry skipped`,
        );
        continue;
      }

      /**
       * ONE spread, after the positional `slug`. better-sqlite3's `run` is typed
       * with a leading parameter plus a rest, so neither a fully-spread array
       * nor two consecutive spreads type-check against it.
       */
      const rest: Array<string | number | null> = [
        ...key,
        ...carried.map(([name, n]) => encode(n, row[name])),
      ];
      upsertFor(carried).run(slug, ...rest);
    } catch (err) {
      /**
       * Degraded to a warning for the same reason the value path degrades: an
       * escape here aborts the whole entity, and the indexer turns a throwing
       * restore into "skip this entity" — which empties the collection rather
       * than preserving the rows that were fine.
       */
      warnings.push(
        `${module.type}/${slug}: ${field} entry ${JSON.stringify(key)} rejected by the ` +
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

  /**
   * A PRESENT but non-array value is REFUSED, not read as empty.
   *
   * The tier-C placeholder this replaced threw `VALIDATION` on every keyed
   * write, and quietly widening that into `Array.isArray(value) ? value : []`
   * lost the one guarantee it was carrying: `cells: null` in a file — a hand
   * edit, a lax writer, a payload upgrade that dropped the branch — became "empty
   * the collection", the reindex deleted every stored cell, and the next
   * `persist` wrote the emptied grid back into the source of truth. A whole
   * spreadsheet, lost by a rebuild that reported success.
   *
   * `undefined` never reaches here: both callers check `hasOwnProperty` first,
   * because for a keyed collection silence means "leave it alone".
   */
  if (!Array.isArray(value)) {
    throw new DomainError(
      'VALIDATION',
      `${module.type}/${slug}: ${field} is a keyed collection, so it must be a list of items — ` +
        `got ${value === null ? 'null' : typeof value}. Omit the field entirely to leave the ` +
        `collection untouched`,
    );
  }
  const items = value;
  const rows: Array<Record<string, unknown>> = items.map((entry) =>
    node.item.kind === 'object'
      ? ((entry as Record<string, unknown>) ?? {})
      : { value: entry },
  );

  /**
   * Both sides of this comparison are NORMALIZED through `keyTupleOf`.
   *
   * `existing` comes back from SQLite as INTEGER columns while the payload may
   * carry `"3"` (a CSV import, a hand edit, a JSON round trip through a lax
   * writer). Comparing raw payload values against decoded column values made
   * `"3" !== 3`, so the delete pass removed a stored cell that the dump plainly
   * still contained — and if the re-insert was then skipped (an enum violation
   * on a sibling field, a database rejection degraded to a warning), the cell
   * was gone, from a rebuild that reported only a warning.
   */
  const kept = new Set(
    rows
      .filter((row) => !isEmptyKeyedItem(node, row))
      .map((row) => JSON.stringify(keyTupleOf(node, row)))
      .filter((key) => key !== 'null'),
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
    const key = JSON.stringify(keyColumns.map((c) => Number(row[c])));
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
): { applied: boolean } {
  const { db } = deps;
  const node = requireKeyed(module, field);
  const table = mainTableOf(module);

  /**
   * Checked rather than trusted, because this is a PLUGIN-facing door and the
   * published `MountContext.crud` is typed `any` — the `readonly KeyedEntry[]`
   * above narrows nothing outside the host. A plugin route forwarding a JSON
   * body reaches straight here, and without this the failure was
   * `TypeError: entries.map is not a function`, which the error middleware has
   * no case for and renders as a 500.
   */
  if (!Array.isArray(entries)) {
    throw new DomainError(
      'VALIDATION',
      `${module.type}.${field}: expected an array of entries, got ${
        entries === null ? 'null' : typeof entries
      } — a single entry must still be wrapped in one`,
    );
  }

  if (!rowExists(db, table, slug)) {
    throw new DomainError('NOT_FOUND', `${module.type} '${slug}' not found`);
  }

  /**
   * Nothing to write is not a mutation. A grid editor flushing a dirty-cell
   * batch on a timer or on blur calls this with an empty window routinely, and
   * running the body anyway stamped `updatedAt`, captured an `entity_version`
   * row carrying a copy of the WHOLE grid, and rewrote the entity file — so an
   * entity nobody edited climbed the recency order and its version history
   * filled with identical entries. The field is still validated above: an empty
   * write to a field that is not a keyed collection is still an error.
   */
  if (entries.length === 0) return { applied: false };

  const rows: Array<Record<string, unknown>> = entries.map((entry) =>
    node.item.kind === 'object' ? entry : { value: entry },
  );

  requireWithinExtents(db, module, slug, field, node, rows);

  const tx = db.transaction(() => {
    const warnings = applyKeyedEntries(db, module, slug, field, node, rows);
    /**
     * A partial write is a FAILED write here, and this is the one place the two
     * keyed doors deliberately diverge.
     *
     * `reconcileKeyedCollection` degrades a bad entry to a warning because it
     * runs on the restore path, where throwing means the indexer skips the
     * entity and empties the collection — a warning genuinely is the lesser
     * loss. This door has nothing to protect: its caller is a live write with a
     * user behind it. Returning `{ slug, warnings }` there reads as success to
     * every caller that does not inspect an optional field — `create`/`update`
     * use the same field for non-fatal notes — so a rejected cell was reported
     * as saved while the entity was stamped, versioned and rewritten around a
     * value that never landed. Throwing rolls the transaction back instead, so
     * the request is applied whole or not at all.
     */
    if (warnings.length) {
      throw new DomainError(
        'VALIDATION',
        `${module.type}/${slug}: ${field} write rejected — ${warnings.join('; ')}`,
      );
    }
    stampParent(deps, module, slug, opts);
    capture(deps, module, slug, actor, opts);
  });
  tx();

  return { applied: true };
}

/**
 * Refuse a coordinate past the axis's declared extent (item 20's other half).
 *
 * The extent lives on the PARENT and is never `MAX(coordinate)`, so a cell
 * written outside it is not merely untidy — it is unreachable. `overview`
 * reports the grid from the extent columns, every window read is bounded by
 * what overview said, and `mutateAxis` refuses a position past the extent, so
 * the cell cannot even be deleted by the operation that would shift it. It sits
 * in the projection and in the entity file, invisible, until some later axis
 * insert silently moves it.
 *
 * Growing the extent instead was the alternative and is wrong: resize and axis
 * insert are their OWN operations precisely because "make room" is a decision
 * about the grid, not a side effect of typing in a cell.
 */
function requireWithinExtents(
  db: Database,
  module: WritableModule,
  slug: string,
  field: string,
  node: CollectionNode,
  rows: ReadonlyArray<Record<string, unknown>>,
): void {
  const axes = axesOf(node);
  const columns = axes.map((axis, i) => `${extentColumnOf(module, axis)} AS e${i}`).join(', ');
  const parent = db
    .prepare(`SELECT ${columns} FROM ${mainTableOf(module)} WHERE slug = ?`)
    .get(slug) as Record<string, number | null> | undefined;

  axes.forEach((axis, i) => {
    const extent = Number(parent?.[`e${i}`] ?? 0);
    for (const row of rows) {
      const at = row[axis.key];
      // A coordinate that is not a positive integer is `applyKeyedEntries`'s to
      // report — it names the whole key tuple, which is the more useful message.
      if (typeof at !== 'number' || !Number.isInteger(at) || at < 1 || at <= extent) continue;
      throw new DomainError(
        'VALIDATION',
        `${module.type}/${slug}: ${field} coordinate ${axis.key}=${at} is past the ` +
          `declared extent (${axis.extent} = ${extent}) — grow the axis first ` +
          `(insert a position, or write the extent), then write the cell`,
      );
    }
  });
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
  /**
   * Checked, not trusted — for the same reason `at` and `axisKey` are, and with
   * a worse failure than either. The bounds and the extent below read `op ===
   * 'insert'` while the body reads `op === 'delete'`, so an out-of-vocabulary
   * value (`'remove'`, `'del'`, anything a plugin's HTTP body carries) took the
   * INSERT arm while computing the DECREMENT extent: nothing was removed,
   * everything past the position was pushed down, and the parent then reported
   * one position fewer than the cells actually occupy — the exact unreachable
   * state the bound check below exists to prevent. The union in `CrudFacade`
   * narrows nothing here: `MountContext.crud` is published as `any`.
   */
  if (op !== 'insert' && op !== 'delete') {
    throw new DomainError(
      'VALIDATION',
      `axis operation must be 'insert' or 'delete', got ${JSON.stringify(op)}`,
    );
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

  /**
   * `at` is bounded against the CURRENT extent, and the bound differs by
   * operation: you may insert at `before + 1` (appending a position past the
   * last one is meaningful) but you may only delete a position that exists.
   *
   * Without this the extent moved anyway. `delete` at position 99 of a 3-row
   * grid matched no rows to remove and none to shift, yet still wrote
   * `extent = 2` — so the last row's cells fell outside the reported dimensions,
   * `overview` under-reported the grid, and a consumer windowing to the stated
   * height silently never saw them again.
   */
  const max = op === 'insert' ? before + 1 : before;
  if (at > max) {
    throw new DomainError(
      'VALIDATION',
      `cannot ${op} at position ${at}: the ${axis.key} axis of ${module.type}/${slug} has ` +
        `${before} position${before === 1 ? '' : 's'}, so the highest ${op} position is ${max}`,
    );
  }

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
