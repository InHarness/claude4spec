/**
 * 0.1.118 ReleaseIndexerService — rebuilds the `spec_release` derived cache
 * from `<releasesDir>/<slug>.json` files, mirroring `EntityIndexerService`
 * (M29) — with one critical divergence, spelled out below.
 *
 * `spec_release.id` is an AUTOINCREMENT surrogate key referenced by a loose
 * app-level FK from `entity_version.release_id` / `file_version.release_id`.
 * Unlike `EntityIndexerService.indexAll()` (which safely DELETE-alls every
 * entity table because entities are keyed by a natural `slug`, not a
 * surrogate id anything else points at), this indexer must NEVER delete-all-
 * then-reinsert — that would hand out fresh, non-deterministic ids on every
 * rebuild and silently orphan/repoint the entire version timeline. Instead it
 * upserts by `slug` (`INSERT ... ON CONFLICT(slug) DO UPDATE`, `id` never
 * referenced so SQLite preserves it on update) and only deletes a row on an
 * explicit file `unlink` event. Pre-existing releases born before this
 * feature (no backing file, `slug IS NULL`) are never touched by any of this
 * — SQLite's `UNIQUE` allows multiple `NULL`s.
 *
 * This service never writes to `entity_version`/`file_version`; those
 * `release_id` columns are runtime-only and are not reconstructed from disk.
 *
 * 0.2.2 (brief §8): with `roots` added (migration 049) the release METADATA set
 * the brief calls reconstructable — name, slug, description, createdAt, createdBy,
 * roots — is now fully rebuilt here. The genuinely unreconstructable runtime state
 * is exactly `entity_version` / `file_version` and the `release_id` linkage.
 */

import type Database from 'better-sqlite3';
import type { ReleaseFileStore, ReleaseFileData } from './release-store.js';
import type { ReleasesWatcher } from '../fs/releases-watcher.js';
import { isReservedReleaseName } from './release.js';

/**
 * 0.2.2: `roots` joins the rebuilt columns (migration 049).
 *
 * It was the one field of `ReleaseFileData` the rebuild dropped on the floor, so a
 * database rebuilt from disk came back with releases whose releasable-root set was
 * gone and diffs silently fell back to the project's CURRENT roots. Stored as the
 * JSON array from the file; `id` is still never referenced, so SQLite preserves the
 * surrogate key that `entity_version.release_id` / `file_version.release_id` point at.
 */
const UPSERT_SQL = `
  INSERT INTO spec_release (name, slug, description, created_by, created_at, roots)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(slug) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    created_by = excluded.created_by,
    created_at = excluded.created_at,
    roots = excluded.roots
`;

export class ReleaseIndexerService {
  private debounceMs = 300;
  private pending = new Map<string, NodeJS.Timeout>();

  constructor(
    private db: Database.Database,
    private store: ReleaseFileStore,
    private watcher: ReleasesWatcher,
  ) {}

  // ─── boot full rebuild ────────────────────────────────────────────────────

  async indexAll(): Promise<void> {
    const startedAt = performance.now();
    let count = 0;
    const upsert = this.db.prepare(UPSERT_SQL);
    // 0.1.118: each file's upsert runs as its OWN nested transaction
    // (becomes a SAVEPOINT since we're already inside the outer one) so a
    // single bad file — e.g. two release files whose `name` collides (the
    // UNIQUE constraint on `name` isn't covered by `ON CONFLICT(slug)`) —
    // only skips that one file, mirroring EntityIndexerService's per-entity
    // isolation (m29edge1) instead of rolling back every release indexed
    // earlier in this same boot rebuild.
    const upsertOneSavepoint = this.db.transaction((slug: string): boolean => this.upsertOne(upsert, slug));
    this.db
      .transaction(() => {
        for (const slug of this.store.listSlugs()) {
          try {
            if (upsertOneSavepoint(slug)) count += 1;
          } catch (err) {
            console.warn(`[release-indexer] skip ${slug}: ${(err as Error).message}`);
          }
        }
      })();
    const ms = Math.round(performance.now() - startedAt);
    console.log(`[release-indexer] indexed ${count} releases from ${this.store.root} in ${ms}ms`);
  }

  // ─── incremental (file-watch) ─────────────────────────────────────────────

  schedulePage(relPath: string): void {
    const prev = this.pending.get(relPath);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this.pending.delete(relPath);
      try {
        this.indexFromWatch(relPath);
      } catch (err) {
        console.error(`[release-indexer] failed to index ${relPath}:`, err);
      }
    }, this.debounceMs);
    this.pending.set(relPath, timer);
  }

  async handleUnlink(relPath: string): Promise<void> {
    const prev = this.pending.get(relPath);
    if (prev) {
      clearTimeout(prev);
      this.pending.delete(relPath);
    }
    const slug = this.store.parseRelPath(relPath);
    if (!slug) return;
    // No DB-level FK cascade exists (spec_release.id is only a loose
    // app-level reference from entity_version/file_version.release_id) — this
    // intentionally leaves those columns dangling for the removed release,
    // matching the brief's accepted-risk framing for a deleted release file.
    this.db.prepare(`DELETE FROM spec_release WHERE slug = ?`).run(slug);
  }

  private indexFromWatch(relPath: string): void {
    const slug = this.store.parseRelPath(relPath);
    if (!slug) return;
    const upsert = this.db.prepare(UPSERT_SQL);
    this.upsertOne(upsert, slug);
  }

  // ─── single-release upsert ────────────────────────────────────────────────

  /** Returns true if the release was (re)indexed; false if skipped (parse error). */
  private upsertOne(upsert: Database.Statement, slug: string): boolean {
    let data: ReleaseFileData;
    try {
      data = this.store.read(slug);
    } catch (err) {
      console.warn(`[release-indexer] skip ${slug}: ${(err as Error).message}`);
      return false;
    }
    // 0.1.122 code-review fix: this upsert is the only spec_release write path
    // that doesn't go through createRelease/updateRelease's reserved-name
    // guard — without this check, a hand-edited or synced release-identity
    // file named 'current' would silently shadow the diff route's `:to=current`
    // sentinel forever (see isReservedReleaseName's doc comment in release.ts).
    if (isReservedReleaseName(data.name)) {
      console.warn(`[release-indexer] skip ${slug}: release name '${data.name}' is reserved`);
      return false;
    }
    upsert.run(
      data.name,
      data.slug,
      data.description,
      data.createdBy,
      data.createdAt,
      // NULL rather than '[]' when the file records no roots: NULL means "not
      // recorded, fall back to the current releasable roots", which is different
      // from "this release deliberately covered zero roots".
      data.roots ? JSON.stringify(data.roots) : null,
    );
    return true;
  }
}
