/**
 * ReleaseService — public API M17. Single source of truth for release listing,
 * detail, snapshot, diff, and (Phase 6) restore. All other surfaces
 * (REST `/api/releases/*`, MCP `release-tools`, UI sidebar) are thin
 * adapters.
 *
 * Spec reference: `modules/m17-snapshots-releases.md` (`m17api001`,
 * `m17dom001`, `m17dcre01`).
 */

import nodeFs from 'node:fs';
import nodeOs from 'node:os';
import nodePath from 'node:path';
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
import { toRawDeltaEntityChange } from '../serialization/snapshot.js';
import { readConfig, builtinPagesRoot } from '../config.js';
import { slugify } from '../../shared/slug.js';
import { hasDotSegment } from '../../shared/page-files.js';
import { toReleaseFileData, type ReleaseFileStore } from './release-store.js';
import type { GitService } from './git.js';
import type { PageSnapshotData } from './page-serializer.js';
import {
  buildBundleArchive as buildBundleArchiveImpl,
  extractBundleStream,
  BUNDLE_SCHEMA_VERSION,
  PLURAL_FILE_TO_ENTITY_TYPE,
  type BuildBundleResult,
  type BundleManifest,
  type BundlePageInput,
  type BundleRoot,
} from './release-bundle.js';

const ENTITY_TYPES: RawEntityType[] = ['endpoint', 'dto', 'database-table', 'ui-view', 'ac'];

/**
 * 0.1.122: release names reserved by the `:to`/`:from` diff-route sentinel
 * (`GET /api/releases/:from/diff/current`). Single source of truth — checked
 * by `createRelease`/`updateRelease` AND by `ReleaseIndexerService` (which
 * upserts `spec_release` rows straight from on-disk release-identity files,
 * a write path the two API-layer methods never see).
 */
const RESERVED_RELEASE_NAMES = new Set(['current']);

export function isReservedReleaseName(name: string): boolean {
  return RESERVED_RELEASE_NAMES.has(name);
}

/** Recursively list files under `dir` as posix-style relative paths (read direction). */
function listBundleFiles(dir: string): string[] {
  if (!nodeFs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    for (const entry of nodeFs.readdirSync(abs, { withFileTypes: true })) {
      const childAbs = nodePath.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else out.push(childRel);
    }
  };
  walk(dir, '');
  return out;
}

/** Reject `..` / absolute / null-byte bundle entry paths (M27 §1 step 4). */
function assertSafeBundlePath(rel: string): void {
  if (rel.includes('\0') || nodePath.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) {
    throw new DomainError('BUNDLE_MALFORMED_ENTRY', `unsafe bundle entry path '${rel}'`);
  }
}

interface ReleaseRow {
  id: number;
  name: string;
  slug: string | null;
  description: string;
  created_by: string;
  created_at: string;
}

