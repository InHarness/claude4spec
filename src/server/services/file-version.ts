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

/**
 * Expands a root identifier into the full chain of identifiers the SPACE has
 * answered under: `[currentId, ...formerIds]`. Injected rather than imported so
 * the service stays a pure database facade and tests can pin a chain.
 */
export type RootIdChainResolver = (rootId: string) => readonly string[];

const IDENTITY_CHAIN: RootIdChainResolver = (rootId) => [rootId];

export class FileVersionService {
  /**
   * 0.2.101: every read filters by the identifier CHAIN, never by one value.
   *
   * A rename changes a space's address but re-stamps nothing: rows written
   * before it keep the retired identifier, because overwriting them would erase
   * the address a version was actually born under. Continuity therefore lives on
   * the read side — `WHERE rootId IN (<chain>)` — and is what keeps a page's
   * version numbering from restarting at the rename boundary. The unique index
   * `(path, rootId, version)` still holds, since the retired and the live
   * identifier differ.
   */
  constructor(
    private db: Database.Database,
    private serializer: FileSerializer,
    private resolveChain: RootIdChainResolver = IDENTITY_CHAIN,
  ) {}

  /** The identifier chain of the space `rootId` names today. */
  private chainOf(rootId: string): string[] {
    const chain = this.resolveChain(rootId);
    return chain.length > 0 ? [...chain] : [rootId];
  }

  /** Expands each releasable root to its chain, de-duplicated. */
  private expandRoots(rootIds: readonly string[]): string[] {
    const out = new Set<string>();
    for (const id of rootIds) for (const link of this.chainOf(id)) out.add(link);
    return [...out];
  }

  /** `' AND rootId IN (?, ?)'` for a chain, `''` when the caller named no root. */
  private rootClause(chain: string[] | null): string {
    return chain === null ? '' : ` AND rootId IN (${chain.map(() => '?').join(', ')})`;
  }

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
   * 0.1.96: `rootId` is a dynamic string — a page-root identifier or one of the
   * fixed `'brief'`/`'patch'` markers. 0.2.101: it is the identifier the space
   * carried AT THE MOMENT OF THE WRITE, not necessarily its current one — a
   * rename never re-stamps existing rows, so reads follow the identifier CHAIN.
   */
  async recordVersion(
    relPath: string,
    op: FileOp,
    changedBy: FileChangedBy,
    // 0.2.101: `rootId` is REQUIRED — it used to default to `'pages'`, which in
    // a project whose base root was renamed would file the version under a space
    // that no longer exists. The two params before it stay positional and so
    // must be passed explicitly (as `undefined` where they do not apply).
    fallbackContent: string | undefined,
    serializer: FileSerializer | undefined,
    rootId: string,
    changeSummary?: string | null,
  ): Promise<FileVersionListItem | null> {
    const ser = serializer ?? this.serializer;
    const data: FileSnapshotData =
      op === 'delete' && fallbackContent !== undefined
        ? ser.snapshotFromContent(relPath, fallbackContent)
        : op === 'delete'
          ? this.synthesizeDeleteFromLastVersion(relPath, rootId)
          : await ser.snapshot(relPath);

    /**
     * 0.2.79 — a write that changes no content records NO row.
     *
     * The page axis of the same rule the entity axis applies in
     * `VersionService.captureEntitySnapshot`: "mutation" means a change of
     * CONTENT, so writing a page's existing bytes back makes no entry. This is
     * the capture phase's call, not the record-write primitive's — the write
     * chain (temp -> rename, write-backs) still runs unconditionally above.
     *
     * `content` is the whole comparison: `snapshot()` reads it byte-for-byte
     * (BOM and line endings preserved) and every other field of the snapshot —
     * `frontmatter`, `anchors`, `xml_refs` — is DERIVED from it by
     * `snapshotFromContent`. Identical content therefore means an identical
     * snapshot, and comparing the one authoritative field says so directly.
     *
     * Only an `update` is suppressed, and only against an existing predecessor
     * that is not itself a tombstone. A `create` has nothing to compare against;
     * a `delete` tombstone carries the last-known content that makes the page
     * restorable — and because it carries exactly that content, a page recreated
     * with its pre-delete bytes would compare equal to it. Suppressing THAT
     * write would leave the log's head reading `delete` for a file that exists,
     * which release restore takes as licence to delete it. A resurrection always
     * records a row.
     *
     * Applies regardless of `changedBy` — `user`, `agent` and `filesystem` are
     * all the same write here. Sitting at the single INSERT site is what makes
     * that true for the watcher-driven page capture and for the artifact
     * services (brief, plan, patch, release) in one place.
     *
     * Returning `null` is SUCCESS: no row was needed. It is not a refusal.
     */
    if (op === 'update') {
      const previous = this.getLatestForPath(relPath, undefined, rootId);
      if (previous && previous.op !== 'delete' && previous.data.content === data.content) return null;
    }

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
    // 0.2.101: by the whole chain, so a page's history reaches back across a
    // rename instead of starting again at the boundary.
    const chain = rootId ? this.chainOf(rootId) : null;
    const rows = this.db
      .prepare(
        `SELECT * FROM file_version WHERE path = ?${this.rootClause(chain)} ORDER BY version DESC`
      )
      .all(...(chain ? [relPath, ...chain] : [relPath])) as Row[];
    return rows.map((r) => this.toListItem(r));
  }

