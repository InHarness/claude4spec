/**
 * EntityWriter — normal write-API surface used by `EntitySerializer.restore()`.
 * All mutations end up in `entity_version` with `release_id = NULL` (append-only
 * — M17 decyzja 7).
 *
 * 0.2.2: the surface is ONE generic `upsert(type, …)`, dispatched through
 * `host.getEntityService(type)` and called on the service's `UpsertCapable`
 * facade BY SHAPE, never by class. Before, there were seven per-type methods and
 * no generic entry point, so a plugin type outside that hardcoded seven had no
 * write door in restore at all — the concrete way "the core owns the entity type"
 * was true in practice.
 *
 * What remains is a STRUCTURAL limit rather than an enumerated one: a type whose
 * `getEntityService(type)` returns `null` has no write door, and `restoreEntity`
 * REPORTS that as a skip instead of throwing on a missing per-type method.
 */

import type {
  Ac,
  AcCreateInput,
  ChangedBy,
  DatabaseTable,
  DatabaseTableCreateInput,
  DesignSystem,
  DesignSystemCreateInput,
  Diagram,
  DiagramCreateInput,
  Dto,
  DtoCreateInput,
  Endpoint,
  EndpointCreateInput,
  EndpointDtoRelation,
  UiView,
  UiViewCreateInput,
} from '../../shared/entities.js';
import type { RawEntityType } from '../domain/raw-entity-reader.js';

export interface UpsertResult<T> {
  entity: T;
  op: 'created' | 'updated';
  warnings?: string[];
}

export interface EntityWriter {
  /**
   * 0.2.2 — the single generic write door. `type` is resolved through the host's
   * entity-service registry; the resolved service is driven on its `UpsertCapable`
   * facade by shape.
   *
   * Returns `null` when the type has no registered service, rather than throwing:
   * a project that deactivated a type, or a bundle carrying a type this
   * installation never had, must degrade to "this entity was not restored", never
   * to "the whole restore died". `restoreEntity` turns the `null` into a reported
   * skip.
   */
  upsert<T = unknown>(
    type: string,
    slug: string,
    input: unknown,
    actor: ChangedBy,
  ): UpsertResult<T> | null;

  // ─── deprecated per-type shims ────────────────────────────────────────────
  //
  // Kept, not deleted, DESPITE the 0.2.2 brief calling them host-internal with no
  // published consumer. They have one: the installed `c4s-plugin-database-tables`
  // probes `typeof writer.upsertDatabaseTable === 'function'` in its restore slot
  // and, when absent, falls back to `writer.upsert(type, snapshot)` — a TWO-arg
  // call that does not match the generic signature above. Removing the shim would
  // not fail loudly; it would land `snapshot` in the `slug` position and restore
  // nothing, which is exactly the silent-data-loss mode that plugin's own comment
  // says it added the probe to avoid. They delegate to `upsert` and carry no logic.
  //
  // The `endpoint` and `dto` shims are GONE as of Tier B: their only callers were
  // those two types' own restore slots, which now live in the envelope and go
  // through the generic `upsert`.

  /** @deprecated 0.2.2 — use `upsert('database-table', …)`. */
  upsertDatabaseTable(slug: string, input: DatabaseTableCreateInput, actor: ChangedBy): UpsertResult<DatabaseTable>;
  /** @deprecated 0.2.2 — use `upsert('ui-view', …)`. */
  upsertUiView(slug: string, input: UiViewCreateInput, actor: ChangedBy): UpsertResult<UiView>;
  /** @deprecated 0.2.2 — use `upsert('ac', …)`. */
  upsertAc(slug: string, input: AcCreateInput, actor: ChangedBy): UpsertResult<Ac>;
  /** @deprecated 0.2.2 — use `upsert('design-system', …)`. */
  upsertDesignSystem(slug: string, input: DesignSystemCreateInput, actor: ChangedBy): UpsertResult<DesignSystem>;
  /** @deprecated 0.2.2 — use `upsert('diagram', …)`. */
  upsertDiagram(slug: string, input: DiagramCreateInput, actor: ChangedBy): UpsertResult<Diagram>;

  /** Sync entity tags to a target list. Idempotent. */
  syncTags(type: RawEntityType, slug: string, tags: string[]): void;

  /** Delete by slug — generates a `delete` row in entity_version. */
  delete(type: RawEntityType, slug: string, actor: ChangedBy): { deleted: boolean };
}
