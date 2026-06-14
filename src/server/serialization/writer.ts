/**
 * EntityWriter — normal write-API surface used by `EntitySerializer.restore()`.
 * Each plugin's restore slot calls type-specific methods which delegate to the
 * per-type service. All mutations end up in `entity_version` with
 * `release_id = NULL` (append-only — M17 decyzja 7).
 *
 * Phase 1: declared as type-only.
 * Phase 2: per-plugin restore() consumes this surface.
 * Phase 6: concrete implementation constructed by `releaseService` from the
 * active per-type services + a tag/junction adapter.
 */

import type {
  Ac,
  AcCreateInput,
  ChangedBy,
  DatabaseTable,
  DatabaseTableCreateInput,
  DesignSystem,
  DesignSystemCreateInput,
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
  upsertEndpoint(slug: string, input: EndpointCreateInput, actor: ChangedBy): UpsertResult<Endpoint>;
  upsertDto(slug: string, input: DtoCreateInput, actor: ChangedBy): UpsertResult<Dto>;
  upsertDatabaseTable(slug: string, input: DatabaseTableCreateInput, actor: ChangedBy): UpsertResult<DatabaseTable>;
  upsertUiView(slug: string, input: UiViewCreateInput, actor: ChangedBy): UpsertResult<UiView>;
  upsertAc(slug: string, input: AcCreateInput, actor: ChangedBy): UpsertResult<Ac>;
  upsertDesignSystem(slug: string, input: DesignSystemCreateInput, actor: ChangedBy): UpsertResult<DesignSystem>;

  /** Sync endpoint↔dto junction to a target list. Idempotent: link missing, unlink extra. */
  syncEndpointDtos(
    endpointSlug: string,
    target: Array<{ dtoSlug: string; relation: EndpointDtoRelation; statusCode: number | null }>
  ): { linked: number; unlinked: number; warnings: string[] };

  /** Sync entity tags to a target list. Idempotent. */
  syncTags(type: RawEntityType, slug: string, tags: string[]): void;

  /** Delete by slug — generates a `delete` row in entity_version. */
  delete(type: RawEntityType, slug: string, actor: ChangedBy): { deleted: boolean };
}
