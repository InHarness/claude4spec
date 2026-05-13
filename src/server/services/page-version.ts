/**
 * PageVersionService — append-only versioning of markdown pages (M17 Phase 4).
 * Parallel to VersionService but for filesystem pages. Each capture produces
 * one row in `page_version` with `release_id = NULL` (assigned by
 * `releaseService.createRelease`).
 */

import type Database from 'better-sqlite3';
import { PageSerializer, type PageSnapshotData } from './page-serializer.js';

export type PageChangedBy = 'user' | 'agent' | 'filesystem';
export type PageOp = 'create' | 'update' | 'delete';
/**
 * Dyskryminator źródła w `page_version`. `'page'` = pagesDir (M02), `'brief'` =
 * briefsDir (M21). Filtruje briefy z release snapshot/diff/restore — brief jest
 * artefaktem POST-release, nie częścią release'u (M17 spec, sekcja m17top001).
 */
export type PageKind = 'page' | 'brief';

export interface PageVersionListItem {
  id: number;
  path: string;
  version: number;
  op: PageOp;
  changedBy: PageChangedBy;
  releaseId: number | null;
  serializerVersion: string;
  createdAt: string;
  /** Human-readable opis zmiany. Null = brak (filesystem watcher, legacy). */
  changeSummary: string | null;
}

export interface PageVersionDetail extends PageVersionListItem {
  data: PageSnapshotData;
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
  change_summary: string | null;
}

export class PageVersionService {
  constructor(private db: Database.Database, private serializer: PageSerializer) {}

  /**
   * Capture a new version of a page. For `op = 'delete'`, the caller must
   * provide the last-known content (since the file is gone) — used to build
   * a tombstone snapshot.
   *
   * M21 (m02multidir): caller can pass an alternative `serializer` so this
   * single shared `PageVersionService` can capture both `pagesDir` and
   * `briefsDir` files. Each `PageSerializer` is bound to a specific
   * `PagesService` (= rootDir) at construction time; the path-keyed
   * `page_version` table itself is rootDir-agnostic.
   */
  async recordVersion(
    relPath: string,
    op: PageOp,
    changedBy: PageChangedBy,
    fallbackContent?: string,
    serializer?: PageSerializer,
    kind: PageKind = 'page',
    changeSummary?: string | null,
  ): Promise<PageVersionListItem> {
    const ser = serializer ?? this.serializer;
    const data: PageSnapshotData =
      op === 'delete' && fallbackContent !== undefined
        ? ser.snapshotFromContent(relPath, fallbackContent)
        : op === 'delete'
          ? this.synthesizeDeleteFromLastVersion(relPath)
          : await ser.snapshot(relPath);

    const next = this.nextVersionNumber(relPath);
    const summary = typeof changeSummary === 'string' && changeSummary.length > 0
      ? changeSummary
      : null;
    const info = this.db
      .prepare(
        `INSERT INTO page_version (path, version, data, serializer_version, op, changed_by, kind, change_summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(relPath, next, JSON.stringify(data), ser.version, op, changedBy, kind, summary);
    const row = this.db
      .prepare(`SELECT * FROM page_version WHERE id = ?`)
      .get(info.lastInsertRowid) as Row;
    return this.toListItem(row);
  }

  listVersions(relPath: string): PageVersionListItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM page_version WHERE path = ? ORDER BY version DESC`
      )
      .all(relPath) as Row[];
    return rows.map((r) => this.toListItem(r));
  }

  getVersion(relPath: string, version: number): PageVersionDetail | null {
    const row = this.db
      .prepare(`SELECT * FROM page_version WHERE path = ? AND version = ?`)
      .get(relPath, version) as Row | undefined;
    return row ? this.toDetail(row) : null;
  }

  /**
   * M17: latest captured version of a page at-or-before a given release.
   * Mirrors VersionService.getLatestVersionForEntity.
   */
  getLatestForPath(relPath: string, releaseId?: number | null): PageVersionDetail | null {
    let row: Row | undefined;
    if (releaseId === undefined) {
      row = this.db
        .prepare(
          `SELECT * FROM page_version WHERE path = ?
            ORDER BY version DESC LIMIT 1`
        )
        .get(relPath) as Row | undefined;
    } else if (releaseId === null) {
      row = this.db
        .prepare(
          `SELECT * FROM page_version WHERE path = ? AND release_id IS NULL
            ORDER BY version DESC LIMIT 1`
        )
        .get(relPath) as Row | undefined;
    } else {
      row = this.db
        .prepare(
          `SELECT * FROM page_version
            WHERE path = ? AND release_id IS NOT NULL AND release_id <= ?
            ORDER BY version DESC LIMIT 1`
        )
        .get(relPath, releaseId) as Row | undefined;
    }
    return row ? this.toDetail(row) : null;
  }

  /** True when this path has any captured version. Used by initial-sync hook. */
  hasAny(relPath: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM page_version WHERE path = ? LIMIT 1`)
      .get(relPath) as { 1: number } | undefined;
    return !!row;
  }

  /** Distinct paths captured at-or-before a given release (or all if undefined). */
  listPathsForRelease(releaseId: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT path FROM page_version WHERE release_id = ? ORDER BY path`
      )
      .all(releaseId) as Array<{ path: string }>;
    return rows.map((r) => r.path);
  }

  /**
   * Count page captures with `release_id IS NULL` (waiting to be picked up by
   * next release). Excludes briefs — briefs nigdy nie wpadają do release'u
   * (M21 spec, sekcja m21db0001).
   */
  countUnreleased(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM page_version WHERE release_id IS NULL AND kind = 'page'`)
      .get() as { n: number };
    return row.n;
  }

  /**
   * Atomic: assign all unreleased page_version rows (kind='page') to a release.
   * Returns the count of rows updated. Briefy (kind='brief') NIGDY nie wpadają
   * do release'u — mają własną oś czasu, niezależną od release timeline.
   */
  assignToRelease(releaseId: number): number {
    const info = this.db
      .prepare(`UPDATE page_version SET release_id = ? WHERE release_id IS NULL AND kind = 'page'`)
      .run(releaseId);
    return Number(info.changes);
  }

  private nextVersionNumber(relPath: string): number {
    const row = this.db
      .prepare(`SELECT MAX(version) AS v FROM page_version WHERE path = ?`)
      .get(relPath) as { v: number | null };
    return (row.v ?? 0) + 1;
  }

  private synthesizeDeleteFromLastVersion(relPath: string): PageSnapshotData {
    const last = this.getLatestForPath(relPath);
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

  private toListItem(row: Row): PageVersionListItem {
    return {
      id: row.id,
      path: row.path,
      version: row.version,
      op: row.op as PageOp,
      changedBy: row.changed_by as PageChangedBy,
      releaseId: row.release_id,
      serializerVersion: row.serializer_version,
      createdAt: row.created_at,
      changeSummary: row.change_summary,
    };
  }

  private toDetail(row: Row): PageVersionDetail {
    return {
      ...this.toListItem(row),
      data: JSON.parse(row.data) as PageSnapshotData,
    };
  }
}
