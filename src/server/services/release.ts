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
  UpdateReleaseResponse,
} from '../../shared/entities.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import { topoSortModules } from '../core/plugin-host/entity-order.js';
import type { RawEntityReader, RawEntityType } from '../discovery/raw-entity-reader.js';
import type { VersionService } from './versions.js';
import type { FileVersionService } from './file-version.js';
import type { FileSerializer } from './file-serializer.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';
import type { SelfWriteMarker } from '../fs/sources.js';
import { DomainError } from './tags.js';
import { HostEntityWriter } from './entity-writer.js';
import type { RestoreContext, RestoreResult } from '../serialization/types.js';
import { canonicalize, toRawDeltaEntityChange } from '../serialization/snapshot.js';
import { samePayloadVersion } from '../serialization/payload-version.js';
import { readSystemFields, stripSystemFields } from '../serialization/system-fields.js';
import {
  attachPayloadVersion,
  stripFileEnvelope,
  stripPayloadVersion,
  upgradeCapture,
} from '../serialization/payload-upgrade.js';
import { payloadVersionOfCapture } from '../serialization/payload-version.js';
import type { SnapshotData } from '../serialization/types.js';
import { projectStamp } from './system-stamp-projection.js';
import { readConfig, builtinPagesRoot } from '../config.js';
import { slugify } from '../../shared/slug.js';
import { hasDotSegment } from '../../shared/page-files.js';
import { toReleaseFileData, type ReleaseFileStore } from './release-store.js';
import type { GitService } from './git.js';
import type { GitRefDiff } from '../../shared/git.js';
import type { FileDiff, FileSnapshotData } from './file-serializer.js';
import {
  buildBundleArchive as buildBundleArchiveImpl,
  extractBundleStream,
  BUNDLE_SCHEMA_VERSION,
  BUNDLE_TAGS_FILE,
  readBundleEntities,
  type BuildBundleResult,
  type BundleEntityInput,
  type BundleManifest,
  type BundlePageInput,
  type BundleRoot,
  type BundleTagInput,
} from './release-bundle.js';

/** Shared by `classifyGitDiffFiles`/`diffPageCandidates` — `diffRefs`/`diffRefToWorkingTree` already flatten renames (R) into a D(old)+A(new) pair. */
const STATUS_TO_OP: Record<'A' | 'M' | 'D' | 'R', 'created' | 'modified' | 'deleted'> = {
  A: 'created',
  M: 'modified',
  D: 'deleted',
  R: 'created',
};

/**
 * The same git statuses, in the ENTITY vocabulary.
 *
 * 0.2.31 spells an entity's modified state `updated`, matching the `EntityDiff`
 * envelope the row carries; a page's stays `modified`, because that word belongs
 * to M02's `FileDiff` and a page has no logical schema to generate a delta from.
 * Two maps rather than one with a cast, so neither can be used for the other by
 * accident.
 */
const STATUS_TO_ENTITY_OP: Record<'A' | 'M' | 'D' | 'R', 'created' | 'updated' | 'deleted'> = {
  A: 'created',
  M: 'updated',
  D: 'deleted',
  R: 'created',
};

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

/**
 * Shared frozen-release guard (decyzja 13: implicit last = mutable) — throws
 * `RELEASE_FROZEN` unless `row` is the current latest release (`id ===
 * MAX(id)`). Callable from inside a `db.transaction()` (synchronous, no
 * await) — `updateRelease`'s two-transaction split (0.1.124, commit-then-
 * assign) calls this from BOTH transactions: once up front, and once again
 * immediately before the release_id assignment, to catch a release created
 * concurrently during the awaited `commitPull()` in between.
 */
