/**
 * ReleaseService — public API M17. Single source of truth for release listing,
 * detail, snapshot, diff, and (Phase 6) restore. All other surfaces
 * (REST `/api/releases/*`, MCP `release-tools`, UI sidebar) are thin
 * adapters.
 *
 * Spec reference: `modules/m17-snapshots-releases.md` (`m17api001`,
 * `m17dom001`, `m17dcre01`).
 */

import type Database from 'better-sqlite3';
import type {
  ChangedBy,
  RawDelta,
  RawDeltaEntityChange,
  RawDeltaPageChange,
  Release,
  ReleaseCountBreakdown,
  ReleaseDetail,
  SpecSnapshot,
  SpecSnapshotEntityRow,
  SpecSnapshotPageRow,
} from '../../shared/entities.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { RawEntityReader, RawEntityType } from '../domain/raw-entity-reader.js';
import type { VersionService } from './versions.js';
import type { PageVersionService } from './page-version.js';
import type { PageSerializer } from './page-serializer.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';
import type { PagesWatcher } from '../fs/watcher.js';
import { DomainError } from './tags.js';
import { HostEntityWriter } from './entity-writer.js';
import type { RestoreContext, RestoreResult } from '../serialization/types.js';
import { readConfig } from '../config.js';
import {
  buildBundleArchive as buildBundleArchiveImpl,
  type BuildBundleResult,
} from './release-bundle.js';

const ENTITY_TYPES: RawEntityType[] = ['endpoint', 'dto', 'database-table', 'ui-view', 'ac'];
const ENTITY_TABLES: Record<RawEntityType, string> = {
  endpoint: 'endpoint',
  dto: 'dto',
  'database-table': 'database_table',
  'ui-view': 'ui_view',
  ac: 'ac',
};

interface ReleaseRow {
  id: number;
  name: string;
  description: string;
  created_by: string;
  created_at: string;
}

interface EntityVersionRow {
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

interface PageVersionRow {
  id: number;
  path: string;
  version: number;
  data: string;
  serializer_version: string;
  op: string;
  release_id: number | null;
  changed_by: string;
  created_at: string;
}

export interface RestoreEntityInput {
  type: RawEntityType;
  slug: string;
  releaseId: number | string;
}

export interface RestorePageInput {
  path: string;
  releaseId: number | string;
}

export interface RestoreSpecInput {
  releaseId: number | string;
}

export interface RestoreEntityResult {
  type: RawEntityType;
  slug: string;
  op: RestoreResult['op'];
  warnings?: string[];
}

export interface RestorePageResult {
  path: string;
  op: 'created' | 'updated' | 'deleted' | 'noop';
  warnings?: string[];
}

export interface RestoreSpecResult {
  releaseId: number;
  entityResults: RestoreEntityResult[];
  pageResults: RestorePageResult[];
}

export class ReleaseService {
  constructor(
    private db: Database.Database,
    private host: PluginHost,
    private versions: VersionService,
    private pageVersions: PageVersionService,
    private pageSerializer: PageSerializer,
    private rawReader: RawEntityReader,
    private tagsService: TagsService,
    private pagesService: PagesService,
    private watcher: PagesWatcher | null = null,
    private cwd: string = process.cwd(),
  ) {}

  // ─── Listing & retrieval ─────────────────────────────────────────────────

  listReleases(): Release[] {
    const rows = this.db
      .prepare(`SELECT * FROM spec_release ORDER BY created_at DESC, id DESC`)
      .all() as ReleaseRow[];
    return rows.map((r) => this.toRelease(r));
  }

  getRelease(idOrName: number | string): ReleaseDetail {
    const row = this.findReleaseRow(idOrName);
    if (!row) throw new DomainError('NOT_FOUND', `release '${idOrName}' not found`);
    const release = this.toRelease(row);
    return { ...release, countBreakdown: this.computeCountBreakdown(row.id) };
  }

