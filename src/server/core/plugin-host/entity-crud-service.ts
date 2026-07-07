/**
 * M13: the write-side contract every entity plugin's L2 service satisfies so
 * the generic `entity-tools` MCP server (src/server/mcp/entity-tools.ts) can
 * drive create/get/update/delete/list/search without a per-type switch.
 *
 * Concrete services (EndpointService, DtoService, ...) keep their existing
 * rich methods (create/getBySlug/update/remove/upsert/listRaw/...) untouched
 * — batching, non-transactional partial-success, and per-item error envelopes
 * belong to entity-tools, not the service. `EntityCrudService` is a thin,
 * per-item adapter surface layered on top via `extends BaseEntityCrudService`.
 */

export interface EntityListOpts {
  tags?: string[];
  tagFilter?: 'and' | 'or';
  limit: number;
  offset: number;
}

export interface EntityListResult<T> {
  items: T[];
  total: number;
}

export interface EntityMutateResult {
  slug: string;
  /** Lint/consistency warnings surfaced by some types (design-system, ui-view, diagram). */
  warnings?: string[];
}

export interface EntityCrudService<T = unknown> {
  /**
   * May return a Promise — e.g. diagram's create/update await an async
   * mermaid/d2 validation pass to compute `warnings`. entity-tools always
   * `await`s this (a no-op for synchronous implementations).
   */
  create(data: unknown): EntityMutateResult | Promise<EntityMutateResult>;
  get(slug: string): T | null;
  /**
   * `data` may carry an explicit `newSlug` field to rename (collision surfaces
   * as a DomainError('SLUG_CONFLICT', ...)) — NOT a separate positional
   * parameter. A 3rd positional param here would be structurally compatible
   * (under TS's bivariant method-param checking) with concrete services'
   * `actor` parameter despite meaning something completely different, silently
   * corrupting the audit trail. entity-tools merges `{ ...data, newSlug }`
   * before calling this. May return a Promise — see `create`.
   */
  update(slug: string, data: unknown): EntityMutateResult | Promise<EntityMutateResult>;
  delete(slug: string): void;
  list(opts: EntityListOpts): EntityListResult<T>;
  /** Optional — types without a meaningful text search omit this. */
  search?(query: string, opts: { limit: number; offset: number }): EntityListResult<T>;
}

/**
 * Marker base class for entity services driven by the generic `entity-tools`
 * server. Every migrated in-repo entity has its own already-correct tag-filter
 * SQL for `list`/`search` (no shared derived-index default is worth forcing —
 * an earlier draft required a `listRaw()` abstract shape here purely to back a
 * default `list()`, which added an artificial constraint no concrete service
 * actually used, since every one of them overrides `list` with real SQL
 * anyway). `search` stays optional per the interface; a subclass adds it
 * directly when the type supports it.
 */
export abstract class BaseEntityCrudService<T = unknown> implements EntityCrudService<T> {
  abstract create(data: unknown): EntityMutateResult | Promise<EntityMutateResult>;
  abstract get(slug: string): T | null;
  abstract update(slug: string, data: unknown): EntityMutateResult | Promise<EntityMutateResult>;
  abstract delete(slug: string): void;
  abstract list(opts: EntityListOpts): EntityListResult<T>;
}