  getVersion(relPath: string, version: number, rootId?: string): FileVersionDetail | null {
    const chain = rootId ? this.chainOf(rootId) : null;
    const row = this.db
      .prepare(`SELECT * FROM file_version WHERE path = ? AND version = ?${this.rootClause(chain)}`)
      .get(...(chain ? [relPath, version, ...chain] : [relPath, version])) as Row | undefined;
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
    // 0.2.101: expanded to the space's identifier chain.
    const chain = rootId ? this.chainOf(rootId) : null;
    const rootClause = this.rootClause(chain);
    const roots = chain ?? [];
    let row: Row | undefined;
    if (releaseId === undefined) {
      row = this.db
        .prepare(
          `SELECT * FROM file_version WHERE path = ?${rootClause}
            ORDER BY version DESC LIMIT 1`
        )
        .get(relPath, ...roots) as Row | undefined;
    } else if (releaseId === null) {
      row = this.db
        .prepare(
          `SELECT * FROM file_version WHERE path = ? AND release_id IS NULL${rootClause}
            ORDER BY version DESC LIMIT 1`
        )
        .get(relPath, ...roots) as Row | undefined;
    } else {
      row = this.db
        .prepare(
          `SELECT * FROM file_version
            WHERE path = ? AND release_id IS NOT NULL AND release_id <= ?${rootClause}
            ORDER BY version DESC LIMIT 1`
        )
        .get(relPath, releaseId, ...roots) as Row | undefined;
    }
    return row ? this.toDetail(row) : null;
  }

  /**
   * 0.2.98 — removes ONE row this process just captured, by id.
   *
   * Not an editing verb of the log: the only caller is a compound operation
   * (`PlanService.create`) undoing its own half-finished effects after a later
   * step failed, so the refusal leaves no trace. Keyed by id rather than by
   * path, so a plan recreated under a path with older history loses only the
   * row this attempt wrote.
   */
  discardVersion(id: number): void {
    this.db.prepare(`DELETE FROM file_version WHERE id = ?`).run(id);
  }

  /** True when this (rootId, path) has any captured version. Used by initial-sync hook. */
  hasAny(relPath: string, rootId?: string): boolean {
    const chain = rootId ? this.chainOf(rootId) : null;
    const row = this.db
      .prepare(`SELECT 1 FROM file_version WHERE path = ?${this.rootClause(chain)} LIMIT 1`)
      .get(...(chain ? [relPath, ...chain] : [relPath])) as { 1: number } | undefined;
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
    // 0.2.101: each releasable root brings its retired identifiers along —
    // otherwise versions written before a rename would silently fall out of the
    // next release's scope.
    releasableRootIds = this.expandRoots(releasableRootIds);
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
    releasableRootIds = this.expandRoots(releasableRootIds);
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
   *
   * 0.2.101: counted over the whole identifier chain, so numbering does NOT
   * restart when a space is renamed. The unique index `(path, rootId, version)`
   * still holds: the new row carries the live identifier and the old ones the
   * retired, so no pair repeats.
   */
  private nextVersionNumber(relPath: string, rootId: string): number {
    const chain = this.chainOf(rootId);
    const row = this.db
      .prepare(
        `SELECT MAX(version) AS v FROM file_version WHERE path = ? AND rootId IN (${chain.map(() => '?').join(', ')})`,
      )
      .get(relPath, ...chain) as { v: number | null };
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
