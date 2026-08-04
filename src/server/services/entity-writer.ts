/**
 * Concrete EntityWriter implementation for M17 restore (Phase 6).
 *
 * Constructed per-restore-request by ReleaseService — looks up entity services +
 * tag/junction services from the plugin host. Each write goes through the normal
 * service API so the mutation is captured into `entity_version` with
 * `release_id = NULL` (append-only — decyzja 7).
 *
 * Idempotent UPSERT semantics (decyzja 11): no `--force` flag, no destructive
 * operations on history. The append-only safety net makes accidental overwrites
 * cofalne by another restore.
 *
 * 0.2.2: this file no longer imports a single entity service CLASS. Every write
 * resolves through `host.getEntityService(type)` and is driven by shape against
 * the `UpsertCapable` facade. That is what the Single Abstraction Rule test
 * `grep -rn "import .*Service.*from '.*(entities|plugins)/" src/` (→ 0 outside
 * `entities/` and `plugins/*(/src/`) enforces, and it is what gives a
 * plugin-contributed type the same write door as a built-in one.
 */

import type { ChangedBy } from '../../shared/entities.js';
import type { EntityWriter, UpsertResult } from '../serialization/writer.js';
import type { SystemStamp } from '../serialization/system-fields.js';
import type { PluginHost, WriteOpts } from '../core/plugin-host/types.js';
import type { RawEntityType } from '../discovery/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import {
  projectionRowExists,
  removeProjectionRow,
  syncProjectionTables,
  upsertProjectionRow,
  type ProjectionWriteDeps,
} from '../db/projection-write.js';


/**
 * The raw shape a concrete service's `upsert` returns.
 *
 * Historically each service named its payload after its own type (`.dto`,
 * `.uiView`, `.dbTable`, …) rather than a uniform `.entity`, so a generic caller
 * could not read the result without knowing the type. 0.2.2 adds an `entity`
 * alias to every in-repo service; `pickEntity` below keeps the door open for a
 * service that predates the alias — notably the externally-installed
 * `database-table`, which returns `.dbTable`.
 */
type RawUpsertReturn = {
  op: 'created' | 'updated';
  warnings?: string[];
  entity?: unknown;
} & Record<string, unknown>;

/**
 * Normalize a service's upsert return to `UpsertResult`.
 *
 * Prefer the canonical `entity` alias. Otherwise fall back to the single
 * remaining property once the envelope keys (`op`, `warnings`) are removed — a
 * STRUCTURAL rule, not an allowlist of per-type key names, so it also holds for a
 * plugin type the host has never heard of. When that is ambiguous (zero or
 * several candidates) surface the whole object rather than silently picking one.
 */
function pickEntity<T>(result: RawUpsertReturn, type: string): UpsertResult<T> {
  const { op, warnings } = result;
  if (result.entity !== undefined) {
    const e = result.entity as T;
    return warnings ? { entity: e, op, warnings } : { entity: e, op };
  }
  const candidates = Object.keys(result).filter((k) => k !== 'op' && k !== 'warnings');
  if (candidates.length === 1) {
    const e = result[candidates[0]!] as T;
    return warnings ? { entity: e, op, warnings } : { entity: e, op };
  }
  // Ambiguous: several payload keys and no `entity` alias to disambiguate. Return
  // the whole object rather than guessing which key is the entity — but SAY SO.
  // Handing back a wrapper silently is no better than an arbitrary wrong pick:
  // downstream serializers read fields off `.entity` to sync junctions and write
  // files, and they would operate on the wrapper without any signal.
  const extra = `entity service for type '${type}' returned an upsert result with ${
    candidates.length === 0 ? 'no' : `ambiguous (${candidates.join(', ')})`
  } payload key and no 'entity' alias — returning the whole result; add an 'entity' alias to its upsert()`;
  console.warn(`[entity-writer] ${extra}`);
  return { entity: result as T, op, warnings: [...(warnings ?? []), extra] };
}

export class HostEntityWriter implements EntityWriter {
  /**
   * M29: `capture` gates `entity_version` capture inside the service mutation.
   *   - index-reconstruction path (boot rebuild / reindex): capture=false
   *   - M17 release restore: capture=true (a real mutation, append-only)
   * `writeFile` is ALWAYS false here: the restore path must never write entity
   * files inside the service (the index rebuild reads files; release restore
   * persists each entity's file once at the end, after junctions are synced).
   */
  private readonly mutateOpts: WriteOpts;

  constructor(
    private host: PluginHost,
    private tags: TagsService,
    private readonly opts: { capture?: boolean; stamp?: SystemStamp } = {},
    /**
     * 0.2.9 — what the host needs to write a serviceless type's projection
     * itself. Optional so a hand-built test writer need not supply it; every
     * production construction site does.
     */
    private readonly projection: ProjectionWriteDeps | null = null,
  ) {
    this.mutateOpts = {
      capture: opts.capture ?? true,
      writeFile: false,
      ...(opts.stamp ? { stamp: opts.stamp } : {}),
    };
  }

  /**
   * 0.2.4 — a clone that writes `stamp` into every mutation's audit columns
   * instead of letting the service mint one.
   *
   * A clone rather than a mutable field: `restoreEntity` builds one per entity
   * from that entity's own file, and the writer it hands the per-type `restore`
   * slot may be retained by it for the length of the call. Sharing one mutable
   * writer across a batch restore would leak the previous entity's timestamps
   * into the next one.
   */
  withStamp(stamp: SystemStamp): HostEntityWriter {
    return new HostEntityWriter(this.host, this.tags, { ...this.opts, stamp }, this.projection);
  }

