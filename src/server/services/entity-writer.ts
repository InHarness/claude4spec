/**
 * Concrete EntityWriter implementation for M17 restore (Phase 6).
 *
 * Constructed per-restore-request by ReleaseService — looks up entity
 * services + tag/junction services from the plugin host. Each write goes
 * through the normal service API so the mutation is captured into
 * `entity_version` with `release_id = NULL` (append-only — decyzja 7).
 *
 * Idempotent UPSERT semantics (decyzja 11): no `--force` flag, no
 * destructive operations on history. The append-only safety net makes
 * accidental overwrites cofalne by another restore.
 */

import type {
  ChangedBy,
  EndpointDtoLink,
  EndpointDtoRelation,
} from '../../shared/entities.js';
import type { EntityWriter, UpsertResult } from '../serialization/writer.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { RawEntityType } from '../domain/raw-entity-reader.js';
import type { EndpointService } from '../entities/endpoint/services.js';
import type { DtoService } from '../entities/dto/services.js';
import type { DatabaseTableService } from '../entities/database-table/services.js';
import type { UiViewService } from '../entities/ui-view/services.js';
import type { AcService } from '../entities/ac/services.js';
import type { DesignSystemService } from '../entities/design-system/services.js';
import type { DiagramService } from '../entities/diagram/services.js';
import type { TagsService } from './tags.js';
import { DomainError } from './tags.js';

export class HostEntityWriter implements EntityWriter {
  /**
   * M29: `capture` gates `entity_version` capture inside the service mutation.
   *   - index-reconstruction path (boot rebuild / reindex): capture=false
   *   - M17 release restore: capture=true (a real mutation, append-only)
   * `writeFile` is ALWAYS false here: the restore path must never write entity
   * files inside the service (the index rebuild reads files; release restore
   * persists each entity's file once at the end, after junctions are synced).
   */
  private readonly mutateOpts: { capture: boolean; writeFile: boolean };

  constructor(private host: PluginHost, private tags: TagsService, opts: { capture?: boolean } = {}) {
    this.mutateOpts = { capture: opts.capture ?? true, writeFile: false };
  }

  upsertEndpoint(slug: string, input: Parameters<EndpointService['upsert']>[1], actor: ChangedBy): UpsertResult<ReturnType<EndpointService['upsert']>['entity']> {
    const service = this.requireService<EndpointService>('endpoint');
    const result = service.upsert(slug, input, actor, this.mutateOpts);
    return { entity: result.entity, op: result.op };
  }

  upsertDto(slug: string, input: Parameters<DtoService['upsert']>[1], actor: ChangedBy): UpsertResult<ReturnType<DtoService['upsert']>['dto']> {
    const service = this.requireService<DtoService>('dto');
    const result = service.upsert(slug, input, actor, this.mutateOpts);
    return { entity: result.dto, op: result.op };
  }

  upsertDatabaseTable(slug: string, input: Parameters<DatabaseTableService['upsert']>[1], actor: ChangedBy): UpsertResult<ReturnType<DatabaseTableService['upsert']>['dbTable']> {
    const service = this.requireService<DatabaseTableService>('database-table');
    const result = service.upsert(slug, input, actor, this.mutateOpts);
    return { entity: result.dbTable, op: result.op, warnings: result.warnings };
  }

  upsertUiView(slug: string, input: Parameters<UiViewService['upsert']>[1], actor: ChangedBy): UpsertResult<ReturnType<UiViewService['upsert']>['uiView']> {
    const service = this.requireService<UiViewService>('ui-view');
    const result = service.upsert(slug, input, actor, this.mutateOpts);
    return { entity: result.uiView, op: result.op, warnings: result.warnings };
  }

  upsertAc(slug: string, input: Parameters<AcService['upsert']>[1], actor: ChangedBy): UpsertResult<ReturnType<AcService['upsert']>['ac']> {
    const service = this.requireService<AcService>('ac');
    const result = service.upsert(slug, input, actor, this.mutateOpts);
    return { entity: result.ac, op: result.op };
  }

  upsertDesignSystem(slug: string, input: Parameters<DesignSystemService['upsert']>[1], actor: ChangedBy): UpsertResult<ReturnType<DesignSystemService['upsert']>['designSystem']> {
    const service = this.requireService<DesignSystemService>('design-system');
    const result = service.upsert(slug, input, actor, this.mutateOpts);
    return { entity: result.designSystem, op: result.op, warnings: result.warnings };
  }

