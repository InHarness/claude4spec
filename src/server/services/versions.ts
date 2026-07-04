import type Database from 'better-sqlite3';
import type {
  ChangedBy,
  EntityType,
  VersionDetail,
  VersionListItem,
} from '../../shared/entities.js';
import { DomainError } from './tags.js';
import type { TagsService } from './tags.js';
import { HostEntityWriter } from './entity-writer.js';
import type { EntityStore } from './entity-store.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { RestoreContext } from '../serialization/types.js';
import type { RawEntityReader, RawEntityType } from '../domain/raw-entity-reader.js';

export type VersionOp = 'create' | 'update' | 'delete';

interface VersionRow {
  entity_type: string;
  entity_slug: string;
  version: number;
  data: string;
  changed_by: string;
  change_summary: string | null;
  created_at: string;
  release_id: number | null;
  serializer_version: string | null;
  op: string | null;
}

export interface CreateVersionInput {
  entityType: EntityType;
  entitySlug: string;
  data: unknown;
  changedBy: ChangedBy;
  changeSummary?: string | null;
  /** M17: which kind of mutation. Required for new code; legacy callers omit. */
  op?: VersionOp;
  /** M17: serializer.version at time of capture. Null for legacy rows. */
  serializerVersion?: string | null;
}

export class VersionService {
  // M17: lazily wired by index.ts after pluginHost.consolidate. When present,
  // entity services prefer captureSnapshot(...) over createVersion(...) so
  // entity_version.data carries the full snapshot (decyzja 4 — portable identity).
  private snapshotDeps: { reader: RawEntityReader; host: PluginHost } | null = null;
  // M34/L11: wired separately from snapshotDeps — entityStore/tagsService are
  // constructed later in bootstrap than reader/host.
  private restoreDeps: { entityStore: EntityStore; tagsService: TagsService } | null = null;

  constructor(private db: Database.Database) {}

  /** M17: wire snapshot dependencies. Called once during server bootstrap. */
  configureSnapshot(reader: RawEntityReader, host: PluginHost): void {
    this.snapshotDeps = { reader, host };
  }

  /** M34/L11: wire restore dependencies. Called once during server bootstrap. */
  configureRestore(entityStore: EntityStore, tagsService: TagsService): void {
    this.restoreDeps = { entityStore, tagsService };
  }

  /**
   * M34/L11: restore an entity to a specific captured version (distinct from
   * the release-scoped `ReleaseService.restoreEntity`, which resolves "as of
   * a release" instead of an exact `entity_version.version`). UPSERTs through
   * the plugin's normal write-API via `HostEntityWriter` (same mechanism
   * release restore uses), then captures a NEW `update` version so the
   * restore itself is an append-only, undoable action.
   */
  restore(type: RawEntityType, entitySlug: string, version: number, actor: ChangedBy): VersionListItem {
    if (!this.snapshotDeps) throw new DomainError('VALIDATION', 'version restore unavailable before boot completes');
    if (!this.restoreDeps) throw new DomainError('VALIDATION', 'version restore unavailable before boot completes');
    const target = this.getVersion(type, entitySlug, version);
    if (!target) throw new DomainError('NOT_FOUND', `version ${version} not found for ${type}/${entitySlug}`);

    const { reader, host } = this.snapshotDeps;
    const { entityStore, tagsService } = this.restoreDeps;
    const writer = new HostEntityWriter(host, tagsService);
    const ctx: RestoreContext = { reader, writer, releaseId: null, actor };
    host.restore(type, target.data, ctx);
    // M29: persist the restored entity's file (host.restore used writeFile:false).
    entityStore.persist(type, entitySlug);

    const serializerVersion = host.getEntity(type)?.serializer.version ?? null;
    return this.captureEntitySnapshot(
      type,
      entitySlug,
      'update',
      actor,
      `Restored to version ${version}`,
      serializerVersion ?? 'unknown',
    );
  }

