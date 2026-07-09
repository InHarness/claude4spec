/**
 * 0.1.118 ReleaseIndexerService — rebuilds the `spec_release` derived cache
 * from `<releasesDir>/<slug>.json` files, mirroring `EntityIndexerService`
 * (M29) — with one critical divergence, spelled out below.
 *
 * `spec_release.id` is an AUTOINCREMENT surrogate key referenced by a loose
 * app-level FK from `entity_version.release_id` / `page_version.release_id`.
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
 * This service never writes to `entity_version`/`page_version`; those
 * `release_id` columns are runtime-only and are not reconstructed from disk.
 */

import type Database from 'better-sqlite3';
import type { ReleaseFileStore, ReleaseFileData } from './release-store.js';
import type { ReleasesWatcher } from '../fs/releases-watcher.js';

const UPSERT_SQL = `
  INSERT INTO spec_release (name, slug, description, created_by, created_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(slug) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    created_by = excluded.created_by,
    created_at = excluded.created_at
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
    this.db
      .transaction(() => {
        for (const slug of this.store.listSlugs()) {
          if (this.upsertOne(upsert, slug)) count += 1;
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
    // app-level reference from entity_version/page_version.release_id) — this
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
    upsert.run(data.name, data.slug, data.description, data.createdBy, data.createdAt);
    return true;
  }
}