  upsertDiagram(slug: string, input: Parameters<DiagramService['upsert']>[1], actor: ChangedBy): UpsertResult<ReturnType<DiagramService['upsert']>['diagram']> {
    const service = this.requireService<DiagramService>('diagram');
    const result = service.upsert(slug, input, actor, this.mutateOpts);
    return { entity: result.diagram, op: result.op };
  }

  syncEndpointDtos(
    endpointSlug: string,
    target: Array<{ dtoSlug: string; relation: EndpointDtoRelation; statusCode: number | null }>,
  ): { linked: number; unlinked: number; warnings: string[] } {
    const service = this.requireService<EndpointService>('endpoint');
    const ep = service.getBySlug(endpointSlug);
    if (!ep) return { linked: 0, unlinked: 0, warnings: [`endpoint '${endpointSlug}' not found`] };

    const keyOf = (l: { dtoSlug: string; relation: string; statusCode: number | null }) =>
      `${l.relation}|${l.dtoSlug}|${l.statusCode ?? 'null'}`;
    const currentSet = new Map((ep.dtos as EndpointDtoLink[]).map((l) => [keyOf(l), l]));
    const targetSet = new Map(target.map((l) => [keyOf(l), l]));

    let linked = 0;
    let unlinked = 0;
    const warnings: string[] = [];

    // Unlink extras first to avoid conflicts on UNIQUE constraint
    for (const [k, current] of currentSet) {
      if (!targetSet.has(k)) {
        try {
          service.unlinkDto(endpointSlug, current.dtoSlug, current.relation, current.statusCode, { writeFile: false });
          unlinked += 1;
        } catch (err) {
          warnings.push(`unlink '${k}' failed: ${(err as Error).message}`);
        }
      }
    }
    // Link missing
    for (const [k, want] of targetSet) {
      if (!currentSet.has(k)) {
        try {
          service.linkDto(endpointSlug, want.dtoSlug, want.relation, want.statusCode, { writeFile: false });
          linked += 1;
        } catch (err) {
          warnings.push(`link '${k}' failed: ${(err as Error).message}`);
        }
      }
    }
    return { linked, unlinked, warnings };
  }

  syncTags(type: RawEntityType, slug: string, tags: string[]): void {
    // M29: slug is the sole identity — assign directly. The caller's upsert has
    // already ensured the entity row exists.
    if (!this.host.entityExists(type, slug)) return;
    this.tags.assignTags(type, slug, tags);
  }

  delete(type: RawEntityType, slug: string, actor: ChangedBy): { deleted: boolean } {
    switch (type) {
      case 'endpoint': {
        const service = this.requireService<EndpointService>('endpoint');
        if (!service.getBySlug(slug)) return { deleted: false };
        service.remove(slug, actor);
        return { deleted: true };
      }
      case 'dto': {
        const service = this.requireService<DtoService>('dto');
        if (!service.getBySlug(slug)) return { deleted: false };
        service.remove(slug, actor);
        return { deleted: true };
      }
      case 'database-table': {
        const service = this.requireService<DatabaseTableService>('database-table');
        if (!service.getBySlug(slug)) return { deleted: false };
        service.remove(slug, actor);
        return { deleted: true };
      }
      case 'ui-view': {
        const service = this.requireService<UiViewService>('ui-view');
        if (!service.getBySlug(slug)) return { deleted: false };
        service.remove(slug, actor);
        return { deleted: true };
      }
      case 'ac': {
        const service = this.requireService<AcService>('ac');
        if (!service.getBySlug(slug)) return { deleted: false };
        service.remove(slug, actor);
        return { deleted: true };
      }
      case 'design-system': {
        const service = this.requireService<DesignSystemService>('design-system');
        if (!service.getBySlug(slug)) return { deleted: false };
        service.remove(slug, actor);
        return { deleted: true };
      }
      case 'diagram': {
        const service = this.requireService<DiagramService>('diagram');
        if (!service.getBySlug(slug)) return { deleted: false };
        service.remove(slug, actor);
        return { deleted: true };
      }
      default:
        return { deleted: false };
    }
  }

  private requireService<T>(type: string): T {
    const service = this.host.getEntityService(type);
    if (!service) throw new DomainError('VALIDATION', `entity service for type '${type}' not registered`);
    return service as T;
  }
}
