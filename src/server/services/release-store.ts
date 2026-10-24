/**
 * 0.1.118 Release Store — the file layer that makes release identity
 * git-committed text, mirroring `EntityStore` (M29).
 *
 * Each release = one JSON file `<slug>.json` in the `releases` root, IDENTITY ONLY
 * (`name`, `slug`, `description`, `createdAt`, `createdBy`, `roots`, and —
 * only for a release that accepted a shadow — `acceptedShadow`) — no
 * version content, no tree, no gitSha. `spec_release` (SQLite) is a derived
 * cache rebuilt from these files (see `ReleaseIndexerService`); release→version
 * links (`entity_version.release_id` / `file_version.release_id`) live
 * EXCLUSIVELY in SQLite and are never reconstructed from disk.
 *
 * 0.2.76 — the bytes go through the M42 record store with the JSON adapter, so
 * atomicity, the path guard, per-path serialization and self-write suppression
 * are the shared implementation rather than this file's own.
 *
 * As with entities the write stays SYNCHRONOUS and does not run the chain
 * in-band, and for a sharper reason than "the callers are sync": `spec_release`
 * is not derived from this file on the write path at all. `createRelease()`
 * INSERTs the row first and writes the identity file afterwards, so the cache is
 * already current before it returns. The `m29-release-cache` projection exists
 * for the INBOUND direction — a file edited outside the app, or arriving with a
 * git pull.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SelfWriteSuppressor } from '../fs/sources.js';
import type { RecordStore } from '../fs/record-store.js';
import type { AcceptedShadow } from '../../shared/entities.js';

export interface ReleaseFileData {
  name: string;
  slug: string;
  description: string;
  createdAt: string;
  createdBy: string;
  // 2.1.14 (M17 m17reldisk): the ids (`rootId`) of the `pages`-kind roots at the
  // moment of the release — bare ids, no `name`/`dir`. Deliberately poorer than
  // the bundle's `manifest.roots` (`{id,name,dir}`): committed release files are
  // immutable git diff anchors, so this shape is frozen with them.
  roots: string[];
  // 2.1.47 (M17 m17reldisk): the accepted shadow `{ id, tipSha }`. Additive and
  // optional — the frozen shape covers the existing fields only. Set solely by
  // creating a release through accepting a shadow; a file without it reads as
  // `null` (see `readAcceptedShadow`). Never taken from a create caller.
  acceptedShadow?: AcceptedShadow | null;
}

/**
 * The `acceptedShadow` of a parsed release file, or `null` when the file has
 * none (every file from before the field, every release not created by
 * accepting a shadow) or carries something that is not `{ id, tipSha }` strings.
 */
export function readAcceptedShadow(data: object): AcceptedShadow | null {
  const v = (data as { acceptedShadow?: unknown }).acceptedShadow;
  if (!v || typeof v !== 'object') return null;
  const { id, tipSha } = v as Record<string, unknown>;
  if (typeof id !== 'string' || !id || typeof tipSha !== 'string' || !tipSha) return null;
  return { id, tipSha };
}

/** The `spec_release` columns that hold the accepted shadow; `null` together. */
export interface AcceptedShadowColumns {
  accepted_shadow_id?: string | null;
  accepted_shadow_sha?: string | null;
}

/** `spec_release` row → `acceptedShadow`; `null` unless both columns are set. */
export function acceptedShadowFromRow(row: AcceptedShadowColumns): AcceptedShadow | null {
  return row.accepted_shadow_id && row.accepted_shadow_sha
    ? { id: row.accepted_shadow_id, tipSha: row.accepted_shadow_sha }
    : null;
}

/**
 * Maps a `spec_release` DB row (or row-shaped object) + a slug + the current
 * `pages` roots into the on-disk identity shape. Single source of truth
 * for this mapping — `ReleaseService.createRelease()`/`updateRelease()` and
 * the 0.1.119 Migration C boot backfill all call this rather than hand-rolling
 * the same object literal, so a field added/renamed here can't silently drift
 * between call sites.
 */
export function toReleaseFileData(
  row: { name: string; description: string; created_at: string; created_by: string } & AcceptedShadowColumns,
  slug: string,
  roots: string[],
): ReleaseFileData {
  const data: ReleaseFileData = {
    name: row.name,
    slug,
    description: row.description,
    createdAt: row.created_at,
    createdBy: row.created_by,
    roots,
  };
  // 2.1.47: written only when the row carries an accepted shadow — a release
  // that accepted none (and every row from before the field) gets no key, so
  // its file stays byte-identical to the pre-2.1.47 shape. Rewriting the file
  // (updateRelease, the M29 DB→disk backfill) keeps the field as the row holds it.
  const acceptedShadow = acceptedShadowFromRow(row);
  if (acceptedShadow) data.acceptedShadow = acceptedShadow;
  return data;
}

export class ReleaseFileStore {
  readonly root: string;
  /** The M42 record store for `releases`; `null` in rigs with no watcher. */
  records: RecordStore<ReleaseFileData> | null = null;

  constructor(
    cwd: string,
    releasesRootDir: string,
    private watcher: SelfWriteSuppressor,
  ) {
    this.root = path.resolve(cwd, releasesRootDir);
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
    if (this.records) {
      this.records.writeSync(relPath, data);
      return;
    }
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
    if (this.records) {
      this.records.removeSync(relPath);
      return;
    }
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