function assertLatestMutable(db: Database.Database, row: ReleaseRow): void {
  const maxRow = db.prepare(`SELECT MAX(id) AS maxId FROM spec_release`).get() as { maxId: number | null };
  if (row.id !== maxRow.maxId) {
    throw new DomainError('RELEASE_FROZEN', `release '${row.name}' is frozen — only the latest release is mutable`);
  }
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

interface FileVersionRow {
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

/**
 * Did `type` exist at the time `releaseId` was cut?
 *
 * True when the type has at least one `entity_version` row created at or before
 * the release's own `created_at` — regardless of whether that row was captured
 * INTO this release. That is precisely what separates the two situations a plain
 * "does the release have rows for this type" check conflates:
 *
 *   - the type existed and the release legitimately held ZERO of them → history
 *     exists, so a restore SHOULD delete the ones added since;
 *   - the type did not exist yet → no history at all, so the release asserts
 *     nothing about it and deleting everything would invent a claim.
 *
 * Exported (rather than a private method) so the rule is directly testable: it is
 * the guard standing between `restoreSpec` and mass deletion of a whole type.
 */
export function typeExistedAtRelease(
  db: Database.Database,
  type: string,
  releaseId: number | null,
): boolean {
  // Unbounded "current" snapshot — every type is in scope by definition.
  if (releaseId == null) return true;
  const row = db
    .prepare(
      `SELECT 1 FROM entity_version
        WHERE entity_type = ?
          AND created_at <= COALESCE((SELECT created_at FROM spec_release WHERE id = ?), created_at)
        LIMIT 1`,
    )
    .get(type, releaseId);
  return row != null;
}

export class ReleaseService {
  constructor(
    private db: Database.Database,
    private host: PluginHost,
    private versions: VersionService,
    private pageVersions: FileVersionService,
    private pageSerializer: FileSerializer,
    private rawReader: RawEntityReader,
    private tagsService: TagsService,
    private pagesService: PagesService,
    /**
     * M40: resolve the write handle for a root. Restore deliberately writes with
     * `markOrigin`, NOT `suppress` — capture must see the write and record the
     * new version. That is the clearest proof the two are different mechanisms.
     */
    private writerFor: (rootId: string) => SelfWriteMarker | null = () => null,
    private cwd: string = process.cwd(),
    /**
     * 0.1.96: ids of the releasable roots (config.roots filtered by `releasable`).
     * Only these roots' `file_version` rows enter releases/bundles/diffs; brief/
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
   * 0.1.125: absolute path of `releaseId`'s identity file, for
   * `gitService.resolveReleaseCommit()` — same computation `resolveReignRef`
   * already does inline for the NEXT release's marker (line ~616), exposed
   * here so `ReleasePushService` can resolve the branch carrying ITS OWN
   * release's marker before pushing. `null` when no `ReleaseFileStore` is
   * wired, the release doesn't exist, or it has no slug (legacy release,
   * predates the identity-file feature).
   */
  getReleaseFilePath(releaseId: number): string | null {
    if (!this.releaseStore) return null;
    const row = this.findReleaseRow(releaseId);
    if (!row?.slug) return null;
    return nodePath.join(this.releaseStore.root, `${row.slug}.json`);
  }

  /**
   * Count of captures still queued at HEAD — entity_version + file_version rows
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
   * entity_version + file_version rows.
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
   * file_version into this release (decyzja 14, no untie).
   *
   * 0.1.124 commit-then-assign: when `assignUnreleased` is set AND a
   * `GitService` is wired, a best-effort `commitPull()` of the working tree
   * runs BEFORE the SQLite `release_id` cache is touched — the assignment
   * only happens once that commit resolves to something other than
   * `'error'` (`'committed'`/`'nothing-to-commit'`/`'skipped'` all proceed).
   * On `'error'`, the assignment is skipped entirely so the cache and git
   * stay in agreement: the work is still "unreleased". This is why the
   * method is async and split into two DB transactions (name/description
   * edit, then — conditionally — the assignment) rather than one; a git
   * commit can't run inside a synchronous better-sqlite3 transaction. When
   * no `GitService` is wired, or `assignUnreleased` is falsy, assignment
   * behaves exactly as before (no gating, `gitSync: null`).
   *
   * Two ordering subtleties this split introduces (code-review fix,
   * 2026-07-14):
   *
   * 1. The on-disk release-identity file is synced (renamed/rewritten) right
   *    after the FIRST transaction, before `commitPull()` runs — not after
   *    the assignment, like `createRelease` does. `commitPull()` stages
   *    `releasesDir` as part of its working-tree commit; syncing the file
   *    first ensures a combined rename+`assignUnreleased` request actually
   *    captures the rename in that commit, instead of leaving it as a stray
   *    uncommitted change that silently rides into some later, unrelated
   *    commit while the response claims `gitSync.status: 'committed'`.
   * 2. The assignment transaction RE-CHECKS `id === MAX(id)` itself (not
   *    just the first transaction) — `commitPull()` is an awaited git
   *    subprocess call, which yields the event loop for real time. A
   *    concurrent `createRelease()` during that window would otherwise go
   *    undetected: the first transaction's frozen-check is stale by the time
   *    the assignment runs, so newly-`release_id IS NULL` rows captured
   *    after the concurrent release was created could get silently
   *    misattributed to this now-frozen release instead. Throwing
   *    `RELEASE_FROZEN` here (rather than proceeding) is safe — the git
   *    commit itself is best-effort/non-transactional, same as every other
   *    `GitService` action, so an extra harmless "Pull to X" commit in that
   *    rare race is an acceptable trade for never corrupting the DB's
   *    release_id attribution.
   */
  async updateRelease(input: {
    idOrName: number | string;
    name?: string;
    description?: string;
    assignUnreleased?: boolean;
  }): Promise<UpdateReleaseResponse> {
    const tx = this.db.transaction(() => {
      const row = this.findReleaseRow(input.idOrName);
      if (!row) throw new DomainError('NOT_FOUND', `release '${input.idOrName}' not found`);

      assertLatestMutable(this.db, row);

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

      const editedRow = this.db
        .prepare(`SELECT * FROM spec_release WHERE id = ?`)
        .get(row.id) as ReleaseRow;
      return { releaseId: row.id, oldSlug, editedRow };
    });
    const { releaseId, oldSlug, editedRow } = tx();

    // 0.1.118: keep the on-disk identity file in sync — a rename moves it
    // (remove old + write new), a description-only edit just rewrites content
    // at the same slug. Legacy releases (no slug — born before this feature,
    // never renamed since) are left without a file, tolerated gracefully.
    //
    // Runs BEFORE commitPull() below (code-review fix, 2026-07-14): a
    // combined rename+assignUnreleased request must have the renamed
    // identity file on disk before commitPull() stages/commits releasesDir,
    // or the rename is left uncommitted while the response still claims
    // gitSync.status: 'committed'.
    if (this.releaseStore && editedRow.slug) {
      try {
        if (oldSlug && oldSlug !== editedRow.slug) {
          this.releaseStore.remove(oldSlug);
        }
        this.releaseStore.write(
          editedRow.slug,
          toReleaseFileData(editedRow, editedRow.slug, this.releasableRootIds),
        );
      } catch (err) {
        console.error(`[release] failed to sync release file for '${editedRow.name}':`, err);
      }
    }

    let gitSync: UpdateReleaseResponse['gitSync'] = null;
    let shouldAssign = input.assignUnreleased === true;
    if (shouldAssign && this.gitService) {
      const result = await this.gitService.commitPull(this.toRelease(editedRow));
      gitSync = result;
      if (result.status === 'error') shouldAssign = false;
    }

    if (shouldAssign) {
      // Re-check id === MAX(id) INSIDE this transaction (code-review fix,
      // 2026-07-14) — commitPull() above is an awaited git subprocess call
      // that yields the event loop for real time; a concurrent
      // createRelease() during that window would otherwise go undetected,
      // and this assignment would misattribute newly-unreleased rows to a
      // release that's no longer actually the latest. See the method's doc
      // comment for the full rationale.
      this.db.transaction(() => {
        const row = this.findReleaseRow(releaseId);
        if (!row) throw new DomainError('NOT_FOUND', `release '${releaseId}' not found`);
        assertLatestMutable(this.db, row);
        this.db
          .prepare(`UPDATE entity_version SET release_id = ? WHERE release_id IS NULL`)
          .run(releaseId);
        this.pageVersions.assignToRelease(releaseId, this.releasableRootIds);
      })();
    }

    return { ...this.getRelease(releaseId), gitSync };
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
   * latest entity_version/file_version row with NO upper bound on
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
   * the latest entity_version row, and per (rootId, path) the latest file_version
   * row, either bounded at-or-before `releaseId` or (releaseId === null) unbounded.
   *
   * 0.2.11 — the covered types come from the registry. They used to come from a
   * hardcoded five, which `design-system`, `diagram` and every plugin type were
   * not among: a release restored types its own snapshot had never captured, so
   * those entities were invisible in every release diff and unrecoverable from
   * every release. Nothing needs backfilling to fix it — `createRelease`'s
   * `UPDATE entity_version SET release_id = ...` is untyped, so their history was
   * always captured and always release-bound; only this loop refused to read it.
   * Past releases therefore become complete retroactively.
   *
   * SCOPE = ACTIVE modules (`listEntities()`, not `listAvailable()`). A snapshot
   * may only name types this host can `diff()`, `upgradeCapture()` and re-import
   * — `restoreBundleArchive` rejects a bundle file whose type is inactive
   * locally, so capturing one would produce an archive this same installation
   * could not read. A type deactivated in `config.entities` therefore drops out
   * of new snapshots, and loses nothing by it: its rows keep their release
   * binding, so re-activating restores every past snapshot retroactively.
   */
  private buildSnapshot(release: Release, releaseId: number | null): SpecSnapshot {
    const entities: SpecSnapshotEntityRow[] = [];
    const serializerVersions: Record<string, string> = {};
    for (const module of this.host.listEntities()) {
      const type = module.type;
      // 0.2.9 (item 13): the type's integer `payloadVersion`, stringified —
      // same vocabulary the `entity_version.serializer_version` column now
      // holds. `page` below stays a semver because a page is a file, not an
      // entity type, and has no payload version to speak of.
      serializerVersions[type] = String(module.payloadVersion);
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
   * 0.1.124 "reign" model: the git snapshot boundary for release `row` is the
   * commit right before the NEXT release's marker (`M_next~1`, found by
   * looking ahead to the next `spec_release` row by id), or the literal ref
   * `'HEAD'` when `row` is the latest release (no next row — its reign
   * extends to HEAD). Returns `null` when not usable, so the caller falls
   * back to the SQL/version-table path:
   *   - no `GitService`/`ReleaseFileStore` wired, or `config.git.enabled` is
   *     off;
   *   - `row` is frozen (has a next release) but that next release has no
   *     slug (legacy release, predates the identity-file feature) or its
   *     marker commit can't be resolved (e.g. it was created while
   *     `git.enabled` was off — B3, a known open edge);
   *   - the resolved marker isn't an ancestor of current HEAD (e.g. an
   *     implicit-pull commit later rebased away) — trusting a marker outside
   *     HEAD's history would produce a nonsensical diff.
   *
   * Note `row` itself needs no slug/marker of its own — only the NEXT
   * release's marker matters (or none, for the latest release) — so a
   * legacy, marker-less release can still be reign-diffed as long as its
   * successor has one.
   */
  private async resolveReignRef(row: ReleaseRow): Promise<string | null> {
    if (!this.gitService || !this.releaseStore) return null;
    const nextRow = this.db
      .prepare(`SELECT * FROM spec_release WHERE id > ? ORDER BY id ASC LIMIT 1`)
      .get(row.id) as ReleaseRow | undefined;
    if (!nextRow) return 'HEAD';
    if (!nextRow.slug) return null;
    const nextFile = nodePath.join(this.releaseStore.root, `${nextRow.slug}.json`);
    const markerSha = await this.gitService.resolveReleaseCommit(nextFile);
    if (!markerSha) return null;
    if (!(await this.gitService.isAncestorOfHead(markerSha))) return null;
    return `${markerSha}~1`;
  }

  /**
   * 0.1.118: git-anchored diff branch. Mutually exclusive with the SQL path
   * below (confirmed against spec AC — never merged): `null` means "not
   * usable" and the caller falls through to the existing SQL computation.
   *
   * 0.1.124: sources both sides' boundaries from `resolveReignRef` (the
   * "reign" model — see its doc comment) rather than each release's own
   * marker commit directly.
   *
   * 0.1.124: for each changed page, the old/new content is read directly from
   * the two resolved refs (`GitService.showFile`) and run through
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
    const config = readConfig(this.cwd);
    if (!config.git?.enabled) return null;

    const [refA, refB] = await Promise.all([
      this.resolveReignRef(fromRow),
      this.resolveReignRef(toRow),
    ]);
    if (!refA || !refB) return null;
    // Both releases resolved to the SAME reign boundary (e.g. two adjacent
    // releases with no git-visible change between their markers).
    // `diffRefs(ref, ref, ...)` would trivially return `{files: []}`, a
    // non-null-but-empty result the caller would otherwise accept as "no
    // changes" even though real content differs — decline so the caller
    // falls back to the version-table-based SQL path, which is keyed on
    // release ids, not commits, and always produces a correct diff
    // regardless of commit shape.
    if (refA === refB) return null;

    const scope = this.resolveGitDiffScope(config, opts);
    const gitDiff = await gitService.diffRefs(refA, refB, [
      ...scope.scopedRootDirs,
      scope.entitiesAbs,
      scope.releasesAbs,
    ]);
    if (!gitDiff) return null;

    const { entities, entityPaths, pageCandidates } = this.classifyGitDiffFiles(gitDiff, scope);

    // Read old/new content per changed page directly from the two resolved
    // refs and run it through the same section/line-diff algorithm the SQL
    // path (`computeDelta`) uses. `gitStatus` is probed once (rather than
    // per-file inside `showFile`) since a release can touch many pages, each
    // needing up to two `showFile` calls — `detect()` alone is several git
    // subprocesses, so reusing one probe avoids fanning that out per file.
    const gitStatus = await gitService.detect();
    const pages = await this.diffPageCandidates(
      pageCandidates,
      (absPath) => gitService.showFile(refA, absPath, gitStatus),
      (absPath) => gitService.showFile(refB, absPath, gitStatus),
      'tryGitAnchoredDiff',
    );

    return {
      from: { id: fromRow.id, name: fromRow.name },
      to: { id: toRow.id, name: toRow.name },
      entities: await this.dropStampOnlyEntityChanges(
        entities,
        entityPaths,
        (absPath) => gitService.showFile(refA, absPath, gitStatus),
        (absPath) => gitService.showFile(refB, absPath, gitStatus),
      ),
      pages,
    };
  }

  /**
   * 0.1.124 "reign" model git-anchored fast path for `getUnreleasedDiff`
   * (`:to='current'`) — mirrors `tryGitAnchoredDiff` but the "to" side is the
   * live working tree, not a second release: uses `diffRefToWorkingTree`
   * instead of `diffRefs`, and reads NEW-side page content directly off disk
   * (the working tree) rather than via `GitService.showFile` (which only
   * reads committed content). OLD-side content still comes from `showFile`
   * at the resolved `refA`. `null` ⇒ caller falls back to the SQL/
   * version-table path (`getCurrentSnapshot`-based), same contract as
   * `tryGitAnchoredDiff`.
   */
  private async tryGitAnchoredUnreleasedDiff(
    fromRow: ReleaseRow,
    opts?: { roots?: string[] },
  ): Promise<RawDelta | null> {
    if (!this.gitService || !this.releaseStore) return null;
    const gitService = this.gitService;
    const config = readConfig(this.cwd);
    if (!config.git?.enabled) return null;

    const refA = await this.resolveReignRef(fromRow);
    if (!refA) return null;

    const scope = this.resolveGitDiffScope(config, opts);
    // Probed ONCE, exactly as `tryGitAnchoredDiff` does. Without it every
    // `showFile` below re-runs `detect()` and its four git spawns — and the
    // motivating case for this branch is the boot backfill commit, which marks
    // every entity file modified, so a few hundred entities would fan out into
    // over a thousand concurrent `git` processes on one `GET /diff/current`.
    const gitStatus = await gitService.detect();
    const gitDiff = await gitService.diffRefToWorkingTree(refA, [
      ...scope.scopedRootDirs,
      scope.entitiesAbs,
      scope.releasesAbs,
    ]);
    if (!gitDiff) return null;

    const { entities, entityPaths, pageCandidates } = this.classifyGitDiffFiles(gitDiff, scope);

    const readWorkingTreeFile = (absPath: string): Promise<string | null> => {
      try {
        return Promise.resolve(nodeFs.readFileSync(absPath, 'utf8'));
      } catch {
        return Promise.resolve(null);
      }
    };
    const pages = await this.diffPageCandidates(
      pageCandidates,
      (absPath) => gitService.showFile(refA, absPath, gitStatus),
      readWorkingTreeFile,
      'tryGitAnchoredUnreleasedDiff',
    );

    return {
      from: { id: fromRow.id, name: fromRow.name },
      to: { id: 0, name: 'current' },
      entities: await this.dropStampOnlyEntityChanges(
        entities,
        entityPaths,
        (absPath) => gitService.showFile(refA, absPath, gitStatus),
        readWorkingTreeFile,
      ),
      pages,
    };
  }

  /**
   * Shared path-scoping for the git-anchored diff branches
   * (`tryGitAnchoredDiff`/`tryGitAnchoredUnreleasedDiff`): realpath'd
   * entities/releases/briefs/patches dirs plus the (optionally
   * `opts.roots`-narrowed) releasable root dirs, keyed by rootId.
   *
   * 0.1.118: `diffRefs`/`diffRefToWorkingTree` resolve their output paths
   * from `git rev-parse --show-toplevel`, which is ALWAYS symlink-resolved —
   * on macOS `cwd` itself is typically reached through `/var/folders` →
   * `/private/var/…`, so a plain (non-realpath'd) comparison dir would
   * silently never match any returned file (same class of bug
   * `GitService.commit()`'s own staging-target resolution already guards
   * against). Realpath every comparison target once, tolerating a missing
   * dir (falls back to the as-given path — that branch just then matches
   * nothing, not a crash).
   */
  private resolveGitDiffScope(
    config: ReturnType<typeof readConfig>,
    opts?: { roots?: string[] },
  ): {
    entitiesAbs: string;
    releasesAbs: string;
    briefsAbs: string;
    patchesAbs: string;
    cwdAbs: string;
    rootIds: string[];
    rootDirsById: Map<string, string>;
    scopedRootDirs: string[];
  } {
    const realOrSelf = (p: string): string => {
      try {
        return nodeFs.realpathSync(p);
      } catch {
        return p;
      }
    };
    const entitiesAbs = realOrSelf(this.entityStore?.root ?? nodePath.resolve(this.cwd, config.entitiesDir));
    const releasesAbs = realOrSelf(this.releaseStore!.root);
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
    return { entitiesAbs, releasesAbs, briefsAbs, patchesAbs, cwdAbs, rootIds, rootDirsById, scopedRootDirs };
  }

  /**
   * Shared `GitRefDiff.files` classification for the git-anchored diff
   * branches: splits into entity changes (no content diffing needed — just
   * `{type, slug, op}`, same as the SQL path's entity handling elsewhere)
   * and page candidates (path attributed to a releasable root, content
   * diffed separately by the caller). Release-identity files and
   * briefs/patches are never surfaced as spec content.
   */
  private classifyGitDiffFiles(
    gitDiff: GitRefDiff,
    scope: ReturnType<typeof this.resolveGitDiffScope>,
  ): {
    entities: RawDeltaEntityChange[];
    /** Absolute path per entity change, same index — needed to re-read content for stamp-only filtering. */
    entityPaths: string[];
    pageCandidates: Array<{ relPath: string; absPath: string; status: 'A' | 'M' | 'D' | 'R' }>;
  } {
    const isInside = (parent: string, child: string): boolean => {
      const rel = nodePath.relative(parent, child);
      return rel !== '' && !rel.startsWith('..') && !nodePath.isAbsolute(rel);
    };
    const { entitiesAbs, releasesAbs, briefsAbs, patchesAbs, cwdAbs, rootIds, rootDirsById } = scope;

    const entities: RawDeltaEntityChange[] = [];
    const entityPaths: string[] = [];
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
          entities.push({
            type: parsed.type,
            slug: parsed.slug,
            op: STATUS_TO_ENTITY_OP[file.status],
            changes: [],
          });
          entityPaths.push(file.path);
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
    return { entities, entityPaths, pageCandidates };
  }

  /**
   * 0.2.4 — drop entity changes whose only difference is the timestamp envelope.
   *
   * The git-anchored branches classify an entity as changed from git's file
   * STATUS alone, with no content comparison. That was sound while an entity
   * file held only content: a git-visible change was necessarily a real one.
   * Since Tier B the file also carries `createdAt`/`updatedAt`, and three
   * ordinary events rewrite it without changing anything a reader cares about —
   * the one-time boot backfill (which rewrites EVERY pre-0.2.4 entity file), a
   * re-persist, and the release-restore `noop` branch that realigns stamps.
   *
   * Left alone, the first commit of the backfill makes `GET /diff/current`
   * report every entity in the project as `modified` — while the SQL path, which
   * goes through `diffEntity` and strips the envelope, correctly reports `noop`
   * for the same pair. Two diff paths for one release, disagreeing. This applies
   * the same stripping rule the host applies everywhere else, so they agree.
   *
   * Only `modified` is filtered: a create or a delete is a real change no matter
   * what the timestamps say. A read failure leaves the change in place — the
   * safe direction is reporting a change that turns out to be cosmetic, never
   * hiding one.
   */
  private async dropStampOnlyEntityChanges(
    entities: RawDeltaEntityChange[],
    entityPaths: string[],
    readOld: (absPath: string) => Promise<string | null>,
    readNew: (absPath: string) => Promise<string | null>,
  ): Promise<RawDeltaEntityChange[]> {
    const decide = async (change: RawDeltaEntityChange, i: number): Promise<boolean> => {
      if (change.op !== 'updated') return true;
      const absPath = entityPaths[i];
      if (!absPath) return true;
      const [oldText, newText] = await Promise.all([readOld(absPath), readNew(absPath)]);
      if (oldText === null || newText === null) return true;
      try {
        /**
         * 0.2.9 — `payloadVersion` comes off with the timestamps.
         *
         * It is envelope, not content: the file records the shape it was written
         * under, and a rewrite that only adds or bumps that marker changed
         * nothing a user wrote. Stripping only the timestamps let the marker read
         * as a content edit here while `computeDelta` (which diffs marker-free
         * captures) called the same entity `noop` — two diff paths for one
         * release, disagreeing, which is exactly the class of regression this
         * filter was added to close.
         */
        const strip = (text: string): unknown =>
          canonicalize(stripFileEnvelope(JSON.parse(text) as unknown));
        return JSON.stringify(strip(oldText)) !== JSON.stringify(strip(newText));
      } catch {
        return true; // unparseable on either side — report it rather than hide it
      }
    };

    /**
     * Bounded, not `Promise.all` over everything. `readOld` is a `git show`
     * subprocess, and the case this method exists for — the boot backfill
     * commit — marks EVERY entity file modified, so an unbounded fan-out puts
     * one process per entity in flight at once on a single `GET /diff/current`.
     */
    const keep = new Array<boolean>(entities.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      for (let i = next++; i < entities.length; i = next++) {
        keep[i] = await decide(entities[i]!, i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, entities.length) }, worker));
    return entities.filter((_, i) => keep[i]);
  }

  /**
   * Shared per-page content diffing for the git-anchored diff branches:
   * reads old/new content via `readOld`/`readNew` for each candidate and
   * runs it through the same section/line-diff algorithm the SQL path
   * (`computeDelta`) uses. `tryGitAnchoredDiff` wires both to `showFile` at
   * its two resolved refs; `tryGitAnchoredUnreleasedDiff` wires `readOld` to
   * `showFile` at `refA` and `readNew` to a plain working-tree disk read.
   *
   * `op` for each page is git's own status letter (`STATUS_TO_OP`), not
   * inferred from content presence: `pageSerializer.diff` reports
   * `op:'created'` whenever the OLD side is `null`, but a content read can
   * also return `null` on any unrelated failure (transient git error,
   * resource limits, or — for the working-tree branch — a genuinely deleted
   * file) — trusting that inference would silently relabel a modification as
   * a creation, or (if both sides fail) drop the page entirely as a false
   * noop. Content is only used for section-level fidelity; a side that
   * should exist per git's status but still comes back `null`, or any error
   * while parsing/diffing it (e.g. malformed historical frontmatter),
   * degrades that single page to file-level-only detail rather than failing
   * the whole request.
   */
  private async diffPageCandidates(
    pageCandidates: Array<{ relPath: string; absPath: string; status: 'A' | 'M' | 'D' | 'R' }>,
    readOld: (absPath: string) => Promise<string | null>,
    readNew: (absPath: string) => Promise<string | null>,
    logLabel: string,
  ): Promise<RawDeltaPageChange[]> {
    const degradedPageChange = (c: (typeof pageCandidates)[number], op: RawDeltaPageChange['op']): RawDeltaPageChange => ({
      path: c.relPath,
      op,
      added_sections: [],
      removed_sections: [],
      modified_sections: [],
      moved_sections: [],
      frontmatter_diff: null,
      xml_refs_diff: null,
    });

    return (
      await Promise.all(
        pageCandidates.map(async (c): Promise<RawDeltaPageChange | null> => {
          const op = STATUS_TO_OP[c.status];
          const wantOld = op !== 'created';
          const wantNew = op !== 'deleted';
          try {
            const [oldContent, newContent] = await Promise.all([
              wantOld ? readOld(c.absPath) : Promise.resolve(null),
              wantNew ? readNew(c.absPath) : Promise.resolve(null),
            ]);
            if ((wantOld && oldContent == null) || (wantNew && newContent == null)) {
              console.error(
                `[release] ${logLabel}: could not read content for page '${c.relPath}' (status ${c.status}) — degrading to file-level status only`,
              );
              return degradedPageChange(c, op);
            }
            const aData = oldContent != null
              ? this.pageSerializer.snapshotFromContent(c.relPath, oldContent)
              : null;
            const bData = newContent != null
              ? this.pageSerializer.snapshotFromContent(c.relPath, newContent)
              : null;
            const diff = this.pageSerializer.diff(aData, bData, c.relPath);
            return diff.op === 'noop' ? null : toRawDeltaPageChange(diff);
          } catch (err) {
            console.error(
              `[release] ${logLabel}: failed to diff page '${c.relPath}' — degrading to file-level status only:`,
              err instanceof Error ? err.message : String(err),
            );
            return degradedPageChange(c, op);
          }
        }),
      )
    ).filter((d): d is RawDeltaPageChange => d !== null);
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
   * Same shape/algorithm as `getReleaseDiff`'s SQL path.
   *
   * 0.1.124: when `config.git.enabled` and `fromIdOrName` resolves to a
   * reign-diffable release, sources from `tryGitAnchoredUnreleasedDiff`
   * instead (mutually exclusive with the SQL computation below, same
   * "never merged" contract as `getReleaseDiff`'s git-anchored branch) — `git
   * diff snapshot(:from)..working-tree`: for the latest release this is just
   * the uncommitted working-tree diff, for an older/frozen release it also
   * picks up every intermediate reign. `fromIdOrName === null` always takes
   * the SQL path (no release to resolve a reign boundary from).
   */
  async getUnreleasedDiff(
    fromIdOrName: number | string | null,
    opts?: { roots?: string[] },
  ): Promise<RawDelta> {
    if (fromIdOrName !== null) {
      const fromRowForGit = this.findReleaseRow(fromIdOrName);
      if (!fromRowForGit) throw new DomainError('NOT_FOUND', `release '${fromIdOrName}' not found`);
      const gitDelta = await this.tryGitAnchoredUnreleasedDiff(fromRowForGit, opts);
      if (gitDelta) return gitDelta;
    }

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
  ): { fromSnap: SpecSnapshot; fromMeta: { id: number; name: string } | null; fromPageRows: FileVersionRow[] } {
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
    fromPageRows: FileVersionRow[],
    toSnap: SpecSnapshot,
    toPageRows: FileVersionRow[],
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
      const aRaw = a && a.op !== 'delete' ? a.data : null;
      const bRaw = b && b.op !== 'delete' ? b.data : null;
      // Both sides brought to the CURRENT shape first. Two captures either side
      // of a `payloadVersion` bump describe the same entity in different
      // spellings; diffing them raw reports every renamed key as a change.
      const aData =
        aRaw === null
          ? null
          : this.upgradeCapture(sample.type, aRaw, fromSnap.serializer_versions[sample.type] ?? null).data;
      const bData =
        bRaw === null
          ? null
          : this.upgradeCapture(sample.type, bRaw, toSnap.serializer_versions[sample.type] ?? null).data;
      const diff = this.host.diff(sample.type, aData, bData);
      if (diff.op === 'noop') continue;
      const aVer = fromSnap.serializer_versions[sample.type] ?? null;
      const bVer = toSnap.serializer_versions[sample.type] ?? null;
      // Compared as payload versions — a release captured before 0.2.9 records
      // the serializer semver where one captured after records the integer, and
      // they mean the same shape. See `serialization/payload-version.ts`.
      entityChanges.push(
        toRawDeltaEntityChange(
          sample.type,
          sample.slug,
          diff,
          samePayloadVersion(aVer, bVer) ? null : { type: sample.type, from: aVer, to: bVer }
        )
      );
    }

    const pageChanges: RawDeltaPageChange[] = [];
    // Key by (rootId, path) so the same relative path in two roots keeps an
    // independent timeline and is never cross-diffed.
    const pageKey = (p: FileVersionRow): string => `${p.rootId}\u0000${p.path}`;
    const aPagesMap = new Map(fromPageRows.map((p) => [pageKey(p), p]));
    const bPagesMap = new Map(toPageRows.map((p) => [pageKey(p), p]));
    const allPageKeys = new Set([...aPagesMap.keys(), ...bPagesMap.keys()]);
    for (const key of allPageKeys) {
      const a = aPagesMap.get(key);
      const b = bPagesMap.get(key);
      const path = (a ?? b)!.path;
      const aData = a && a.op !== 'delete'
        ? (safeJsonParse(a.data) as ReturnType<FileSerializer['snapshotFromContent']>)
        : null;
      const bData = b && b.op !== 'delete'
        ? (safeJsonParse(b.data) as ReturnType<FileSerializer['snapshotFromContent']>)
        : null;
      const diff = this.pageSerializer.diff(aData, bData, path);
      if (diff.op === 'noop') continue;
      pageChanges.push(toRawDeltaPageChange(diff));
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
  /**
   * Bring a CAPTURED payload to the type's current shape before anything reads it.
   *
   * A capture is a payload like any other, written under whatever version the
   * type was at when the snapshot was taken — so restoring a release cut before
   * a `payloadVersion` bump has to run the same chain a stale file does. The
   * brief names M17 as a consumer alongside M29 for exactly this reason.
   *
   * It matters as much for the DIFF as for the restore. Without it, an
   * old-shape capture compared against a current entity differs in every renamed
   * key, so a release cut before the bump reports every entity as `modified`
   * forever — a diff that is loud, wrong, and never settles.
   *
   * `ok: false` is REPORTED, and what the caller does with it differs by side:
   * a diff can fall back to the raw payload and still be useful, a RESTORE
   * cannot. See `restoreEntity`.
   */
  private upgradeCapture(
    type: string,
    data: SnapshotData,
    serializerVersion: string | null | undefined,
  ): { data: SnapshotData; ok: boolean; warnings: string[] } {
    const result = upgradeCapture(
      this.host.getEntity(type),
      data,
      payloadVersionOfCapture(serializerVersion),
    );
    for (const warning of result.warnings) console.warn(`[release] ${type}: ${warning}`);
    return result;
  }

  restoreEntity(input: RestoreEntityInput, actor: ChangedBy = 'user'): RestoreEntityResult {
    const releaseRow = this.findReleaseRow(input.releaseId);
    if (!releaseRow) throw new DomainError('NOT_FOUND', `release '${input.releaseId}' not found`);

    const targetRow = this.latestEntityRowForSlug(input.type, input.slug, releaseRow.id);
    const writer = new HostEntityWriter(this.host, this.tagsService, {}, {
      db: this.db,
      ...(this.entityStore ? { store: this.entityStore } : {}),
      versions: this.versions,
    });
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

    const upgraded = this.upgradeCapture(
      input.type,
      safeJsonParse(targetRow.data),
      targetRow.serializer_version,
    );
    /**
     * A capture that cannot be upgraded is a restore that must NOT happen.
     *
     * Degrading to the un-upgraded payload looked harmless and was the worst
     * option available. `restoreFromSchema` copies only keys matching DECLARED
     * fields, so a v1 payload's `linked_dtos` never reaches the writer,
     * `syncProjectionTables` skips the collection entirely, and `endpoint_dto`
     * keeps TODAY's links — which `persist` then writes into the entity file as
     * the restored state. The API answered `op: 'updated'` and the UI told the
     * user the endpoint was restored to release X while its DTO links were
     * silently whatever they had been.
     *
     * Reported as a noop with the reason attached: the user can see that this
     * entity did not come back, which is recoverable, where a false success is
     * not.
     */
    if (!upgraded.ok) {
      return {
        type: input.type,
        slug: input.slug,
        op: 'noop',
        warnings: [
          `not restored — the captured payload could not be brought to the current shape: ` +
            upgraded.warnings.join('; '),
        ],
      };
    }
    const targetSnapshot = upgraded.data;
    // Compare to current state — if identical, no-op.
    const current = this.rawReader.getEntity(input.type, input.slug);
    if (current) {
      const currentSnapshot = this.host.snapshot(input.type, current, this.rawReader);
      const diff = this.host.diff(input.type, currentSnapshot, targetSnapshot);
      if (diff.op === 'noop') {
        /**
         * 0.2.4 — "no substantive change" governs the DIFF REPORT and the
         * version log. It never governs the projection.
         *
         * Since `diffEntity` strips the timestamp envelope from both sides,
         * content-equal-but-stamps-different now lands here rather than going
         * through a real mutation. If we returned outright, the entity file
         * would stay at its current timestamps and never become byte-identical
         * to the release snapshot — quietly breaking the round-trip invariant
         * that restore is supposed to establish. So: no mutation, no
         * `entity_version` row, but the stamp still gets projected and the file
         * still gets rewritten.
         */
        const stamp = readSystemFields(targetSnapshot);
        if (stamp) {
          // No service ran on this path — the host is the sole writer, so a
          // write here proves nothing about the type's own SQL.
          /**
           * The file is rewritten whether or not `projectStamp` reported a
           * change. `projected` answers "did the COLUMNS move", which says
           * nothing about the file: a row already realigned by a prior partial
           * restore (or by the indexer's own backstop) reports `false` while the
           * JSON on disk still carries the older stamps. Gating the rewrite on
           * it would leave that file diverged and still return success — the
           * exact round-trip invariant this branch exists to establish.
           */
          projectStamp(this.db, this.host, input.type, input.slug, stamp);
          {
            try {
              this.entityStore?.persist(input.type, input.slug);
            } catch {
              /* index row missing — skip */
            }
            /**
             * `noop` describes the CONTENT and the version log, and that stays
             * true. But it must not read as "nothing happened": this branch
             * rewrote the row and the entity file, and moved `updatedAt`
             * BACKWARDS to the release's value with no `entity_version` row to
             * attribute it. A user who restores a release to inspect it, is told
             * "no changes", and then commits would otherwise silently roll back
             * the timestamps of every entity in that release. Say so.
             */
            return {
              type: input.type,
              slug: input.slug,
              op: 'noop',
              warnings: [
                `content already matches release ${releaseRow.id}; timestamps realigned to the ` +
                  `release snapshot and the entity file rewritten (no version row captured)`,
              ],
            };
          }
        }
        return { type: input.type, slug: input.slug, op: 'noop' };
      }
    }

    const result = this.host.restore(input.type, targetSnapshot, restoreCtx);
    // 0.2.4: same backstop as the indexer — a type whose own SQL predates the
    // stamp still gets the release snapshot's timestamps into its columns, so
    // the file written just below matches the snapshot byte for byte.
    if (result.op !== 'noop' && result.op !== 'deleted') {
      const stamp = readSystemFields(targetSnapshot);
      if (stamp) projectStamp(this.db, this.host, input.type, input.slug, stamp);
    }
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
   * Restore a single page. Looks up the latest file_version snapshot at-or-
   * before the release and writes its content via PagesService. The watcher
   * suppresses the resulting chokidar event; the REST capture path then
   * records a fresh file_version row with `release_id = NULL` and
   * `changed_by = 'user'`.
   */
  async restorePage(input: RestorePageInput, _actor: ChangedBy = 'user'): Promise<RestorePageResult> {
    const releaseRow = this.findReleaseRow(input.releaseId);
    if (!releaseRow) throw new DomainError('NOT_FOUND', `release '${input.releaseId}' not found`);
    const target = this.pageVersions.getLatestForPath(input.path, releaseRow.id);
    if (!target || target.op === 'delete') {
      // Snapshot says page didn't exist — delete current file if present.
      if (await this.pagesService.exists(input.path)) {
        // Same as the pages route: mark, remove, flush. A suppress here would
        // linger and swallow an immediate re-create; `capture` synthesizes the
        // tombstone from the last recorded version.
        const deleteWriter = this.writerFor('pages');
        deleteWriter?.markOrigin(input.path, 'user');
        await this.pagesService.remove(input.path);
        if (deleteWriter) await deleteWriter.flush(input.path, 'unlink');
        else await this.pageVersions.recordVersion(input.path, 'delete', 'user');
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

    // Restore must land byte-for-byte, so it SUPPRESSES rather than marking origin:
    // a marked write would run the M06 anchor write-back, which rewrites the file
    // through `pages.write` — re-serializing frontmatter and injecting anchors the
    // restored version never had. Because the reaction chain is suppressed, this is
    // one of the few places that must author its own `file_version` row.
    const restoreWriter = this.writerFor('pages');
    restoreWriter?.suppress(input.path);
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
   * Restore the entire spec to a release. Topological sort by each module's
   * DECLARED `dependsOn` (0.2.2), then pages. Each step generates normal
   * mutations → all visible in timeline.
   *
   * Before 0.2.2 this was a hardcoded `['dto','database-table','ui-view','endpoint']`
   * — which, besides embedding host knowledge of the DTO↔Endpoint pair, silently
   * omitted `ac`, `design-system` and `diagram`: a full-spec restore never touched
   * those three types at all. Deriving the order from the active modules fixes both
   * problems at once, and picks up plugin-contributed types for free.
   */
  async restoreSpec(input: RestoreSpecInput, actor: ChangedBy = 'user'): Promise<RestoreSpecResult> {
    const releaseRow = this.findReleaseRow(input.releaseId);
    if (!releaseRow) throw new DomainError('NOT_FOUND', `release '${input.releaseId}' not found`);
    const releaseId = releaseRow.id;

    const entityResults: RestoreEntityResult[] = [];
    const pageResults: RestorePageResult[] = [];

    // Declared topological order over the ACTIVE modules. "DTO before Endpoint"
    // still holds — it is now the consequence of `endpoint` declaring
    // `dependsOn: ['dto']`, not of the host knowing that pair.
    const order = topoSortModules(this.host.listEntities(), (remaining) =>
      console.warn(
        `[release] dependsOn cycle among [${remaining.join(', ')}] — ` +
          `restoring those types in displayOrder instead`,
      ),
    ).map((m) => m.type as RawEntityType);

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
      // Delete extras: entities currently present but not in target.
      //
      // 0.2.2 GUARD — run this destructive pass only for a type that EXISTED when
      // the release was cut. Widening `order` from the hardcoded four types to
      // every ACTIVE type (the fix for ac/design-system/diagram being skipped
      // entirely) also switches this pass ON for them, and restoring a release cut
      // before `ac` existed would otherwise delete every AC in the project.
      //
      // The discriminator is deliberately NOT "does the release have rows for this
      // type": that conflates two very different situations —
      //   (a) the type did not exist yet  ⇒ the release asserts nothing about it,
      //       so deleting everything invents a claim the release never made;
      //   (b) the type existed and the release legitimately contained zero of them
      //       ⇒ deleting the ones added since is exactly what a restore means.
      // Both look identical through `targetRows`. `typeExistedAtRelease` tells them
      // apart by asking whether the type has ANY version history at or before the
      // release's own `created_at`, which is (b)'s fingerprint and not (a)'s.
      // Skipping is REPORTED, never silent.
      const covered = typeExistedAtRelease(this.db, type, releaseId);
      const currentSlugs = new Set(this.rawReader.listSlugs(type));
      if (!covered && currentSlugs.size > 0) {
        entityResults.push({
          type,
          slug: '*',
          op: 'noop',
          warnings: [
            `type '${type}' has no history at or before this release — ` +
              `${currentSlugs.size} existing ${type} entities left untouched ` +
              `(the release predates the type and asserts nothing about it)`,
          ],
        });
      }
      for (const slug of covered ? currentSlugs : []) {
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
    // 0.1.96: resolve rootId per page straight from file_version (the snapshot's
    // page rows don't carry it) so the bundle can lay pages out as <rootId>/<path>.md
    // across every releasable root.
    const pageRows: BundlePageInput[] = this.latestPageRowsAtOrBefore(release.id).map((p) => ({
      rootId: p.rootId,
      path: p.path,
      op: p.op as 'create' | 'update' | 'delete',
      content: (safeJsonParse(p.data) as FileSnapshotData).content,
    }));
    return buildBundleArchiveImpl(
      snapshot,
      release,
      readConfig(this.cwd),
      pageRows,
      this.bundleEntityRows(snapshot),
      this.bundleTagDefs(snapshot),
    );
  }

  /**
   * The release's entities in M29 STORE shape — what `entities/<type>/<slug>.json`
   * has to contain for restore to be an unpack rather than a translation.
   *
   * Two things separate a stored file from an `entity_version.data` blob. The
   * envelope's `createdAt`/`updatedAt` are already in the blob (the capture in
   * `versions.ts` runs the same `host.snapshot`), but `payloadVersion` is NOT:
   * on the version log it lives in the `serializer_version` COLUMN, so it is
   * stamped back in here from the manifest's map. And the row's `op` is dropped
   * — an archive carries state.
   *
   * Types the host no longer knows are skipped: their rows survive in
   * `entity_version`, but nothing can say what payload version they are at, and
   * an entry the reader could not upgrade is worse than an absent one.
   */
  private bundleEntityRows(snapshot: SpecSnapshot): BundleEntityInput[] {
    const rows: BundleEntityInput[] = [];
    for (const entity of snapshot.entities) {
      if (entity.op === 'delete') continue;
      if (!this.host.getEntity(entity.type)) continue;
      const version = snapshot.serializer_versions[entity.type];
      if (version === undefined) continue;
      rows.push({
        type: entity.type,
        slug: entity.slug,
        // `payloadVersionOfCapture`, not `Number()`: the column holds two
        // vocabularies — integers since 0.2.9, semver ('1.1.0') before it — and
        // `Number('1.1.0')` is NaN, which `attachPayloadVersion` would happily
        // stamp as `"payloadVersion": null`.
        data: canonicalize(attachPayloadVersion(entity.data, payloadVersionOfCapture(version))),
      });
    }
    return rows;
  }

  /**
   * Tag DEFINITIONS for `entities/tags.json`, read from HEAD and filtered to the
   * slugs this release's entities actually carry.
   *
   * HEAD, not a version table, because there is no `tag_version` — a tag is not
   * a plugin-host entity type. That is a deliberate hole in the bundle's
   * determinism, not an oversight: two builds of the same release separated by a
   * tag rename produce different `tags.json`. Assignments are unaffected, since
   * `tags[]` travels inside each entity's own payload; only the definition
   * (colour, description, display name) is copied.
   *
   * `null` when the project has no `tags.json` — the bundle then omits the file.
   */
  private bundleTagDefs(snapshot: SpecSnapshot): BundleTagInput[] | null {
    if (!this.entityStore?.tagsFileExists()) return null;
    const used = new Set<string>();
    for (const entity of snapshot.entities) {
      if (entity.op === 'delete') continue;
      const tags = (entity.data as { tags?: unknown } | null)?.tags;
      if (!Array.isArray(tags)) continue;
      for (const tag of tags) {
        if (typeof tag === 'string') used.add(tag);
        else if (tag && typeof tag === 'object' && typeof (tag as { slug?: unknown }).slug === 'string') {
          used.add((tag as { slug: string }).slug);
        }
      }
    }
    return this.entityStore.readTags().filter((t) => used.has(t.slug));
  }

  /**
   * The read direction (M27 project clone / `c4s import <bundle>`):
   *
   *   1. Parse `manifest.json` FIRST. Missing → `BUNDLE_MANIFEST_MISSING`.
   *      `bundleSchemaVersion` > max supported → `BUNDLE_SCHEMA_UNSUPPORTED`.
   *      (`BUNDLE_HASH_MISMATCH` is the CALLER's — it holds the expected hash
   *      from the push header; see `release-import.ts`.)
   *   2. Pages: `<rootId>/<path>.md`, or a flat `pages/` tree on v1, where the
   *      absent `manifest.roots` selects the built-in root. Unsafe relative path
   *      → `BUNDLE_MALFORMED_ENTRY`.
   *   3. Entities, dispatched on the manifest version — see `readBundleEntities`.
   *   4. Tag definitions — see `restoreBundleTags`.
   *   5. Compose a `SpecSnapshot` (same shape as `getReleaseSnapshot`).
   *
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
      //    file_version tagged with its rootId. v2 lays pages out under
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
          // A bundle can carry a root the destination project does not have
          // configured yet — the clone case, where config.json is itself being
          // restored FROM the bundle. There is no mount and no writer for it, so
          // `capture` cannot author the row and this must.
          const rootWriter = this.writerFor(root.id);
          nodeFs.mkdirSync(nodePath.dirname(abs), { recursive: true });
          if (rootWriter) {
            rootWriter.markOrigin(rel, 'user');
            nodeFs.writeFileSync(abs, content, 'utf8');
            await rootWriter.flush(rel);
          } else {
            nodeFs.writeFileSync(abs, content, 'utf8');
            await this.pageVersions.recordVersion(rel, 'create', 'user', undefined, undefined, root.id);
          }
          pages.push({ path: rel, op: 'create', data: { path: rel, content } });
        }
      }

      // 4. Entities — UPSERT via host.restore in dependency order (DTO before
      //    Endpoint, which references DTO slugs). Each lands as an entity_version
      //    row with release_id = NULL (the normal write-API capture).
      const writer = new HostEntityWriter(this.host, this.tagsService, {}, {
        db: this.db,
        ...(this.entityStore ? { store: this.entityStore } : {}),
        versions: this.versions,
      });
      const restoreCtx: RestoreContext = {
        reader: this.rawReader,
        writer,
        releaseId: null,
        actor: 'user',
      };
      const entities: SpecSnapshotEntityRow[] = [];
      const entitiesDir = nodePath.join(restoreDir, 'entities');
      if (nodeFs.existsSync(entitiesDir)) {
        const byType = readBundleEntities(entitiesDir, manifest.bundleSchemaVersion, (t) =>
          this.host.getEntity(t) !== null,
        );
        /**
         * 0.2.11 — declared `dependsOn` order over the ACTIVE modules, the same
         * source and cycle handling `restoreSpec` has used since 0.2.2.
         *
         * This was the last divergent order array, and it was not merely
         * redundant: a bundle carrying a type outside its five literals passed
         * the validation loop above (the type IS active) and was then never
         * iterated, so its rows were dropped in silence — after the code had
         * just confirmed they were restorable.
         */
        const order = topoSortModules(this.host.listEntities(), (remaining) =>
          console.warn(
            `[release] dependsOn cycle among [${remaining.join(', ')}] — ` +
              `restoring those types in displayOrder instead`,
          ),
        ).map((m) => m.type);
        for (const type of order) {
          const rows = byType.get(type);
          if (!rows) continue;
          for (const row of rows) {
            // A bundle can be older than this installation; its manifest records
            // the version each type was captured at.
            const bundled = this.upgradeCapture(type, row.data, manifest.serializerVersions?.[type] ?? null);
            if (!bundled.ok) continue; // same rule as restoreEntity: skip, never half-restore
            /**
             * The PATH's slug is stamped in, and the payload marker taken out.
             *
             * v4 lets a file body omit `slug` — the path already says it — but
             * `restoreFromSchema` reads the slug from the body and would upsert
             * such an entry under `''`, collapsing every slug-less file of a type
             * onto one row while the returned snapshot still reported the right
             * paths. The one authoritative slug has to reach the writer too.
             *
             * `payloadVersion` goes the other way: v4 stamps it into the FILE,
             * where it is the store's own envelope, but a capture must not carry
             * it (`PAYLOAD_VERSION_KEY`) — inside a snapshot it turns every diff
             * spanning a bump into a spurious `modified`.
             */
            const data = stripPayloadVersion({
              ...(bundled.data as Record<string, unknown>),
              slug: row.slug,
            });
            this.host.restore(type, data, restoreCtx);
            // An archive carries STATE, so every entry is a create in the fresh
            // cwd this restores into. v1–v3 entries did carry an `op`; it is
            // discarded rather than trusted, so both layouts land identically.
            entities.push({ type, slug: row.slug, op: 'create', data });
          }
        }

        // Tag definitions, after the entities — the fabrication warning counts
        // slugs the entities actually reference.
        this.restoreBundleTags(entitiesDir, entities);
      }

      // Compose a SpecSnapshot (same shape as getReleaseSnapshot).
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

  /**
   * Step 5b — tag DEFINITIONS from `entities/tags.json`, written verbatim to the
   * store's own `tags.json`.
   *
   * Anything an entity references but the definitions do not carry is fabricated
   * (`name = slug`, no colour, no description) so the assignment does not dangle.
   * The precedent is the by-slug auto-create of `tag_entity`. It is a write path
   * inventing data, so it must be VISIBLE: the count goes out as a warning rather
   * than being absorbed silently. Bundles older than v4 have no such file, so
   * every definition they need is fabricated through exactly this path.
   */
  private restoreBundleTags(entitiesDir: string, entities: readonly SpecSnapshotEntityRow[]): void {
    if (!this.entityStore) return;
    const bundledPath = nodePath.join(entitiesDir, BUNDLE_TAGS_FILE);
    const defs: BundleTagInput[] = nodeFs.existsSync(bundledPath)
      ? (JSON.parse(nodeFs.readFileSync(bundledPath, 'utf8')) as BundleTagInput[])
      : [];
    const known = new Set(defs.map((d) => d.slug));

    const fabricated: BundleTagInput[] = [];
    for (const entity of entities) {
      const tags = (entity.data as { tags?: unknown } | null)?.tags;
      if (!Array.isArray(tags)) continue;
      for (const tag of tags) {
        const slug =
          typeof tag === 'string'
            ? tag
            : tag && typeof tag === 'object' && typeof (tag as { slug?: unknown }).slug === 'string'
              ? (tag as { slug: string }).slug
              : null;
        if (slug === null || known.has(slug)) continue;
        known.add(slug);
        fabricated.push({ slug, name: slug, color: null, description: null });
      }
    }

    if (defs.length === 0 && fabricated.length === 0) return;
    if (fabricated.length > 0) {
      console.warn(
        `[release] bundle carried no definition for ${fabricated.length} tag(s) ` +
          `(${fabricated.map((t) => `'${t.slug}'`).join(', ')}) — created from the slug alone`,
      );
    }
    this.entityStore.writeTags([...defs, ...fabricated]);
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
            `SELECT COUNT(*) AS n FROM file_version
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
   * 0.1.96: latest file_version rows per `(rootId, path)` at-or-before a release,
   * restricted to releasable roots (optionally narrowed further by `roots`). The
   * correlated subquery matches on both rootId and path so the same relative path
   * in different roots has an independent timeline. `releaseId === null` (0.1.122)
   * drops the upper bound — "latest per (rootId, path), right now", including
   * `release_id IS NULL` rows. Backs both `getReleaseSnapshot` (bounded) and
   * `getCurrentSnapshot` (unbounded).
   */
  private latestPageRowsAtOrBefore(releaseId: number | null, roots?: string[]): FileVersionRow[] {
    const rootIds = (roots ?? this.releasableRootIds).filter((r) => this.releasableRootIds.includes(r));
    if (rootIds.length === 0) return [];
    const placeholders = rootIds.map(() => '?').join(', ');
    return this.db
      .prepare(
        `SELECT pv1.* FROM file_version pv1
          WHERE pv1.rootId IN (${placeholders})
            AND (? IS NULL OR (pv1.release_id IS NOT NULL AND pv1.release_id <= ?))
            AND pv1.version = (
              SELECT MAX(pv2.version) FROM file_version pv2
               WHERE pv2.rootId = pv1.rootId
                 AND pv2.path = pv1.path
                 AND (? IS NULL OR (pv2.release_id IS NOT NULL AND pv2.release_id <= ?))
            )
          ORDER BY pv1.rootId, pv1.path`,
      )
      .all(...rootIds, releaseId, releaseId, releaseId, releaseId) as FileVersionRow[];
  }

}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Shared by computeDelta and tryGitAnchoredDiff — the wire shape is a 1:1 copy of FileDiff's fields. */
function toRawDeltaPageChange(diff: FileDiff): RawDeltaPageChange {
  return {
    path: diff.path,
    op: diff.op,
    added_sections: diff.added_sections,
    removed_sections: diff.removed_sections,
    modified_sections: diff.modified_sections,
    moved_sections: diff.moved_sections,
    frontmatter_diff: diff.frontmatter_diff,
    xml_refs_diff: diff.xml_refs_diff,
  };
}
