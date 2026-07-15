/**
 * FileVersionService — append-only versioning of markdown files (M17 Phase 4).
 * Parallel to VersionService but for filesystem files (pages, briefs, patches).
 * Each capture produces one row in `file_version` with `release_id = NULL`
 * (assigned by `releaseService.createRelease`).
 */

import type Database from 'better-sqlite3';
import { FileSerializer, type FileSnapshotData } from './file-serializer.js';

export type FileChangedBy = 'user' | 'agent' | 'filesystem';
export type FileOp = 'create' | 'update' | 'delete';

export interface FileVersionListItem {
  id: number;
  path: string;
  version: number;
  op: FileOp;
  changedBy: FileChangedBy;
  releaseId: number | null;
  serializerVersion: string;
  createdAt: string;
  /** 0.1.96: which root this version belongs to ('pages' | user slug | 'brief' | 'patch'). */
  rootId: string;
  /** Human-readable opis zmiany. Null = brak (filesystem watcher, legacy). */
  changeSummary: string | null;
}

export interface FileVersionDetail extends FileVersionListItem {
  data: FileSnapshotData;
}

interface Row {
  id: number;
  path: string;
  version: number;
  data: string;
  serializer_version: string;
  op: string;
  release_id: number | null;
  changed_by: string;
  created_at: string;
  rootId: string;
  change_summary: string | null;
}

export class FileVersionService {
  constructor(private db: Database.Database, private serializer: FileSerializer) {}

  /**
   * Capture a new version of a file. For `op = 'delete'`, the caller must
   * provide the last-known content (since the file is gone) — used to build
   * a tombstone snapshot.
   *
   * M21 (m02multidir): caller can pass an alternative `serializer` so this
   * single shared `FileVersionService` can capture files from any root. Each
   * `FileSerializer` is bound to a specific `PagesService` (= a root dir) at
   * construction time; the `file_version` table is keyed by `(rootId, path)`.
   *
   * 0.1.96: `rootId` is a dynamic string — the built-in `'pages'` root, a user
   * root slug, or the fixed `'brief'`/`'patch'` markers.
   */
  async recordVersion(
    relPath: string,
    op: FileOp,
    changedBy: FileChangedBy,
    fallbackContent?: string,
    serializer?: FileSerializer,
    rootId: string = 'pages',
    changeSummary?: string | null,
  ): Promise<FileVersionListItem> {
    const ser = serializer ?? this.serializer;
    const data: FileSnapshotData =
      op === 'delete' && fallbackContent !== undefined
        ? ser.snapshotFromContent(relPath, fallbackContent)
        : op === 'delete'
          ? this.synthesizeDeleteFromLastVersion(relPath, rootId)
          : await ser.snapshot(relPath);

    const next = this.nextVersionNumber(relPath, rootId);
    const summary = typeof changeSummary === 'string' && changeSummary.length > 0
      ? changeSummary
      : null;
    const info = this.db
      .prepare(
        `INSERT INTO file_version (path, version, data, serializer_version, op, changed_by, rootId, change_summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(relPath, next, JSON.stringify(data), ser.version, op, changedBy, rootId, summary);
    const row = this.db
      .prepare(`SELECT * FROM file_version WHERE id = ?`)
      .get(info.lastInsertRowid) as Row;
    return this.toListItem(row);
  }

  listVersions(relPath: string, rootId?: string): FileVersionListItem[] {
    // 0.1.96: `path` alone is no longer unique across roots — filter by rootId
    // when the caller knows it (page/brief/patch routes always do).
    const rootClause = rootId ? ' AND rootId = ?' : '';
    const rows = this.db
      .prepare(
        `SELECT * FROM file_version WHERE path = ?${rootClause} ORDER BY version DESC`
      )
      .all(...(rootId ? [relPath, rootId] : [relPath])) as Row[];
    return rows.map((r) => this.toListItem(r));
  }

  getVersion(relPath: string, version: number, rootId?: string): FileVersionDetail | null {
    const rootClause = rootId ? ' AND rootId = ?' : '';
    const row = this.db
      .prepare(`SELECT * FROM file_version WHERE path = ? AND version = ?${rootClause}`)
      .get(...(rootId ? [relPath, version, rootId] : [relPath, version])) as Row | undefined;
    return row ? this.toDetail(row) : null;
  }

  /**
   * M17: latest captured version of a file at-or-before a given release.
   * Mirrors VersionService.getLatestVersionForEntity.
   */
  getLatestForPath(
    relPath: string,
    releaseId?: number | null,
    rootId?: string,
  ): FileVersionDetail | null {
    // 0.1.96: optional `rootId` filter — distinguishes per-root timelines for the
    // same path. Omitted ⇒ legacy behaviour (latest regardless of root).
    const rootClause = rootId ? ' AND rootId = ?' : '';
    let row: Row | undefined;
    if (releaseId === undefined) {
      row = this.db
        .prepare(
          `SELECT * FROM file_version WHERE path = ?${rootClause}
            ORDER BY version DESC LIMIT 1`
        )
        .get(...(rootId ? [relPath, rootId] : [relPath])) as Row | undefined;
    } else if (releaseId === null) {
      row = this.db
        .prepare(
          `SELECT * FROM file_version WHERE path = ? AND release_id IS NULL${rootClause}
            ORDER BY version DESC LIMIT 1`
        )
        .get(...(rootId ? [relPath, rootId] : [relPath])) as Row | undefined;
    } else {
      row = this.db
        .prepare(
          `SELECT * FROM file_version
            WHERE path = ? AND release_id IS NOT NULL AND release_id <= ?${rootClause}
            ORDER BY version DESC LIMIT 1`
        )
        .get(...(rootId ? [relPath, releaseId, rootId] : [relPath, releaseId])) as Row | undefined;
    }
    return row ? this.toDetail(row) : null;
  }

  /** True when this (rootId, path) has any captured version. Used by initial-sync hook. */
  hasAny(relPath: string, rootId?: string): boolean {
    const rootClause = rootId ? ' AND rootId = ?' : '';
    const row = this.db
      .prepare(`SELECT 1 FROM file_version WHERE path = ?${rootClause} LIMIT 1`)
      .get(...(rootId ? [relPath, rootId] : [relPath])) as { 1: number } | undefined;
    return !!row;
  }

  /** Distinct paths captured at-or-before a given release (or all if undefined). */
  listPathsForRelease(releaseId: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT path FROM file_version WHERE release_id = ? ORDER BY path`
      )
      .all(releaseId) as Array<{ path: string }>;
    return rows.map((r) => r.path);
  }