  /**
   * M17: capture a deterministic snapshot of an entity into entity_version.
   * Falls back to `createVersion(..., entity, ...)` if snapshot deps not wired
   * yet (very early in bootstrap or for tests). For `op = 'delete'`, calls
   * host.snapshot BEFORE the caller deletes the row — pass `previousSnapshot`
   * explicitly to capture a tombstone with last-known data.
   */
  captureEntitySnapshot(
    type: RawEntityType,
    entitySlug: string,
    op: VersionOp,
    actor: ChangedBy,
    summary: string | null,
    serializerVersion: string
  ): VersionListItem {
    if (!this.snapshotDeps) {
      // Fallback: deps not yet wired. Store legacy domain object via createVersion.
      return this.createVersion(type, entitySlug, null, actor, summary, op, serializerVersion);
    }
    // For all ops (including delete), snapshot the entity *as it currently is*
    // (callers must call this BEFORE the row is deleted from its table).
    const rawEntity = this.snapshotDeps.reader.getEntity(type, entitySlug);
    if (!rawEntity) {
      // Entity not found — fall back to last-known snapshot so tombstone has
      // restorable data. This path is only hit if a caller calls capture
      // post-delete (anti-pattern but defensive).
      const last = this.getLatestVersionForEntity(type, entitySlug);
      return this.createVersion(type, entitySlug, last?.data ?? null, actor, summary, op, serializerVersion);
    }
    const ctx = { reader: this.snapshotDeps.reader, depth: 0, maxDepth: 1 };
    const snapshot = this.snapshotDeps.host.snapshot(type, rawEntity, ctx);
    return this.createVersion(type, entitySlug, snapshot, actor, summary, op, serializerVersion);
  }

