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
  EndpointDtoLink,
  EndpointDtoRelation,
  UiView,
  UiViewCreateInput,
} from '../../shared/entities.js';
import type { EntityWriter, UpsertResult } from '../serialization/writer.js';
import type { PluginHost, WriteOpts } from '../core/plugin-host/types.js';
import type { RawEntityType } from '../domain/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import { DomainError } from './tags.js';


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

  constructor(private host: PluginHost, private tags: TagsService, opts: { capture?: boolean } = {}) {
    this.mutateOpts = { capture: opts.capture ?? true, writeFile: false };
  }

  // ─── the one generic write door ───────────────────────────────────────────

  upsert<T = unknown>(
    type: string,
    slug: string,
    input: unknown,
    actor: ChangedBy,
  ): UpsertResult<T> | null {
    const service = this.host.getEntityService(type);
    // Structural, not enumerated: no service — an inactive type, or one that
    // contributed no `backend.service` slot — means no write door. The caller
    // reports a skip; this is NOT an error.
    if (!service?.upsert) return null;
    const result = service.upsert(slug, input, actor, this.mutateOpts) as RawUpsertReturn;
    return pickEntity<T>(result, type);
  }

  // ─── deprecated per-type shims (see the interface for why they survive) ────

  upsertDatabaseTable(slug: string, input: DatabaseTableCreateInput, actor: ChangedBy): UpsertResult<DatabaseTable> {
    return this.upsertOrThrow<DatabaseTable>('database-table', slug, input, actor);
  }
  upsertUiView(slug: string, input: UiViewCreateInput, actor: ChangedBy): UpsertResult<UiView> {
    return this.upsertOrThrow<UiView>('ui-view', slug, input, actor);
  }
  upsertAc(slug: string, input: AcCreateInput, actor: ChangedBy): UpsertResult<Ac> {
    return this.upsertOrThrow<Ac>('ac', slug, input, actor);
  }
  upsertDesignSystem(slug: string, input: DesignSystemCreateInput, actor: ChangedBy): UpsertResult<DesignSystem> {
    return this.upsertOrThrow<DesignSystem>('design-system', slug, input, actor);
  }
  upsertDiagram(slug: string, input: DiagramCreateInput, actor: ChangedBy): UpsertResult<Diagram> {
    return this.upsertOrThrow<Diagram>('diagram', slug, input, actor);
  }

  /**
   * The per-type shims keep the OLD contract of throwing on a missing service:
   * their callers are pre-0.2.2 restore slots that have no `null` branch, so
   * handing them `null` would read as "written" and lose the entity silently.
   */
  private upsertOrThrow<T>(
    type: string,
    slug: string,
    input: unknown,
    actor: ChangedBy,
  ): UpsertResult<T> {
    const result = this.upsert<T>(type, slug, input, actor);
    if (!result) {
      throw new DomainError('VALIDATION', `entity service for type '${type}' not registered`);
    }
    return result;
  }

  // ─── tags ─────────────────────────────────────────────────────────────────

  syncTags(type: RawEntityType, slug: string, tags: string[]): void {
    // M29: slug is the sole identity — assign directly. The caller's upsert has
    // already ensured the entity row exists.
    if (!this.host.entityExists(type, slug)) return;
    this.tags.assignTags(type, slug, tags);
  }

  /**
   * 0.2.2: was a seven-arm `switch (type)` whose arms each resolved one named
   * service class and then did the identical two calls. Now one generic path — a
   * plugin type deletes exactly as well as a built-in one, and a type with no
   * service reports `deleted: false` rather than falling into a silent `default:`.
   */
  delete(type: RawEntityType, slug: string, actor: ChangedBy): { deleted: boolean } {
    const service = this.host.getEntityService(type);
    if (!service?.getBySlug || !service.remove) {
      // Distinguish "no delete door" from "nothing to delete". Both return
      // deleted:false, but only the first is a problem the operator must see:
      // the pre-0.2.2 code THREW here and the caller turned that into a
      // `delete-restore failed: …` warning in the restore report. Returning a
      // bare false would let a restore that should have deleted an entity report
      // a clean `noop` while the entity survives in the index and on disk.
      console.warn(
        `[entity-writer] cannot delete ${type}/${slug}: entity service for type ` +
          `'${type}' is not registered or exposes no getBySlug/remove`,
      );
      return { deleted: false };
    }
    if (!service.getBySlug(slug)) return { deleted: false };
    service.remove(slug, actor);
    return { deleted: true };
  }
}
