import type Database from 'better-sqlite3';
import type {
  ChangedBy,
  EntityType,
  VersionDetail,
  VersionListItem,
} from '../../shared/entities.js';
import { DomainError } from './tags.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { RawEntityReader, RawEntityType } from '../domain/raw-entity-reader.js';

export type VersionOp = 'create' | 'update' | 'delete';

interface VersionRow {
  id: number;
  entity_type: string;
  entity_id: number;
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
  entityId: number;
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

  constructor(private db: Database.Database) {}

  /** M17: wire snapshot dependencies. Called once during server bootstrap. */
  configureSnapshot(reader: RawEntityReader, host: PluginHost): void {
    this.snapshotDeps = { reader, host };
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
    entityId: number,
    op: VersionOp,
    actor: ChangedBy,
    summary: string | null,
    serializerVersion: string
  ): VersionListItem {
    if (!this.snapshotDeps) {
      // Fallback: deps not yet wired. Store legacy domain object via createVersion.
      return this.createVersion(type, entityId, null, actor, summary, op, serializerVersion);
    }
    // For all ops (including delete), snapshot the entity *as it currently is*
    // (callers must call this BEFORE the row is deleted from its table).
    const rawEntity = this.snapshotDeps.reader.getEntityById(type, entityId);
    if (!rawEntity) {
      // Entity not found — fall back to last-known snapshot so tombstone has
      // restorable data. This path is only hit if a caller calls capture
      // post-delete (anti-pattern but defensive).
      const last = this.getLatestVersionForEntity(type, entityId);
      return this.createVersion(type, entityId, last?.data ?? null, actor, summary, op, serializerVersion);
    }
    const ctx = { reader: this.snapshotDeps.reader, depth: 0, maxDepth: 1 };
    const snapshot = this.snapshotDeps.host.snapshot(type, rawEntity, ctx);
    return this.createVersion(type, entityId, snapshot, actor, summary, op, serializerVersion);
  }

  /**
   * Capture a new version. M17 augments the row with `op` and
   * `serializer_version`; `release_id` always starts NULL and is assigned by
   * `releaseService.createRelease()`.
   */
  createVersion(
    entityType: EntityType,
    entityId: number,
    data: unknown,
    changedBy: ChangedBy,
    changeSummary?: string | null,
    op?: VersionOp,
    serializerVersion?: string | null
  ): VersionListItem {
    const next = this.nextVersionNumber(entityType, entityId);
    const inferredOp: VersionOp = op ?? (data === null ? 'delete' : (next === 1 ? 'create' : 'update'));
    const info = this.db
      .prepare(
        `INSERT INTO entity_version
           (entity_type, entity_id, version, data, changed_by, change_summary, op, serializer_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entityType,
        entityId,
        next,
        JSON.stringify(data),
        changedBy,
        changeSummary ?? null,
        inferredOp,
        serializerVersion ?? null
      );
    const row = this.db
      .prepare(`SELECT * FROM entity_version WHERE id = ?`)
      .get(info.lastInsertRowid) as VersionRow;
    return this.toListItem(row);
  }

  listVersions(entityType: EntityType, entityId: number): VersionListItem[] {
    const rows = this.db
      .prepare(
        `SELECT id, version, changed_by, change_summary, created_at, release_id, op
           FROM entity_version
          WHERE entity_type = ? AND entity_id = ?
          ORDER BY version DESC`
      )
      .all(entityType, entityId) as Array<{
        id: number;
        version: number;
        changed_by: string;
        change_summary: string | null;
        created_at: string;
        release_id: number | null;
        op: string | null;
      }>;
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      changedBy: r.changed_by as ChangedBy,
      changeSummary: r.change_summary,
      createdAt: r.created_at,
      ...(r.release_id !== null ? { releaseId: r.release_id } : {}),
      ...(r.op ? { op: r.op as VersionOp } : {}),
    }));
  }

  getVersion(entityType: EntityType, entityId: number, version: number): VersionDetail | null {
    const row = this.db
      .prepare(
        `SELECT * FROM entity_version
          WHERE entity_type = ? AND entity_id = ? AND version = ?`
      )
      .get(entityType, entityId, version) as VersionRow | undefined;
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
    entityId: number,
    releaseId?: number | null
  ): VersionDetail | null {
    let row: VersionRow | undefined;
    if (releaseId === undefined) {
      row = this.db
        .prepare(
          `SELECT * FROM entity_version
            WHERE entity_type = ? AND entity_id = ?
            ORDER BY version DESC LIMIT 1`
        )
        .get(entityType, entityId) as VersionRow | undefined;
    } else if (releaseId === null) {
      row = this.db
        .prepare(
          `SELECT * FROM entity_version
            WHERE entity_type = ? AND entity_id = ? AND release_id IS NULL
            ORDER BY version DESC LIMIT 1`
        )
        .get(entityType, entityId) as VersionRow | undefined;
    } else {
      row = this.db
        .prepare(
          `SELECT * FROM entity_version
            WHERE entity_type = ? AND entity_id = ? AND release_id IS NOT NULL AND release_id <= ?
            ORDER BY version DESC LIMIT 1`
        )
        .get(entityType, entityId, releaseId) as VersionRow | undefined;
    }
    return row ? this.toDetail(row) : null;
  }

  diff(
    entityType: EntityType,
    entityId: number,
    fromVersion: number,
    toVersion: number
  ): { from: VersionDetail; to: VersionDetail; changes: DiffEntry[] } {
    const from = this.getVersion(entityType, entityId, fromVersion);
    const to = this.getVersion(entityType, entityId, toVersion);
    if (!from || !to) throw new DomainError('NOT_FOUND', 'version not found');
    return { from, to, changes: computeDiff(from.data, to.data) };
  }

  private nextVersionNumber(entityType: EntityType, entityId: number): number {
    const row = this.db
      .prepare(
        `SELECT MAX(version) AS v FROM entity_version WHERE entity_type = ? AND entity_id = ?`
      )
      .get(entityType, entityId) as { v: number | null };
    return (row.v ?? 0) + 1;
  }

  private toListItem(row: VersionRow): VersionListItem {
    return {
      id: row.id,
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
      id: row.id,
      entityType: row.entity_type as EntityType,
      entityId: row.entity_id,
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