  /**
   * Capture a new version. M17 augments the row with `op` and
   * `serializer_version`; `release_id` always starts NULL and is assigned by
   * `releaseService.createRelease()`.
   */
  createVersion(
    entityType: EntityType,
    entitySlug: string,
    data: unknown,
    changedBy: ChangedBy,
    changeSummary?: string | null,
    op?: VersionOp,
    serializerVersion?: string | null
  ): VersionListItem {
    const next = this.nextVersionNumber(entityType, entitySlug);
    const inferredOp: VersionOp = op ?? (data === null ? 'delete' : (next === 1 ? 'create' : 'update'));
    this.db
      .prepare(
        `INSERT INTO entity_version
           (entity_type, entity_slug, version, data, changed_by, change_summary, op, serializer_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entityType,
        entitySlug,
        next,
        JSON.stringify(data),
        changedBy,
        changeSummary ?? null,
        inferredOp,
        serializerVersion ?? null
      );
    const row = this.db
      .prepare(
        `SELECT * FROM entity_version WHERE entity_type = ? AND entity_slug = ? AND version = ?`
      )
      .get(entityType, entitySlug, next) as VersionRow;
    return this.toListItem(row);
  }

  listVersions(entityType: EntityType, entitySlug: string): VersionListItem[] {
    const rows = this.db
      .prepare(
        `SELECT version, changed_by, change_summary, created_at, release_id, op
           FROM entity_version
          WHERE entity_type = ? AND entity_slug = ?
          ORDER BY version DESC`
      )
      .all(entityType, entitySlug) as Array<{
        version: number;
        changed_by: string;
        change_summary: string | null;
        created_at: string;
        release_id: number | null;
        op: string | null;
      }>;
    return rows.map((r) => ({
      version: r.version,
      changedBy: r.changed_by as ChangedBy,
      changeSummary: r.change_summary,
      createdAt: r.created_at,
      ...(r.release_id !== null ? { releaseId: r.release_id } : {}),
      ...(r.op ? { op: r.op as VersionOp } : {}),
    }));
  }

  getVersion(entityType: EntityType, entitySlug: string, version: number): VersionDetail | null {
    const row = this.db
      .prepare(
        `SELECT * FROM entity_version
          WHERE entity_type = ? AND entity_slug = ? AND version = ?`
      )
      .get(entityType, entitySlug, version) as VersionRow | undefined;
    if (!row) return null;
    return this.toDetail(row);
  }

  /**
   * M17: latest captured version of an entity at-or-before a given release.
   * `releaseId === null` returns the latest unreleased capture (release_id IS NULL).
   * `releaseId === undefined` returns the latest overall (no release filter).
   */
  getLatestVersionForEntity(
    entityType: EntityType,
    entitySlug: string,
    releaseId?: number | null
  ): VersionDetail | null {
    let row: VersionRow | undefined;
    if (releaseId === undefined) {
      row = this.db
        .prepare(
          `SELECT * FROM entity_version
            WHERE entity_type = ? AND entity_slug = ?
            ORDER BY version DESC LIMIT 1`
        )
        .get(entityType, entitySlug) as VersionRow | undefined;
    } else if (releaseId === null) {
      row = this.db
        .prepare(
          `SELECT * FROM entity_version
            WHERE entity_type = ? AND entity_slug = ? AND release_id IS NULL
            ORDER BY version DESC LIMIT 1`
        )
        .get(entityType, entitySlug) as VersionRow | undefined;
    } else {
      row = this.db
        .prepare(
          `SELECT * FROM entity_version
            WHERE entity_type = ? AND entity_slug = ? AND release_id IS NOT NULL AND release_id <= ?
            ORDER BY version DESC LIMIT 1`
        )
        .get(entityType, entitySlug, releaseId) as VersionRow | undefined;
    }
    return row ? this.toDetail(row) : null;
  }

  diff(
    entityType: EntityType,
    entitySlug: string,
    fromVersion: number,
    toVersion: number
  ): { from: VersionDetail; to: VersionDetail; changes: DiffEntry[] } {
    const from = this.getVersion(entityType, entitySlug, fromVersion);
    const to = this.getVersion(entityType, entitySlug, toVersion);
    if (!from || !to) throw new DomainError('NOT_FOUND', 'version not found');
    return { from, to, changes: computeDiff(from.data, to.data) };
  }

  private nextVersionNumber(entityType: EntityType, entitySlug: string): number {
    const row = this.db
      .prepare(
        `SELECT MAX(version) AS v FROM entity_version WHERE entity_type = ? AND entity_slug = ?`
      )
      .get(entityType, entitySlug) as { v: number | null };
    return (row.v ?? 0) + 1;
  }

  private toListItem(row: VersionRow): VersionListItem {
    return {
      version: row.version,
      changedBy: row.changed_by as ChangedBy,
      changeSummary: row.change_summary,
      createdAt: row.created_at,
      ...(row.release_id !== null ? { releaseId: row.release_id } : {}),
      ...(row.op ? { op: row.op as VersionOp } : {}),
    };
  }

  private toDetail(row: VersionRow): VersionDetail {
    return {
      entityType: row.entity_type as EntityType,
      entitySlug: row.entity_slug,
      version: row.version,
      data: safeParse(row.data),
      changedBy: row.changed_by as ChangedBy,
      changeSummary: row.change_summary,
      createdAt: row.created_at,
      ...(row.release_id !== null ? { releaseId: row.release_id } : {}),
      ...(row.op ? { op: row.op as VersionOp } : {}),
    };
  }
}

export interface DiffEntry {
  path: string;
  from: unknown;
  to: unknown;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function computeDiff(from: unknown, to: unknown, prefix = ''): DiffEntry[] {
  if (deepEqual(from, to)) return [];
  if (!isObj(from) || !isObj(to)) return [{ path: prefix || '/', from, to }];
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  const changes: DiffEntry[] = [];
  for (const key of keys) {
    const sub = prefix ? `${prefix}.${key}` : key;
    changes.push(...computeDiff((from as Record<string, unknown>)[key], (to as Record<string, unknown>)[key], sub));
  }
  return changes;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
