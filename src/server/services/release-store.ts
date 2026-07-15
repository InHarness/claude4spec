/**
 * 0.1.118 Release Store — the file layer that makes release identity
 * git-committed text, mirroring `EntityStore` (M29).
 *
 * Each release = one JSON file `<releasesDir>/<slug>.json`, IDENTITY ONLY
 * (`name`, `slug`, `description`, `createdAt`, `createdBy`, `roots`) — no
 * version content, no tree, no gitSha. `spec_release` (SQLite) is a derived
 * cache rebuilt from these files (see `ReleaseIndexerService`); release→version
 * links (`entity_version.release_id` / `file_version.release_id`) live
 * EXCLUSIVELY in SQLite and are never reconstructed from disk.
 *
 * Writes are atomic (temp→rename) and `suppress()` the dedicated releases
 * watcher so a programmatic write does not trigger its own reindex.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ReleasesWatcher } from '../fs/releases-watcher.js';

export interface ReleaseFileData {
  name: string;
  slug: string;
  description: string;
  createdAt: string;
  createdBy: string;
  roots: string[];
}

/**
 * Maps a `spec_release` DB row (or row-shaped object) + a slug + the current
 * releasable roots into the on-disk identity shape. Single source of truth
 * for this mapping — `ReleaseService.createRelease()`/`updateRelease()` and
 * the 0.1.119 Migration C boot backfill all call this rather than hand-rolling
 * the same object literal, so a field added/renamed here can't silently drift
 * between call sites.
 */
export function toReleaseFileData(
  row: { name: string; description: string; created_at: string; created_by: string },
  slug: string,
  roots: string[],
): ReleaseFileData {
  return {
    name: row.name,
    slug,
    description: row.description,
    createdAt: row.created_at,
    createdBy: row.created_by,
    roots,
  };
}

export class ReleaseFileStore {
  readonly root: string;

  constructor(
    cwd: string,
    releasesDir: string,
    private watcher: ReleasesWatcher,
  ) {
    this.root = path.resolve(cwd, releasesDir);
  }

  ensureRoot(): void {
    fs.mkdirSync(this.root, { recursive: true });
  }

  relPathFor(slug: string): string {
    return `${slug}.json`;
  }

  /** Invert a relPath → slug; null if it is not a `<slug>.json` release file. */
  parseRelPath(relPath: string): string | null {
    const norm = relPath.replaceAll('\\', '/');
    const m = /^([^/]+)\.json$/.exec(norm);
    return m ? m[1]! : null;
  }

  private absFor(relPath: string): string {
    const abs = path.resolve(this.root, relPath);
    const rel = path.relative(this.root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`path escapes releases root: ${relPath}`);
    }
    return abs;
  }

  exists(slug: string): boolean {
    return fs.existsSync(this.absFor(this.relPathFor(slug)));
  }

  /** Parse `<slug>.json`. Throws on ENOENT or invalid JSON (caller decides). */
  read(slug: string): ReleaseFileData {
    const raw = fs.readFileSync(this.absFor(this.relPathFor(slug)), 'utf-8');
    return JSON.parse(raw) as ReleaseFileData;
  }

  /** Write `<slug>.json` (atomic + suppress). */
  write(slug: string, data: ReleaseFileData): void {
    const relPath = this.relPathFor(slug);
    const abs = this.absFor(relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const body = JSON.stringify(data, null, 2) + '\n';
    this.watcher.suppress(relPath);
    const tmp = `${abs}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, abs);
  }

  /** Remove `<slug>.json` (atomic suppress; ignore if already gone). */
  remove(slug: string): void {
    const relPath = this.relPathFor(slug);
    this.watcher.suppress(relPath);
    try {
      fs.unlinkSync(this.absFor(relPath));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  listSlugs(): string[] {
    if (!fs.existsSync(this.root)) return [];
    return fs
      .readdirSync(this.root)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
      .map((f) => f.slice(0, -'.json'.length))
      .sort();
  }
}