  /**
   * Count of captures still queued at HEAD — entity_version + page_version rows
   * with `release_id IS NULL`. Drives the M25 "You have N unreleased changes"
   * banner shown only on the latest (mutable) release card.
   */
  countUnreleased(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM entity_version WHERE release_id IS NULL`)
      .get() as { n: number };
    return row.n + this.pageVersions.countUnreleased();
  }

  // ─── Mutations ───────────────────────────────────────────────────────────

  /**
   * Manual release creation (decyzja 9: zero auto-trigger). Validates
   * non-empty + UNIQUE name and non-empty description; in a single
   * transaction inserts spec_release and assigns all unreleased
   * entity_version + page_version rows.
   */
  createRelease(
    input: { name: string; description: string },
    actor: ChangedBy,
  ): ReleaseDetail {
    const name = (input.name ?? '').trim();
    const description = (input.description ?? '').trim();
    if (!name) throw new DomainError('VALIDATION', 'release name is required');
    if (!description) throw new DomainError('RELEASE_DESCRIPTION_REQUIRED', 'release description is required');

    const tx = this.db.transaction(() => {
      const conflict = this.db
        .prepare(`SELECT 1 FROM spec_release WHERE name = ?`)
        .get(name);
      if (conflict) throw new DomainError('RELEASE_NAME_CONFLICT', `release name '${name}' already exists`);

      const info = this.db
        .prepare(`INSERT INTO spec_release (name, description, created_by) VALUES (?, ?, ?)`)
        .run(name, description, actor);
      const releaseId = Number(info.lastInsertRowid);

      this.db
        .prepare(`UPDATE entity_version SET release_id = ? WHERE release_id IS NULL`)
        .run(releaseId);
      this.pageVersions.assignToRelease(releaseId);

      const row = this.db
        .prepare(`SELECT * FROM spec_release WHERE id = ?`)
        .get(releaseId) as ReleaseRow;
      return row;
    });
    const releaseRow = tx();
    const release = this.toRelease(releaseRow);
    return { ...release, countBreakdown: this.computeCountBreakdown(release.id) };
  }

  /**
   * Mutate the LATEST release only (decyzja 13: implicit last = mutable).
   * Older releases are frozen — `id != MAX(id)` ⇒ 409 RELEASE_FROZEN.
   * Optionally pulls all `release_id IS NULL` rows from entity_version /
   * page_version into this release (decyzja 14, no untie).
   */
  updateRelease(input: {
    idOrName: number | string;
    name?: string;
    description?: string;
    assignUnreleased?: boolean;
  }): ReleaseDetail {
    const tx = this.db.transaction(() => {
      const row = this.findReleaseRow(input.idOrName);
      if (!row) throw new DomainError('NOT_FOUND', `release '${input.idOrName}' not found`);

      const maxRow = this.db
        .prepare(`SELECT MAX(id) AS maxId FROM spec_release`)
        .get() as { maxId: number | null };
      if (row.id !== maxRow.maxId) {
        throw new DomainError(
          'RELEASE_FROZEN',
          `release '${row.name}' is frozen — only the latest release is mutable`,
        );
      }

      const nextName = input.name === undefined ? undefined : input.name.trim();
      const nextDescription = input.description === undefined ? undefined : input.description.trim();

      if (nextName !== undefined) {
        if (!nextName) throw new DomainError('VALIDATION', 'release name is required');
        if (nextName !== row.name) {
          const conflict = this.db
            .prepare(`SELECT 1 FROM spec_release WHERE name = ? AND id != ?`)
            .get(nextName, row.id);
          if (conflict) {
            throw new DomainError('RELEASE_NAME_CONFLICT', `release name '${nextName}' already exists`);
          }
        }
      }
      if (nextDescription !== undefined && !nextDescription) {
        throw new DomainError('RELEASE_DESCRIPTION_REQUIRED', 'release description is required');
      }

      if (nextName !== undefined || nextDescription !== undefined) {
        this.db
          .prepare(
            `UPDATE spec_release
             SET name = COALESCE(?, name),
                 description = COALESCE(?, description)
             WHERE id = ?`,
          )
          .run(nextName ?? null, nextDescription ?? null, row.id);
      }

      if (input.assignUnreleased === true) {
        this.db
          .prepare(`UPDATE entity_version SET release_id = ? WHERE release_id IS NULL`)
          .run(row.id);
        this.pageVersions.assignToRelease(row.id);
      }

      return row.id;
    });
    const releaseId = tx();
    return this.getRelease(releaseId);
  }

  // ─── Snapshots & diffs ───────────────────────────────────────────────────

  /**
   * Cumulative state at the end of a release: per (type, slug), the latest
   * entity_version row at-or-before `releaseId`. Each row carries
   * `op` + `data` (snapshot) + `serializer_version`.
   */
  getReleaseSnapshot(idOrName: number | string): SpecSnapshot {
    const row = this.findReleaseRow(idOrName);
    if (!row) throw new DomainError('NOT_FOUND', `release '${idOrName}' not found`);
    const release = this.toRelease(row);

    const entities: SpecSnapshotEntityRow[] = [];
    const serializerVersions: Record<string, string> = {};
    for (const type of ENTITY_TYPES) {
      const module = this.host.getEntity(type);
      if (!module) continue;
      serializerVersions[type] = module.serializer.version;
      const rows = this.latestEntityRowsAtOrBefore(type, row.id);
      for (const r of rows) {
        if (!r.op) continue;
        const slug = this.resolveSlug(type, r.entity_id, r.data);
        if (!slug) continue;
        entities.push({
          type,
          slug,
          op: r.op as 'create' | 'update' | 'delete',
          data: safeJsonParse(r.data),
        });
      }
    }
    serializerVersions.page = this.pageSerializer.version;

    const pages: SpecSnapshotPageRow[] = this.latestPageRowsAtOrBefore(row.id).map((p) => ({
      path: p.path,
      op: p.op as 'create' | 'update' | 'delete',
      data: safeJsonParse(p.data),
    }));

    return {
      release,
      serializer_versions: serializerVersions,
      entities,
      pages,
    };
  }

  /**
   * Structured semantic diff between two releases. For each entity that
   * differs (or pages that differ), computes per-plugin `host.diff(...)`
   * (entities) or `pageSerializer.diff(...)` (pages). Falls back to
   * default deep-diff when plugin doesn't override `diff`.
   *
   * `fromIdOrName === null` ⇒ initial brief: synthetic empty `from` snapshot.
   * Wszystkie encje/strony w `to` widoczne jako `op: 'create'`. Output
   * `RawDelta.from` jest wtedy `null` (sygnal dla M21 / UI).
   */
  getReleaseDiff(fromIdOrName: number | string | null, toIdOrName: number | string): RawDelta {
    const toRow = this.findReleaseRow(toIdOrName);
    if (!toRow) throw new DomainError('NOT_FOUND', `release '${toIdOrName}' not found`);

    const toSnap = this.getReleaseSnapshot(toRow.id);

    let fromSnap: SpecSnapshot;
    let fromMeta: { id: number; name: string } | null;
    if (fromIdOrName === null) {
      fromSnap = {
        release: { id: 0, name: '__initial__', description: '', createdBy: 'user', createdAt: '' },
        serializer_versions: toSnap.serializer_versions,
        entities: [],
        pages: [],
      };
      fromMeta = null;
    } else {
      const fromRow = this.findReleaseRow(fromIdOrName);
      if (!fromRow) throw new DomainError('NOT_FOUND', `release '${fromIdOrName}' not found`);
      fromSnap = this.getReleaseSnapshot(fromRow.id);
      fromMeta = { id: fromRow.id, name: fromRow.name };
    }

    const entityChanges: RawDeltaEntityChange[] = [];
    // Index by `${type}|${slug}` for both sides
    const aMap = new Map<string, SpecSnapshotEntityRow>();
    for (const e of fromSnap.entities) aMap.set(`${e.type}|${e.slug}`, e);
    const bMap = new Map<string, SpecSnapshotEntityRow>();
    for (const e of toSnap.entities) bMap.set(`${e.type}|${e.slug}`, e);
    const allKeys = new Set([...aMap.keys(), ...bMap.keys()]);

    for (const key of allKeys) {
      const a = aMap.get(key);
      const b = bMap.get(key);
      const sample = (a ?? b)!;
      const aData = a && a.op !== 'delete' ? a.data : null;
      const bData = b && b.op !== 'delete' ? b.data : null;
      const diff = this.host.diff(sample.type, aData, bData, sample.slug);
      if (diff.op === 'noop') continue;
      const aVer = fromSnap.serializer_versions[sample.type] ?? null;
      const bVer = toSnap.serializer_versions[sample.type] ?? null;
      entityChanges.push({
        type: diff.type,
        slug: diff.slug,
        op: diff.op,
        ...(diff.changes ? { changes: diff.changes } : {}),
        ...(diff.raw ? { raw: diff.raw } : {}),
        ...(aVer !== bVer ? { _serializerVersionMismatch: { type: sample.type, from: aVer, to: bVer } } : {}),
      });
    }

    const pageChanges: RawDeltaPageChange[] = [];
    const aPagesMap = new Map(fromSnap.pages.map((p) => [p.path, p]));
    const bPagesMap = new Map(toSnap.pages.map((p) => [p.path, p]));
    const allPaths = new Set([...aPagesMap.keys(), ...bPagesMap.keys()]);
    for (const path of allPaths) {
      const a = aPagesMap.get(path);
      const b = bPagesMap.get(path);
      const aData = a && a.op !== 'delete' ? (a.data as ReturnType<PageSerializer['snapshotFromContent']>) : null;
      const bData = b && b.op !== 'delete' ? (b.data as ReturnType<PageSerializer['snapshotFromContent']>) : null;
      const diff = this.pageSerializer.diff(aData, bData, path);
      if (diff.op === 'noop') continue;
      pageChanges.push({
        path: diff.path,
        op: diff.op,
        added_sections: diff.added_sections,
        removed_sections: diff.removed_sections,
        modified_sections: diff.modified_sections,
        moved_sections: diff.moved_sections,
        frontmatter_diff: diff.frontmatter_diff,
        xml_refs_diff: diff.xml_refs_diff,
      });
    }

    return {
      from: fromMeta,
      to: { id: toRow.id, name: toRow.name },
      entities: entityChanges,
      pages: pageChanges,
    };
  }

  // ─── Restore (M17 Phase 6) ───────────────────────────────────────────────

  /**
   * Restore a single entity to its state at the target release. Append-only:
   * the restore generates a normal mutation through write-API, producing a
   * new entity_version row with `release_id = NULL`. Idempotent (decyzja 11):
   * re-running restore on already-matching state yields op='noop'.
   */
  restoreEntity(input: RestoreEntityInput, actor: ChangedBy = 'user'): RestoreEntityResult {
    const releaseRow = this.findReleaseRow(input.releaseId);
    if (!releaseRow) throw new DomainError('NOT_FOUND', `release '${input.releaseId}' not found`);

    const targetRow = this.latestEntityRowForSlug(input.type, input.slug, releaseRow.id);
    const writer = new HostEntityWriter(this.host, this.tagsService);
    const restoreCtx: RestoreContext = {
      reader: this.rawReader,
      writer,
      releaseId: releaseRow.id,
      actor,
    };

    if (!targetRow || targetRow.op === 'delete' || targetRow.data === 'null') {
      // Snapshot says entity didn't exist (or was deleted) at this release.
      const deleted = writer.delete(input.type, input.slug, actor);
      return {
        type: input.type,
        slug: input.slug,
        op: deleted.deleted ? 'deleted' : 'noop',
      };
    }

    const targetSnapshot = safeJsonParse(targetRow.data);
    // Compare to current state — if identical, no-op.
    const current = this.rawReader.getEntity(input.type, input.slug);
    if (current) {
      const currentSnapshot = this.host.snapshot(input.type, current, {
        reader: this.rawReader,
        depth: 0,
        maxDepth: 1,
      });
      const diff = this.host.diff(input.type, currentSnapshot, targetSnapshot, input.slug);
      if (diff.op === 'noop') {
        return { type: input.type, slug: input.slug, op: 'noop' };
      }
    }

    const result = this.host.restore(input.type, targetSnapshot, restoreCtx);
    return {
      type: input.type,
      slug: input.slug,
      op: result.op,
      ...(result.warnings && result.warnings.length ? { warnings: result.warnings } : {}),
    };
  }

  /**
   * Restore a single page. Looks up the latest page_version snapshot at-or-
   * before the release and writes its content via PagesService. The watcher
   * suppresses the resulting chokidar event; the REST capture path then
   * records a fresh page_version row with `release_id = NULL` and
   * `changed_by = 'user'`.
   */
  async restorePage(input: RestorePageInput, _actor: ChangedBy = 'user'): Promise<RestorePageResult> {
    const releaseRow = this.findReleaseRow(input.releaseId);
    if (!releaseRow) throw new DomainError('NOT_FOUND', `release '${input.releaseId}' not found`);
    const target = this.pageVersions.getLatestForPath(input.path, releaseRow.id);
    if (!target || target.op === 'delete') {
      // Snapshot says page didn't exist — delete current file if present.
      if (await this.pagesService.exists(input.path)) {
        this.watcher?.suppress(input.path);
        await this.pagesService.remove(input.path);
        await this.pageVersions.recordVersion(input.path, 'delete', 'user');
        return { path: input.path, op: 'deleted' };
      }
      return { path: input.path, op: 'noop' };
    }

    const data = target.data;
    const exists = await this.pagesService.exists(input.path);
    let currentContent: string | null = null;
    if (exists) {
      try {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        currentContent = await fs.readFile(path.join(this.pagesService.root, input.path), 'utf-8');
      } catch {
        currentContent = null;
      }
    }
    if (currentContent === data.content) {
      return { path: input.path, op: 'noop' };
    }

    this.watcher?.suppress(input.path);
    // Write raw content directly — bypass frontmatter splitting so byte-for-byte fidelity is preserved.
    const fsP = await import('node:fs/promises');
    const pathMod = await import('node:path');
    const abs = pathMod.join(this.pagesService.root, input.path);
    await fsP.mkdir(pathMod.dirname(abs), { recursive: true });
    await fsP.writeFile(abs, data.content, 'utf-8');
    const op: 'created' | 'updated' = exists ? 'updated' : 'created';
    await this.pageVersions.recordVersion(input.path, op === 'created' ? 'create' : 'update', 'user');
    return { path: input.path, op };
  }

  /**
   * Restore the entire spec to a release. Topological sort: DTO first
   * (Endpoint references DTO via linked_dtos), then everything else, then
   * pages. Each step generates normal mutations → all visible in timeline.
   */
  async restoreSpec(input: RestoreSpecInput, actor: ChangedBy = 'user'): Promise<RestoreSpecResult> {
    const releaseRow = this.findReleaseRow(input.releaseId);
    if (!releaseRow) throw new DomainError('NOT_FOUND', `release '${input.releaseId}' not found`);
    const releaseId = releaseRow.id;

    const entityResults: RestoreEntityResult[] = [];
    const pageResults: RestorePageResult[] = [];

    // Topological order — DTO before Endpoint (Endpoint linked_dtos references DTO slugs).
    const order: RawEntityType[] = ['dto', 'database-table', 'ui-view', 'endpoint'];

    for (const type of order) {
      // Slugs in target release
      const targetRows = this.latestEntityRowsAtOrBefore(type, releaseId);
      const targetSlugs = new Set<string>();
      for (const r of targetRows) {
        if (!r.op || r.op === 'delete' || r.data === 'null') continue;
        const slug = this.resolveSlug(type, r.entity_id, r.data);
        if (slug) targetSlugs.add(slug);
      }
      // Restore each slug present in target
      for (const slug of targetSlugs) {
        try {
          entityResults.push(this.restoreEntity({ type, slug, releaseId }, actor));
        } catch (err) {
          entityResults.push({
            type,
            slug,
            op: 'noop',
            warnings: [`restore failed: ${(err as Error).message}`],
          });
        }
      }
      // Delete extras: entities currently present but not in target
      const currentSlugs = new Set(this.rawReader.listSlugs(type));
      for (const slug of currentSlugs) {
        if (targetSlugs.has(slug)) continue;
        // Was this entity present in any earlier release? If so, target says delete.
        // If never released (entity created after target release), still delete to
        // align state with target.
        try {
          entityResults.push(this.restoreEntity({ type, slug, releaseId }, actor));
        } catch (err) {
          entityResults.push({
            type,
            slug,
            op: 'noop',
            warnings: [`delete-restore failed: ${(err as Error).message}`],
          });
        }
      }
    }

    // Pages
    const targetPagePaths = this.pageVersions.listPathsForRelease(releaseId);
    const allCurrentPaths = new Set(await this.pagesService.listMarkdownFiles());
    const pathsToRestore = new Set([...targetPagePaths, ...allCurrentPaths]);
    for (const path of pathsToRestore) {
      try {
        pageResults.push(await this.restorePage({ path, releaseId }, actor));
      } catch (err) {
        pageResults.push({
          path,
          op: 'noop',
          warnings: [`restore failed: ${(err as Error).message}`],
        });
      }
    }

    return { releaseId, entityResults, pageResults };
  }

  // ─── Portable bundle (transport format — M25 push / M26 import) ────────────

  /**
   * Build a portable `tar.gz` of release N, deterministically reconstructed
   * from the versioning tables (`getReleaseSnapshot`) + sanitized `config.json`.
   * Does NOT read `pagesDir` on disk nor entity HEADs. The returned `tarGzPath`
   * points at a temp file the CALLER owns (M25 deletes after streaming to
   * remote); the internal working dir is cleaned up before returning.
   */
  async buildBundleArchive(releaseId: number): Promise<BuildBundleResult> {
    const snapshot = this.getReleaseSnapshot(releaseId); // throws NOT_FOUND if missing
    const release = this.getRelease(releaseId);
    return buildBundleArchiveImpl(snapshot, release, readConfig(this.cwd));
  }

  /**
   * CONTRACT-ONLY in v1 — implementation deferred to M26 (Release Import,
   * `c4s import <bundle>`). The signature is public so the bidirectional bundle
   * contract is fixed now (write here, read in M26).
   *
   * M26 read-direction algorithm (do not implement here):
   *   1. Parse `manifest.json` FIRST (first tar entry). Missing → throw
   *      `BUNDLE_MANIFEST_MISSING`. `bundleSchemaVersion` > max supported →
   *      throw `BUNDLE_SCHEMA_UNSUPPORTED { foundVersion, maxSupportedVersion }`.
   *   2. Optionally verify SHA-256 (caller supplies expected hash, e.g. from an
   *      M25 push header). Mismatch → throw `BUNDLE_HASH_MISMATCH { expected, actual }`.
   *   3. Read `config.json` via a `bundleSchemaVersion`-aware parser; unknown
   *      fields → warn + ignore (forward-compat).
   *   4. Stream `pages/<path>.md`; reject `..` / absolute / null-byte paths →
   *      throw `BUNDLE_MALFORMED_ENTRY { path, reason }`.
   *   5. Stream `entities/<typePlural>.json`; plural absent from local
   *      `config.entities` → throw `BUNDLE_UNKNOWN_ENTITY_TYPE { type }`.
   *   6. Compose a `SpecSnapshot` (same shape as `getReleaseSnapshot`). M26 owns
   *      what to do with it (UPSERT restore / dry-run diff / read-only mount).
   * All errors are structured (code + payload), never bare strings.
   */
  async restoreBundleArchive(_stream: NodeJS.ReadableStream): Promise<SpecSnapshot> {
    throw new Error('NOT_IMPLEMENTED — restoreBundleArchive deferred to M26 (Release Import)');
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private findReleaseRow(idOrName: number | string): ReleaseRow | null {
    if (typeof idOrName === 'number') {
      return this.db.prepare(`SELECT * FROM spec_release WHERE id = ?`).get(idOrName) as ReleaseRow | undefined ?? null;
    }
    const asNum = Number(idOrName);
    if (!Number.isNaN(asNum) && /^\d+$/.test(idOrName)) {
      const byId = this.db.prepare(`SELECT * FROM spec_release WHERE id = ?`).get(asNum) as ReleaseRow | undefined;
      if (byId) return byId;
    }
    return this.db.prepare(`SELECT * FROM spec_release WHERE name = ?`).get(idOrName) as ReleaseRow | undefined ?? null;
  }

  private toRelease(row: ReleaseRow): Release {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      createdBy: row.created_by as ChangedBy,
      createdAt: row.created_at,
    };
  }

  private computeCountBreakdown(releaseId: number): ReleaseCountBreakdown {
    const entityCounts: Record<string, number> = {};
    let entityTotal = 0;
    const rows = this.db
      .prepare(
        `SELECT entity_type, COUNT(*) AS n FROM entity_version WHERE release_id = ? GROUP BY entity_type`,
      )
      .all(releaseId) as Array<{ entity_type: string; n: number }>;
    for (const r of rows) {
      entityCounts[r.entity_type] = r.n;
      entityTotal += r.n;
    }
    const pageRow = this.db
      .prepare(`SELECT COUNT(*) AS n FROM page_version WHERE release_id = ? AND kind = 'page'`)
      .get(releaseId) as { n: number };
    return {
      entities: entityCounts,
      pages: pageRow.n,
      total: entityTotal + pageRow.n,
    };
  }

  /**
   * Find the latest entity_version row matching a slug at-or-before
   * `releaseId`. Slug lookup is index-by-data-slug since legacy rows may
   * predate slug presence in `data`. Returns null if no row found.
   */
  private latestEntityRowForSlug(
    type: RawEntityType,
    slug: string,
    releaseId: number,
  ): EntityVersionRow | null {
    // Resolve current entity id by slug (if entity still exists).
    const currentId = this.host.resolveEntityId(type, slug);
    if (currentId != null) {
      const row = this.db
        .prepare(
          `SELECT * FROM entity_version
            WHERE entity_type = ? AND entity_id = ?
              AND release_id IS NOT NULL AND release_id <= ?
            ORDER BY version DESC LIMIT 1`,
        )
        .get(type, currentId, releaseId) as EntityVersionRow | undefined;
      if (row) return row;
    }
    // Entity no longer exists or never existed under this slug — scan rows
    // in the target release range and match against snapshot data.slug.
    const rows = this.db
      .prepare(
        `SELECT * FROM entity_version
          WHERE entity_type = ?
            AND release_id IS NOT NULL AND release_id <= ?
          ORDER BY entity_id, version DESC`,
      )
      .all(type, releaseId) as EntityVersionRow[];
    const seen = new Set<number>();
    for (const r of rows) {
      if (seen.has(r.entity_id)) continue;
      seen.add(r.entity_id);
      const rowSlug = this.resolveSlug(type, r.entity_id, r.data);
      if (rowSlug === slug) return r;
    }
    return null;
  }

  /**
   * For each entity_id seen in the release range, return the latest version
   * row at-or-before `releaseId`. Rows where the underlying entity table has
   * since been DELETEd appear as op='delete' tombstones (data carries the
   * last snapshot before deletion).
   */
  private latestEntityRowsAtOrBefore(type: RawEntityType, releaseId: number): EntityVersionRow[] {
    return this.db
      .prepare(
        `SELECT ev1.* FROM entity_version ev1
          WHERE ev1.entity_type = ?
            AND ev1.release_id IS NOT NULL AND ev1.release_id <= ?
            AND ev1.version = (
              SELECT MAX(ev2.version) FROM entity_version ev2
               WHERE ev2.entity_type = ev1.entity_type
                 AND ev2.entity_id = ev1.entity_id
                 AND ev2.release_id IS NOT NULL AND ev2.release_id <= ?
            )
          ORDER BY ev1.entity_id`,
      )
      .all(type, releaseId, releaseId) as EntityVersionRow[];
  }

  private latestPageRowsAtOrBefore(releaseId: number): PageVersionRow[] {
    return this.db
      .prepare(
        `SELECT pv1.* FROM page_version pv1
          WHERE pv1.kind = 'page'
            AND pv1.release_id IS NOT NULL AND pv1.release_id <= ?
            AND pv1.version = (
              SELECT MAX(pv2.version) FROM page_version pv2
               WHERE pv2.kind = 'page'
                 AND pv2.path = pv1.path
                 AND pv2.release_id IS NOT NULL AND pv2.release_id <= ?
            )
          ORDER BY pv1.path`,
      )
      .all(releaseId, releaseId) as PageVersionRow[];
  }

  /**
   * Resolve a slug for an entity_version row. Snapshot data carries `slug`
   * directly (post-M17 rows). For pre-M17 legacy rows, fall back to the
   * underlying table — but the table may be deleted. Return null in that
   * case (caller skips the entry).
   */
  private resolveSlug(type: RawEntityType, entityId: number, dataJson: string): string | null {
    try {
      const parsed = JSON.parse(dataJson);
      if (parsed && typeof parsed === 'object' && typeof (parsed as { slug?: unknown }).slug === 'string') {
        return (parsed as { slug: string }).slug;
      }
    } catch {
      /* fall through */
    }
    // Legacy fallback: read slug from the entity table directly.
    const table = ENTITY_TABLES[type];
    const row = this.db.prepare(`SELECT slug FROM ${table} WHERE id = ?`).get(entityId) as
      | { slug: string }
      | undefined;
    return row?.slug ?? null;
  }
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
