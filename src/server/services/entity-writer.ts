/**
 * Concrete EntityWriter implementation for M17 restore (Phase 6).
 *
 * Constructed per-restore-request by ReleaseService. Each write is captured into
 * `entity_version` with `release_id = NULL` (append-only — decyzja 7).
 *
 * Idempotent UPSERT semantics (decyzja 11): no `--force` flag, no destructive
 * operations on history. The append-only safety net makes accidental overwrites
 * cofalne by another restore.
 *
 * 0.2.2 collapsed seven per-type methods into one generic `upsert(type, …)` that
 * still dispatched to `host.getEntityService(type)`. **0.2.9 tier K (brief item
 * 6) removes that dispatch entirely**: there are no per-type CRUD services left
 * to dispatch to. Every write lands in the projection the host generated from
 * that type's `data.schema`, which is now the only write mechanism there is.
 *
 * `getEntityService` still exists, but what it returns after tier K is a DOMAIN
 * HELPER (`ac`'s analysis service, `design-system`'s `resolve`) — never a write
 * door. Probing it here for an `upsert` method would re-open the very fork this
 * tier closed, and would do it by shape, on objects that make no such promise.
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
  danglingScalarRefs,
  upsertProjectionRow,
  type ProjectionWriteDeps,
} from '../db/projection-write.js';

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
    /**
     * 0.2.9 (brief item 6) — a type that declares `data.schema` has a generated
     * projection, and the host writes it. There is no second branch: tier K
     * deleted the six services the previous one preferred, and the collections
     * living in tables of their own (`endpoint_dto`) are synced by
     * `upsertProjectionRow` inside its own transaction rather than patched up
     * afterwards.
     */
    const module = this.host.getEntity(type);
    if (module?.data?.schema && this.projection) {
      const result = upsertProjectionRow<T>(this.projection, module, slug, input, actor, this.mutateOpts);
      // The projection branch syncs its own collections inside its transaction,
      // but scalar refs are checked here for both branches — one rule, one place.
      const dangling = danglingScalarRefs(this.projection.db, module, slug, input);
      if (dangling.length) result.warnings = [...(result.warnings ?? []), ...dangling];
      return result;
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
     * Tier K: the service fast path is gone with the services. The projection row
     * is now the only thing there is to ask, and it was always the correct one.
     */
    if (!this.entityExists(type, slug)) return;
    this.tags.assignTags(type, slug, tags);
  }

  private entityExists(type: string, slug: string): boolean {
    const module = this.host.getEntity(type);
    if (!module?.data?.schema || !this.projection) return false;
    return projectionRowExists(this.projection, module, slug);
  }

  /**
   * 0.2.2: was a seven-arm `switch (type)` whose arms each resolved one named
   * service class and then did the identical two calls. 0.2.9 tier K: every type
   * deletes through the host's own projection door, for the same reason it
   * writes through one.
   */
  delete(type: RawEntityType, slug: string, actor: ChangedBy): { deleted: boolean } {
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