interface EntityVersionRow {
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
  rootId: string;
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
    /**
     * 0.1.96: ids of the releasable roots (config.roots filtered by `releasable`).
     * Only these roots' `page_version` rows enter releases/bundles/diffs; brief/
     * patch markers and non-releasable user roots fall out structurally.
     */
    private releasableRootIds: string[] = ['pages'],
    /**
     * 0.1.118: absolute dirs of the releasable roots, same order/index as
     * `releasableRootIds` — needed to map a git-diff path back to a rootId in
     * the git-anchored `getReleaseDiff` branch.
     */
    private releasableRootDirs: string[] = [],
  ) {}

  /**
   * M29: restoring an entity to a past version mutates the index — its committed
   * file must follow, else the next reindex reverts the restore (files win).
   * Wired post-construction (the store is built later in boot).
   */
  private entityStore: import('./entity-store.js').EntityStore | null = null;
  setEntityStore(store: import('./entity-store.js').EntityStore): void {
    this.entityStore = store;
  }

  /**
   * 0.1.118: writes the on-disk release-identity file (`<releasesDir>/<slug>.json`)
   * on create/update. Wired post-construction (the store is built later in boot,
   * same reasoning as `setEntityStore`).
   */
  private releaseStore: ReleaseFileStore | null = null;
  setReleaseStore(store: ReleaseFileStore): void {
    this.releaseStore = store;
  }

  /**
   * 0.1.118: needed by the git-anchored `getReleaseDiff` branch to resolve
   * release-file commits. Siblings in project-context.ts, never linked before.
   */
  private gitService: GitService | null = null;
  setGitService(service: GitService): void {
    this.gitService = service;
  }

  // ─── Listing & retrieval ─────────────────────────────────────────────────

  listReleases(): Release[] {
    const rows = this.db
      .prepare(`SELECT * FROM spec_release ORDER BY created_at DESC, id DESC`)
      .all() as ReleaseRow[];
    return rows.map((r) => this.toRelease(r));
  }

  /** 0.1.104: name of the most recent release, or `null` if none exist yet. */
  getLatestReleaseName(): string | null {
    const row = this.db
      .prepare(`SELECT name FROM spec_release ORDER BY created_at DESC, id DESC LIMIT 1`)
      .get() as { name: string } | undefined;
    return row?.name ?? null;
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
    return row.n + this.pageVersions.countUnreleased(this.releasableRootIds);
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
    if (isReservedReleaseName(name)) throw new DomainError('RELEASE_NAME_RESERVED', `release name '${name}' is reserved`);
    if (!description) throw new DomainError('RELEASE_DESCRIPTION_REQUIRED', 'release description is required');

    const slug = slugify(name);

    const tx = this.db.transaction(() => {
      const conflict = this.db
        .prepare(`SELECT 1 FROM spec_release WHERE name = ?`)
        .get(name);
      if (conflict) throw new DomainError('RELEASE_NAME_CONFLICT', `release name '${name}' already exists`);
      // 0.1.118: two different names can slugify to the same string, which
      // would collide on disk (`<releasesDir>/<slug>.json`) even though the
      // DB-unique `name` differs. Reject before insert, same posture as the
      // name-uniqueness check above.
      const slugConflict = this.db
        .prepare(`SELECT name FROM spec_release WHERE slug = ?`)
        .get(slug) as { name: string } | undefined;
      if (slugConflict) {
        throw new DomainError(
          'RELEASE_SLUG_CONFLICT',
          `release name '${name}' resolves to the same identifier as existing release '${slugConflict.name}'`,
        );
      }

      const info = this.db
        .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
        .run(name, slug, description, actor);
      const releaseId = Number(info.lastInsertRowid);

      this.db
        .prepare(`UPDATE entity_version SET release_id = ? WHERE release_id IS NULL`)
        .run(releaseId);
      this.pageVersions.assignToRelease(releaseId, this.releasableRootIds);

      const row = this.db
        .prepare(`SELECT * FROM spec_release WHERE id = ?`)
        .get(releaseId) as ReleaseRow;
      return row;
    });
    const releaseRow = tx();
    // 0.1.118: write the on-disk identity file AFTER the SQLite transaction
    // commits (best-effort — a release-store write failure must not undo an
    // already-committed release; log and continue, mirroring the codebase's
    // "never block a committed mutation on a secondary side-effect" posture).
    if (this.releaseStore) {
      try {
        this.releaseStore.write(slug, toReleaseFileData(releaseRow, slug, this.releasableRootIds));
      } catch (err) {
        console.error(`[release] failed to write release file for '${name}':`, err);
      }
    }
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
      const oldSlug = row.slug;
      let nextSlug: string | undefined;

      if (nextName !== undefined) {
        if (!nextName) throw new DomainError('VALIDATION', 'release name is required');
        // Only reject 'current' when the name is actually CHANGING to it — a
        // no-op resubmit of an already-reserved legacy name (pre-migration
        // data, or synced from disk) must not block unrelated edits like a
        // description update (0.1.122 code-review fix).
        if (nextName !== row.name) {
          if (isReservedReleaseName(nextName)) {
            throw new DomainError('RELEASE_NAME_RESERVED', `release name '${nextName}' is reserved`);
          }
          const conflict = this.db
            .prepare(`SELECT 1 FROM spec_release WHERE name = ? AND id != ?`)
            .get(nextName, row.id);
          if (conflict) {
            throw new DomainError('RELEASE_NAME_CONFLICT', `release name '${nextName}' already exists`);
          }
          nextSlug = slugify(nextName);
          if (nextSlug !== oldSlug) {
            const slugConflict = this.db
              .prepare(`SELECT name FROM spec_release WHERE slug = ? AND id != ?`)
              .get(nextSlug, row.id) as { name: string } | undefined;
            if (slugConflict) {
              throw new DomainError(
                'RELEASE_SLUG_CONFLICT',
                `release name '${nextName}' resolves to the same identifier as existing release '${slugConflict.name}'`,
              );
            }
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
                 slug = COALESCE(?, slug),
                 description = COALESCE(?, description)
             WHERE id = ?`,
          )
          .run(nextName ?? null, nextSlug ?? null, nextDescription ?? null, row.id);
      }

      if (input.assignUnreleased === true) {
        this.db
          .prepare(`UPDATE entity_version SET release_id = ? WHERE release_id IS NULL`)
          .run(row.id);
        this.pageVersions.assignToRelease(row.id, this.releasableRootIds);
      }

      const finalRow = this.db
        .prepare(`SELECT * FROM spec_release WHERE id = ?`)
        .get(row.id) as ReleaseRow;
      return { releaseId: row.id, oldSlug, finalRow };
    });
    const { releaseId, oldSlug, finalRow } = tx();
    // 0.1.118: keep the on-disk identity file in sync — a rename moves it
    // (remove old + write new), a description-only edit just rewrites content
    // at the same slug. Legacy releases (no slug — born before this feature,
    // never renamed since) are left without a file, tolerated gracefully.
    if (this.releaseStore && finalRow.slug) {
      try {
        if (oldSlug && oldSlug !== finalRow.slug) {
          this.releaseStore.remove(oldSlug);
        }
        this.releaseStore.write(
          finalRow.slug,
          toReleaseFileData(finalRow, finalRow.slug, this.releasableRootIds),
        );
      } catch (err) {
        console.error(`[release] failed to sync release file for '${finalRow.name}':`, err);
      }
    }
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
    return this.buildSnapshot(this.toRelease(row), row.id);
  }

  /**
   * 0.1.122: cumulative state right now — per (type, slug)/(rootId, path), the
   * latest entity_version/page_version row with NO upper bound on
   * `release_id`, including `release_id IS NULL` (unreleased/dangling)
   * mutations. Same *version-tables-latest* source `getUnreleasedDiff` uses
   * as its "to" side.
   */
  getCurrentSnapshot(): SpecSnapshot {
    return this.buildSnapshot(
      { id: 0, name: '__current__', description: '', createdBy: 'user', createdAt: '' },
      null,
    );
  }

  /**
   * Shared snapshot-building body for `getReleaseSnapshot`/`getCurrentSnapshot`
   * (0.1.122 code-review fix — was duplicated between the two): per (type, slug)
   * the latest entity_version row, and per (rootId, path) the latest page_version
   * row, either bounded at-or-before `releaseId` or (releaseId === null) unbounded.
   */
  private buildSnapshot(release: Release, releaseId: number | null): SpecSnapshot {
    const entities: SpecSnapshotEntityRow[] = [];
    const serializerVersions: Record<string, string> = {};
    for (const type of ENTITY_TYPES) {
      const module = this.host.getEntity(type);
      if (!module) continue;
      serializerVersions[type] = module.serializer.version;
      const rows = this.latestEntityRowsAtOrBefore(type, releaseId);
      for (const r of rows) {
        if (!r.op) continue;
        const slug = r.entity_slug;
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

    const pages: SpecSnapshotPageRow[] = this.latestPageRowsAtOrBefore(releaseId).map((p) => ({
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
   * 0.1.118: git-anchored diff branch. Mutually exclusive with the SQL path
   * below (confirmed against spec AC — never merged): `null` means "not
   * usable" and the caller falls through to the existing SQL computation.
   * Usable only when BOTH releases have a slug (legacy releases predating
   * this feature never do) AND both resolve to a commit in git history (a
   * release created while `syncCommitOnRelease` was off never lands in
   * history — B3, a known open edge, per the brief).
   *
   * 0.1.124: for each changed page, the old/new content is read directly from
   * the two resolved commits (`GitService.showFile`) and run through
   * `pageSerializer.diff`, the same section/line-diff algorithm `computeDelta`
   * (the SQL path) uses — this path now produces the same section-level +
   * `line_diff` fidelity as every other diff path, not a degraded subset.
   */
  private async tryGitAnchoredDiff(
    fromRow: ReleaseRow,
    toRow: ReleaseRow,
    opts?: { roots?: string[] },
  ): Promise<RawDelta | null> {
    if (!this.gitService || !this.releaseStore) return null;
    const gitService = this.gitService;
    if (!fromRow.slug || !toRow.slug) return null;
    const config = readConfig(this.cwd);
    if (!config.git?.enabled) return null;

    const fromFile = nodePath.join(this.releaseStore.root, `${fromRow.slug}.json`);
    const toFile = nodePath.join(this.releaseStore.root, `${toRow.slug}.json`);
    const [shaA, shaB] = await Promise.all([
      gitService.resolveReleaseCommit(fromFile),
      gitService.resolveReleaseCommit(toFile),
    ]);
    if (!shaA || !shaB) return null;
    // Both release-identity files landed in the SAME commit (e.g. a rename
    // that skipped a commit — B3 — followed by a later release whose commit
    // swept up both the pending rename and the new file). `diffRefs(sha,
    // sha, ...)` would trivially return `{files: []}`, a non-null-but-empty
    // result the caller would otherwise accept as "no changes" even though
    // real content differs — decline so the caller falls back to the
    // version-table-based SQL path, which is anchored on release ids, not
    // commits, and always produces a correct diff regardless of commit shape.
    if (shaA === shaB) return null;

    // 0.1.118: `diffRefs` resolves its output paths from `git rev-parse
    // --show-toplevel`, which is ALWAYS symlink-resolved — on macOS `cwd`
    // itself is typically reached through `/var/folders` → `/private/var/…`,
    // so a plain (non-realpath'd) comparison dir would silently never match
    // any returned file (same class of bug `GitService.commit()`'s own
    // staging-target resolution already guards against). Realpath every
    // comparison target once, tolerating a missing dir (falls back to the
    // as-given path — that branch just then matches nothing, not a crash).
    const realOrSelf = (p: string): string => {
      try {
        return nodeFs.realpathSync(p);
      } catch {
        return p;
      }
    };
    const entitiesAbs = realOrSelf(this.entityStore?.root ?? nodePath.resolve(this.cwd, config.entitiesDir));
    const releasesAbs = realOrSelf(this.releaseStore.root);
    // `readConfig` only type-checks briefsDir/patchesDir as strings (unlike the stricter
    // PATCH /api/config route) — a hand-edited config.json with `briefsDir: ''` (or '.')
    // would otherwise resolve briefsAbs to cwd itself, making isInside(briefsAbs, ...) match
    // every file in the diff. Guard against that degenerate case explicitly.
    const cwdAbs = realOrSelf(this.cwd);
    const briefsAbs = realOrSelf(nodePath.resolve(this.cwd, config.briefsDir));
    const patchesAbs = realOrSelf(nodePath.resolve(this.cwd, config.patchesDir));
    const rootIds = (opts?.roots ?? this.releasableRootIds).filter((r) =>
      this.releasableRootIds.includes(r),
    );
    const rootDirsById = new Map(
      this.releasableRootIds.map((id, i) => [id, realOrSelf(this.releasableRootDirs[i]!)]),
    );
    const scopedRootDirs = rootIds.map((id) => rootDirsById.get(id)!).filter(Boolean);

    const gitDiff = await gitService.diffRefs(shaA, shaB, [
      ...scopedRootDirs,
      entitiesAbs,
      releasesAbs,
    ]);
    if (!gitDiff) return null;

    const STATUS_TO_OP: Record<'A' | 'M' | 'D' | 'R', 'created' | 'modified' | 'deleted'> = {
      A: 'created',
      M: 'modified',
      D: 'deleted',
      R: 'created', // diffRefs already flattens R into a D(old)+A(new) pair
    };
    const isInside = (parent: string, child: string): boolean => {
      const rel = nodePath.relative(parent, child);
      return rel !== '' && !rel.startsWith('..') && !nodePath.isAbsolute(rel);
    };

    const entities: RawDeltaEntityChange[] = [];
    const pageCandidates: Array<{ relPath: string; absPath: string; status: 'A' | 'M' | 'D' | 'R' }> = [];

    for (const file of gitDiff.files) {
      // Release-identity files are metadata, not spec content — never surfaced.
      if (isInside(releasesAbs, file.path)) continue;
      // Briefs/patches are never releasable page content (ac-korze-tar-bundle-a-zawiera-wy-cznie-ma).
      if (
        (briefsAbs !== cwdAbs && isInside(briefsAbs, file.path)) ||
        (patchesAbs !== cwdAbs && isInside(patchesAbs, file.path))
      ) {
        continue;
      }

      if (isInside(entitiesAbs, file.path)) {
        const relPath = nodePath.relative(entitiesAbs, file.path).replaceAll(nodePath.sep, '/');
        const parsed = this.entityStore?.parseRelPath(relPath);
        if (parsed) {
          entities.push({ type: parsed.type, slug: parsed.slug, op: STATUS_TO_OP[file.status] });
        }
        continue;
      }

      for (const id of rootIds) {
        const dir = rootDirsById.get(id);
        if (!dir || !isInside(dir, file.path)) continue;
        const relPath = nodePath.relative(dir, file.path).replaceAll(nodePath.sep, '/');
        // General backstop: any other non-page file under `.claude4spec/` (config.json,
        // mcp.json, future additions) — same convention the page walker applies. `continue`
        // (not `break`): this root's dir just happens to contain a dot-prefixed subtree that
        // ANOTHER, more specific root may legitimately own (e.g. a root at '.docs') — keep
        // trying remaining roots instead of abandoning attribution for this file entirely.
        if (hasDotSegment(relPath)) continue;
        pageCandidates.push({ relPath, absPath: file.path, status: file.status });
        break;
      }
    }

    // Read old/new content per changed page directly from the two resolved
    // commits and run it through the same section/line-diff algorithm the SQL
    // path (`computeDelta`) uses — mirrors computeDelta's snapshotFromContent
    // → diff → copy-fields pattern (release.ts computeDelta, below). `op` on
    // the pushed entry comes from the diff itself (not STATUS_TO_OP): this is
    // what makes a rename — flattened by diffRefs into a D(old)+A(new) pair —
    // resolve correctly, since the "D" candidate's new-side content naturally
    // doesn't exist at the new path's old name, and vice versa for the "A" side.
    const pages: RawDeltaPageChange[] = (
      await Promise.all(
        pageCandidates.map(async (c) => {
          const op = STATUS_TO_OP[c.status];
          const [oldContent, newContent] = await Promise.all([
            op !== 'created' ? gitService.showFile(shaA, c.absPath) : Promise.resolve(null),
            op !== 'deleted' ? gitService.showFile(shaB, c.absPath) : Promise.resolve(null),
          ]);
          const aData = oldContent != null
            ? this.pageSerializer.snapshotFromContent(c.relPath, oldContent)
            : null;
          const bData = newContent != null
            ? this.pageSerializer.snapshotFromContent(c.relPath, newContent)
            : null;
          const diff = this.pageSerializer.diff(aData, bData, c.relPath);
          return diff.op === 'noop' ? null : diff;
        }),
      )
    )
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .map((diff) => ({
        path: diff.path,
        op: diff.op,
        added_sections: diff.added_sections,
        removed_sections: diff.removed_sections,
        modified_sections: diff.modified_sections,
        moved_sections: diff.moved_sections,
        frontmatter_diff: diff.frontmatter_diff,
        xml_refs_diff: diff.xml_refs_diff,
      }));

    return {
      from: { id: fromRow.id, name: fromRow.name },
      to: { id: toRow.id, name: toRow.name },
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
   *
   * 0.1.118: when `config.git.enabled` and both releases resolve to commits
   * in git history, sources from `tryGitAnchoredDiff` instead (mutually
   * exclusive with the SQL computation below, never merged — see that
   * method's doc comment). `fromIdOrName === null` always takes the SQL path
   * (no need to synthesize an empty-tree SHA for the initial-brief case).
   */
  async getReleaseDiff(
    fromIdOrName: number | string | null,
    toIdOrName: number | string,
    opts?: { roots?: string[] },
  ): Promise<RawDelta> {
    const toRow = this.findReleaseRow(toIdOrName);
    if (!toRow) throw new DomainError('NOT_FOUND', `release '${toIdOrName}' not found`);

    if (fromIdOrName !== null) {
      const fromRowForGit = this.findReleaseRow(fromIdOrName);
      if (!fromRowForGit) throw new DomainError('NOT_FOUND', `release '${fromIdOrName}' not found`);
      const gitDelta = await this.tryGitAnchoredDiff(fromRowForGit, toRow, opts);
      if (gitDelta) return gitDelta;
    }

    const toSnap = this.getReleaseSnapshot(toRow.id);
    // 0.1.96: pages are correlated by (rootId, path), narrowed by opts.roots
    // (default: all releasable roots) via latestPageRowsAtOrBefore, which carries
    // rootId. Entities are unaffected by the roots narrowing.
    const toPageRows = this.latestPageRowsAtOrBefore(toRow.id, opts?.roots);
    const { fromSnap, fromMeta, fromPageRows } = this.resolveFromSide(fromIdOrName, toSnap, opts);

    return this.computeDelta(
      fromSnap,
      fromPageRows,
      toSnap,
      toPageRows,
      fromMeta,
      { id: toRow.id, name: toRow.name },
    );
  }

  /**
   * 0.1.122: diff a release (or the initial/empty state, for `fromIdOrName
   * === null`) against the *current* unreleased spec state (`getCurrentSnapshot`).
   * Same shape/algorithm as `getReleaseDiff`'s SQL path — no git-anchored fast
   * path here, since "current" isn't a persisted, git-anchorable release.
   */
  async getUnreleasedDiff(
    fromIdOrName: number | string | null,
    opts?: { roots?: string[] },
  ): Promise<RawDelta> {
    const toSnap = this.getCurrentSnapshot();
    const toPageRows = this.latestPageRowsAtOrBefore(null, opts?.roots);
    const toMeta = { id: 0, name: 'current' };
    const { fromSnap, fromMeta, fromPageRows } = this.resolveFromSide(fromIdOrName, toSnap, opts);

    return this.computeDelta(fromSnap, fromPageRows, toSnap, toPageRows, fromMeta, toMeta);
  }

  /**
   * Shared "from" side resolution for `getReleaseDiff`/`getUnreleasedDiff`
   * (0.1.122 code-review fix — was duplicated between the two): `null` ⇒
   * synthetic empty snapshot (the initial-brief case, `fromMeta = null`),
   * else a resolved release's snapshot/pages, throwing NOT_FOUND if it
   * doesn't exist. `toSnap` only supplies `serializer_versions` for the
   * synthetic-empty case.
   */
  private resolveFromSide(
    fromIdOrName: number | string | null,
    toSnap: SpecSnapshot,
    opts?: { roots?: string[] },
  ): { fromSnap: SpecSnapshot; fromMeta: { id: number; name: string } | null; fromPageRows: PageVersionRow[] } {
    if (fromIdOrName === null) {
      return {
        fromSnap: {
          release: { id: 0, name: '__initial__', description: '', createdBy: 'user', createdAt: '' },
          serializer_versions: toSnap.serializer_versions,
          entities: [],
          pages: [],
        },
        fromMeta: null,
        fromPageRows: [],
      };
    }
    const fromRow = this.findReleaseRow(fromIdOrName);
    if (!fromRow) throw new DomainError('NOT_FOUND', `release '${fromIdOrName}' not found`);
    return {
      fromSnap: this.getReleaseSnapshot(fromRow.id),
      fromMeta: { id: fromRow.id, name: fromRow.name },
      fromPageRows: this.latestPageRowsAtOrBefore(fromRow.id, opts?.roots),
    };
  }

  /**
   * Shared entity/page diffing algorithm between two already-resolved
   * snapshots — extracted from `getReleaseDiff`'s SQL path (0.1.122) so
   * `getUnreleasedDiff` can reuse it against `getCurrentSnapshot()`.
   */
  private computeDelta(
    fromSnap: SpecSnapshot,
    fromPageRows: PageVersionRow[],
    toSnap: SpecSnapshot,
    toPageRows: PageVersionRow[],
    fromMeta: { id: number; name: string } | null,
    toMeta: { id: number; name: string },
  ): RawDelta {
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
      entityChanges.push(
        toRawDeltaEntityChange(
          diff,
          aVer !== bVer ? { type: sample.type, from: aVer, to: bVer } : null
        )
      );
    }

    const pageChanges: RawDeltaPageChange[] = [];
    // Key by (rootId, path) so the same relative path in two roots keeps an
    // independent timeline and is never cross-diffed.
    const pageKey = (p: PageVersionRow): string => `${p.rootId}\u0000${p.path}`;
    const aPagesMap = new Map(fromPageRows.map((p) => [pageKey(p), p]));
    const bPagesMap = new Map(toPageRows.map((p) => [pageKey(p), p]));
    const allPageKeys = new Set([...aPagesMap.keys(), ...bPagesMap.keys()]);
    for (const key of allPageKeys) {
      const a = aPagesMap.get(key);
      const b = bPagesMap.get(key);
      const path = (a ?? b)!.path;
      const aData = a && a.op !== 'delete'
        ? (safeJsonParse(a.data) as ReturnType<PageSerializer['snapshotFromContent']>)
        : null;
      const bData = b && b.op !== 'delete'
        ? (safeJsonParse(b.data) as ReturnType<PageSerializer['snapshotFromContent']>)
        : null;
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
      to: toMeta,
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
      if (deleted.deleted) this.entityStore?.remove(input.type, input.slug); // M29: file follows the index
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
    // M29: persist the restored entity's file (host.restore used writeFile:false).
    if (result.op !== 'noop' && result.op !== 'deleted') {
      try {
        this.entityStore?.persist(input.type, input.slug);
      } catch {
        /* index row missing — skip */
      }
    }
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
        const slug = r.entity_slug;
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
    // 0.1.96: resolve rootId per page straight from page_version (the snapshot's
    // page rows don't carry it) so the bundle can lay pages out as <rootId>/<path>.md
    // across every releasable root.
    const pageRows: BundlePageInput[] = this.latestPageRowsAtOrBefore(release.id).map((p) => ({
      rootId: p.rootId,
      path: p.path,
      op: p.op as 'create' | 'update' | 'delete',
      content: (safeJsonParse(p.data) as PageSnapshotData).content,
    }));
    return buildBundleArchiveImpl(snapshot, release, readConfig(this.cwd), pageRows);
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
  async restoreBundleArchive(stream: NodeJS.ReadableStream): Promise<SpecSnapshot> {
    const restoreDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'c4s-restore-'));
    try {
      // 1. Extract the tar.gz into a sandboxed temp dir.
      await extractBundleStream(stream, restoreDir);

      // 2. Manifest first — schema gate.
      const manifestPath = nodePath.join(restoreDir, 'manifest.json');
      if (!nodeFs.existsSync(manifestPath)) {
        throw new DomainError('BUNDLE_MANIFEST_MISSING', 'bundle is missing manifest.json');
      }
      const manifest = JSON.parse(nodeFs.readFileSync(manifestPath, 'utf8')) as BundleManifest;
      if (manifest.bundleSchemaVersion > BUNDLE_SCHEMA_VERSION) {
        throw new DomainError(
          'BUNDLE_SCHEMA_UNSUPPORTED',
          `bundle schema version ${manifest.bundleSchemaVersion} exceeds supported ${BUNDLE_SCHEMA_VERSION}`,
        );
      }

      // 3. Pages — write byte-for-byte per root, then capture an unreleased
      //    page_version tagged with its rootId. v2 lays pages out under
      //    `<rootId>/…`; a v1 bundle (flat `pages/`, no `manifest.roots`) is read
      //    as the built-in 'pages' root — the flat `pages/` dir IS that root's
      //    subdir, and the bundled v1 config's `pagesDir` is mapped to a root by
      //    the clone caller (v3→v4 path). (Mirrors restorePage's raw-write path.
      //    Watcher is suppressed; at clone bootstrap it is not yet started.)
      const pages: SpecSnapshotPageRow[] = [];
      const fallbackRoot = builtinPagesRoot();
      const bundleRoots: BundleRoot[] =
        Array.isArray(manifest.roots) && manifest.roots.length > 0
          ? manifest.roots
          : [{ id: fallbackRoot.id, name: fallbackRoot.name, dir: fallbackRoot.dir }];
      for (const root of bundleRoots) {
        const srcDir = nodePath.join(restoreDir, root.id);
        // The pages root writes through the running service's dir (preserving its
        // suppress semantics); every other root writes to `<cwd>/<dir>`.
        const destRoot =
          this.pagesService.rootId === root.id
            ? this.pagesService.root
            : nodePath.join(this.cwd, root.dir);
        for (const rel of listBundleFiles(srcDir)) {
          assertSafeBundlePath(rel);
          const content = nodeFs.readFileSync(nodePath.join(srcDir, rel), 'utf8');
          const abs = nodePath.join(destRoot, rel);
          if (this.watcher && this.watcher.rootId === root.id) this.watcher.suppress(rel);
          nodeFs.mkdirSync(nodePath.dirname(abs), { recursive: true });
          nodeFs.writeFileSync(abs, content, 'utf8');
          await this.pageVersions.recordVersion(rel, 'create', 'user', undefined, undefined, root.id);
          pages.push({ path: rel, op: 'create', data: { path: rel, content } });
        }
      }

      // 4. Entities — UPSERT via host.restore in dependency order (DTO before
      //    Endpoint, which references DTO slugs). Each lands as an entity_version
      //    row with release_id = NULL (the normal write-API capture).
      const writer = new HostEntityWriter(this.host, this.tagsService);
      const restoreCtx: RestoreContext = {
        reader: this.rawReader,
        writer,
        releaseId: null,
        actor: 'user',
      };
      const entities: SpecSnapshotEntityRow[] = [];
      const entitiesDir = nodePath.join(restoreDir, 'entities');
      if (nodeFs.existsSync(entitiesDir)) {
        // Validate every bundle file maps to a known + locally-active type up front.
        const byType = new Map<RawEntityType, SpecSnapshotEntityRow[]>();
        for (const file of nodeFs.readdirSync(entitiesDir).filter((f) => f.endsWith('.json'))) {
          const type = PLURAL_FILE_TO_ENTITY_TYPE[file] as RawEntityType | undefined;
          if (!type) {
            throw new DomainError('BUNDLE_UNKNOWN_ENTITY_TYPE', `unknown entity bundle file '${file}'`);
          }
          if (!this.host.getEntity(type)) {
            throw new DomainError('BUNDLE_UNKNOWN_ENTITY_TYPE', `entity type '${type}' is not active locally`);
          }
          byType.set(
            type,
            JSON.parse(nodeFs.readFileSync(nodePath.join(entitiesDir, file), 'utf8')) as SpecSnapshotEntityRow[],
          );
        }
        const order: RawEntityType[] = ['dto', 'database-table', 'ui-view', 'endpoint', 'ac'];
        for (const type of order) {
          const rows = byType.get(type);
          if (!rows) continue;
          for (const row of rows) {
            if (row.op === 'delete') continue;
            this.host.restore(type, row.data, restoreCtx);
            entities.push({ type, slug: row.slug, op: row.op, data: row.data });
          }
        }
      }

      // 5. Compose a SpecSnapshot (same shape as getReleaseSnapshot).
      return {
        release: {
          id: manifest.release.id,
          name: manifest.release.name,
          description: manifest.release.description,
          createdBy: 'user',
          createdAt: manifest.release.createdAt,
        },
        serializer_versions: manifest.serializerVersions,
        entities,
        pages,
      };
    } finally {
      nodeFs.rmSync(restoreDir, { recursive: true, force: true });
    }
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
    const pagePlaceholders = this.releasableRootIds.map(() => '?').join(', ');
    const pageRow = this.releasableRootIds.length === 0
      ? { n: 0 }
      : (this.db
          .prepare(
            `SELECT COUNT(*) AS n FROM page_version
              WHERE release_id = ? AND rootId IN (${pagePlaceholders})`,
          )
          .get(releaseId, ...this.releasableRootIds) as { n: number });
    return {
      entities: entityCounts,
      pages: pageRow.n,
      total: entityTotal + pageRow.n,
    };
  }

  /**
   * Find the latest entity_version row matching a slug at-or-before
   * `releaseId`. M29: slug is the entity_version natural key, so this is a
   * direct query. Returns null if no row found.
   */
  private latestEntityRowForSlug(
    type: RawEntityType,
    slug: string,
    releaseId: number,
  ): EntityVersionRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM entity_version
          WHERE entity_type = ? AND entity_slug = ?
            AND release_id IS NOT NULL AND release_id <= ?
          ORDER BY version DESC LIMIT 1`,
      )
      .get(type, slug, releaseId) as EntityVersionRow | undefined;
    return row ?? null;
  }

  /**
   * For each entity_slug seen in the release range, return the latest version
   * row at-or-before `releaseId`. Rows where the underlying entity table has
   * since been DELETEd appear as op='delete' tombstones (data carries the
   * last snapshot before deletion). `releaseId === null` (0.1.122) drops the
   * upper bound entirely — "latest version per slug, right now", including
   * `release_id IS NULL` (unreleased) rows when they're the newest. Backs
   * both `getReleaseSnapshot` (bounded) and `getCurrentSnapshot` (unbounded).
   */
  private latestEntityRowsAtOrBefore(type: RawEntityType, releaseId: number | null): EntityVersionRow[] {
    return this.db
      .prepare(
        `SELECT ev1.* FROM entity_version ev1
          WHERE ev1.entity_type = ?
            AND (? IS NULL OR (ev1.release_id IS NOT NULL AND ev1.release_id <= ?))
            AND ev1.version = (
              SELECT MAX(ev2.version) FROM entity_version ev2
               WHERE ev2.entity_type = ev1.entity_type
                 AND ev2.entity_slug = ev1.entity_slug
                 AND (? IS NULL OR (ev2.release_id IS NOT NULL AND ev2.release_id <= ?))
            )
          ORDER BY ev1.entity_slug`,
      )
      .all(type, releaseId, releaseId, releaseId, releaseId) as EntityVersionRow[];
  }

  /**
   * 0.1.96: latest page_version rows per `(rootId, path)` at-or-before a release,
   * restricted to releasable roots (optionally narrowed further by `roots`). The
   * correlated subquery matches on both rootId and path so the same relative path
   * in different roots has an independent timeline. `releaseId === null` (0.1.122)
   * drops the upper bound — "latest per (rootId, path), right now", including
   * `release_id IS NULL` rows. Backs both `getReleaseSnapshot` (bounded) and
   * `getCurrentSnapshot` (unbounded).
   */
  private latestPageRowsAtOrBefore(releaseId: number | null, roots?: string[]): PageVersionRow[] {
    const rootIds = (roots ?? this.releasableRootIds).filter((r) => this.releasableRootIds.includes(r));
    if (rootIds.length === 0) return [];
    const placeholders = rootIds.map(() => '?').join(', ');
    return this.db
      .prepare(
        `SELECT pv1.* FROM page_version pv1
          WHERE pv1.rootId IN (${placeholders})
            AND (? IS NULL OR (pv1.release_id IS NOT NULL AND pv1.release_id <= ?))
            AND pv1.version = (
              SELECT MAX(pv2.version) FROM page_version pv2
               WHERE pv2.rootId = pv1.rootId
                 AND pv2.path = pv1.path
                 AND (? IS NULL OR (pv2.release_id IS NOT NULL AND pv2.release_id <= ?))
            )
          ORDER BY pv1.rootId, pv1.path`,
      )
      .all(...rootIds, releaseId, releaseId, releaseId, releaseId) as PageVersionRow[];
  }

}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
