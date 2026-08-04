/**
 * EntityWriter — the normal write-API surface used by the restore path. All
 * mutations end up in `entity_version` with `release_id = NULL` (append-only —
 * M17 decyzja 7).
 *
 * 0.2.2 collapsed seven per-type methods into ONE generic `upsert(type, …)`, but
 * kept a per-type service dispatch behind it: a type whose
 * `getEntityService(type)` returned `null` had no write door at all, and restore
 * reported that as a skip. So "the host owns the entity type" was true of the
 * SIGNATURE and false of the mechanism — a type that declared its data but no
 * service could be read, indexed and diffed, yet never written.
 *
 * 0.2.9 (Host API 2.0.0, brief item 6) closes that. The service dispatch is now
 * an OPTIMISATION, not the contract: a type that still contributes a
 * `backend.service` is driven through it, and a type that does not is written by
 * the host itself, straight into the projection it generated from that type's
 * `data.schema` (see `../db/projection-write.ts`). There is no longer any such
 * thing as an active type without a write door, which is what lets restore stop
 * enumerating the types it can handle.
 */

import type { ChangedBy } from '../../shared/entities.js';
import type { RawEntityType } from '../discovery/raw-entity-reader.js';
import type { SystemStamp } from './system-fields.js';

export interface UpsertResult<T> {
  entity: T;
  op: 'created' | 'updated';
  warnings?: string[];
}

export interface EntityWriter {
  /**
   * The single generic write door.
   *
   * Resolution order, and the whole of it: the type's `backend.service` if it
   * contributed one, else the host's own projection write (0.2.9). Both land the
   * same row and the same `entity_version` capture; which one ran is not
   * observable to the caller.
   *
   * Still returns `null` — but now for exactly ONE reason: the type is not active
   * in this project at all (deactivated, or carried by a bundle this installation
   * never had). "Active but serviceless" stopped being a null case in 0.2.9. A
   * caller must degrade that to "this entity was not restored", never to "the
   * whole restore died"; `restoreEntity` turns it into a reported skip.
   */
  upsert<T = unknown>(
    type: string,
    slug: string,
    input: unknown,
    actor: ChangedBy,
  ): UpsertResult<T> | null;

  /**
   * 0.2.4 — return a writer that stamps every mutation with `stamp` instead of
   * minting `datetime('now')`.
   *
   * The stamp rides on the WRITER, not in the payload, because the per-type
   * `restore` slot must keep seeing exactly the snapshot shape it saw before
   * 0.2.4. `restoreEntity` strips the envelope off the data and pre-loads it
   * here, so the serializer call site is byte-identical and no per-type code
   * learns that timestamps exist.
   *
   * Optional so a hand-built test writer need not implement it; the host's own
   * `HostEntityWriter` always does.
   */
  withStamp?(stamp: SystemStamp): EntityWriter;

  // The five deprecated per-type shims (`upsertDatabaseTable`, `upsertUiView`,
  // `upsertAc`, `upsertDesignSystem`, `upsertDiagram`) are GONE as of 0.2.9.
  //
  // They survived 0.2.2 for one reason: the installed
  // `c4s-plugin-simple-database-tables` probed `typeof
  // writer.upsertDatabaseTable === 'function'` and fell back to a two-arg
  // `writer.upsert(type, snapshot)` that would have landed the snapshot in the
  // `slug` position. That plugin declares `hostApiVersion: "^1.0.0"` and the host
  // is at 2.0.0, so the loader rejects it as `incompatible` before registration —
  // the probe can no longer run, and with it the only reason the shims existed.

  /** Sync entity tags to a target list. Idempotent. */
  syncTags(type: RawEntityType, slug: string, tags: string[]): void;

  /** Delete by slug — generates a `delete` row in entity_version. */
  delete(type: RawEntityType, slug: string, actor: ChangedBy): { deleted: boolean };
}