  /**
   * Count file captures with `release_id IS NULL` (waiting to be picked up by
   * next release), restricted to the given releasable root ids. Briefs/patches
   * (markers 'brief'/'patch') fall out structurally — they are never releasable.
   */
  countUnreleased(releasableRootIds: string[]): number {
    if (releasableRootIds.length === 0) return 0;
    const placeholders = releasableRootIds.map(() => '?').join(', ');
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM file_version
          WHERE release_id IS NULL AND rootId IN (${placeholders})`
      )
      .get(...releasableRootIds) as { n: number };
    return row.n;
  }

  /**
   * Atomic: assign all unreleased file_version rows in the given releasable roots
   * to a release. Returns the count of rows updated. Briefs/patches never enter a
   * release — they carry non-releasable rootId markers and fall out structurally.
   */
  assignToRelease(releaseId: number, releasableRootIds: string[]): number {
    if (releasableRootIds.length === 0) return 0;
    const placeholders = releasableRootIds.map(() => '?').join(', ');
    const info = this.db
      .prepare(
        `UPDATE file_version SET release_id = ?
          WHERE release_id IS NULL AND rootId IN (${placeholders})`
      )
      .run(releaseId, ...releasableRootIds);
    return Number(info.changes);
  }

  /**
   * 0.1.96: version numbers are sequential per `(rootId, path)` — the same
   * relative path in different roots has independent timelines.
   */
  private nextVersionNumber(relPath: string, rootId: string): number {
    const row = this.db
      .prepare(`SELECT MAX(version) AS v FROM file_version WHERE path = ? AND rootId = ?`)
      .get(relPath, rootId) as { v: number | null };
    return (row.v ?? 0) + 1;
  }

  private synthesizeDeleteFromLastVersion(relPath: string, rootId: string): FileSnapshotData {
    const last = this.getLatestForPath(relPath, undefined, rootId);
    if (last) return last.data;
    // No prior version — we don't have content. Tombstone with empty content.
    return {
      path: relPath,
      content: '',
      frontmatter: {},
      anchors: [],
      xml_refs: [],
    };
  }

  private toListItem(row: Row): FileVersionListItem {
    return {
      id: row.id,
      path: row.path,
      version: row.version,
      op: row.op as FileOp,
      changedBy: row.changed_by as FileChangedBy,
      releaseId: row.release_id,
      serializerVersion: row.serializer_version,
      createdAt: row.created_at,
      rootId: row.rootId,
      changeSummary: row.change_summary,
    };
  }

  private toDetail(row: Row): FileVersionDetail {
    return {
      ...this.toListItem(row),
      data: JSON.parse(row.data) as FileSnapshotData,
    };
  }
}