  // ─── the one generic write door ───────────────────────────────────────────

  upsert<T = unknown>(
    type: string,
    slug: string,
    input: unknown,
    actor: ChangedBy,
  ): UpsertResult<T> | null {
    const service = this.host.getEntityService(type);
    if (service?.upsert) {
      const result = service.upsert(slug, input, actor, this.mutateOpts) as RawUpsertReturn;
      const picked = pickEntity<T>(result, type);
      /**
       * 0.2.9 tier B PR2 — the service wrote its ROW; the host writes the
       * collections that live in tables of their own.
       *
       * A service predates the declaration and only knows the columns it was
       * written against. `EndpointService.upsert` writes `endpoint`, not
       * `endpoint_dto`; the junction used to be synced by the per-type `restore`
       * slot, immediately after this call, and that slot no longer exists. The
       * responsibility has to land somewhere the DECLARATION drives, or the
       * first boot rebuild empties the junction and the following `persist`
       * writes the emptied collection back into the entity file.
       */
      const module = this.host.getEntity(type);
      if (module?.data?.schema && this.projection) {
        const warnings = syncProjectionTables(this.projection.db, module, slug, input);
        if (warnings.length) {
          picked.warnings = [...(picked.warnings ?? []), ...warnings];
        }
      }
      return picked;
    }

    /**
     * 0.2.9 (brief item 6) — no service is no longer the end of the road.
     *
     * A type that declares `data.schema` has a generated projection, and the
     * host can write it directly. Preferring the service when present is not a
     * fallback ordering but a correctness one: a service owns domain validation
     * and derived fields the declaration does not describe, so bypassing it
     * where it exists would write a row the type would not have written.
     */
    const module = this.host.getEntity(type);
    if (module?.data?.schema && this.projection) {
      return upsertProjectionRow<T>(this.projection, module, slug, input, actor, this.mutateOpts);
    }

    /**
     * The only remaining `null`: the type is not active in this project at all
     * (deactivated, or carried by a bundle this installation never had). The
     * caller reports a skip; this is NOT an error.
     *
     * A module that IS active and declares a schema but reached here means the
     * writer was built without projection deps — a wiring bug, not a data
     * condition, so it is worth saying out loud rather than degrading to a skip
     * that reads identically to a deactivated type.
     */
    if (module?.data?.schema && !this.projection) {
      console.warn(
        `[entity-writer] ${type}/${slug}: type declares data.schema but this writer ` +
          `was constructed without projection deps — falling back to a skip`,
      );
    }
    return null;
  }

  // ─── tags ─────────────────────────────────────────────────────────────────

  syncTags(type: RawEntityType, slug: string, tags: string[]): void {
    /**
     * Existence is asked of the ROW, not of the service registry.
     *
     * `host.entityExists` answers through `getEntityService(type)?.getBySlug`, so
     * for a serviceless type it returns `false` no matter what is in the table —
     * and this method then returned without assigning anything. Every such entity
     * came out of the rebuild with ZERO tags (the rebuild deletes `entity_tag`
     * rows for the types it is about to refill), and the next `persist` wrote
     * that empty list back into the file, destroying the tags at their source.
     *
     * The service answer is kept as the fast path — it is the same question — and
     * the projection row is consulted only when there is no service to ask.
     */
    if (!this.entityExists(type, slug)) return;
    this.tags.assignTags(type, slug, tags);
  }

  private entityExists(type: string, slug: string): boolean {
    if (this.host.getEntityService(type)?.getBySlug) return this.host.entityExists(type, slug);
    const module = this.host.getEntity(type);
    if (!module?.data?.schema || !this.projection) return false;
    return projectionRowExists(this.projection, module, slug);
  }

  /**
   * 0.2.2: was a seven-arm `switch (type)` whose arms each resolved one named
   * service class and then did the identical two calls. 0.2.9: the service is
   * preferred but no longer required — a serviceless type deletes through the
   * host's own projection door, for the same reason it writes through one.
   */
  delete(type: RawEntityType, slug: string, actor: ChangedBy): { deleted: boolean } {
    const service = this.host.getEntityService(type);
    if (service?.getBySlug && service.remove) {
      if (!service.getBySlug(slug)) return { deleted: false };
      service.remove(slug, actor);
      return { deleted: true };
    }

    /**
     * Without this, item 6 closed the silent drop on the create/update half and
     * left it wide open on the delete half: `ReleaseService.restoreEntity`'s
     * delete branch reported `op: 'noop'` with no warnings while the entity
     * survived, telling the user a restore succeeded that had not.
     */
    const module = this.host.getEntity(type);
    if (module?.data?.schema && this.projection) {
      return removeProjectionRow(this.projection, module, slug, actor, this.mutateOpts);
    }

    // Distinguish "no delete door" from "nothing to delete". Both return
    // deleted:false, but only the first is a problem the operator must see.
    console.warn(
      `[entity-writer] cannot delete ${type}/${slug}: type is not active in this ` +
        `project (no service and no declared data.schema)`,
    );
    return { deleted: false };
  }
}
