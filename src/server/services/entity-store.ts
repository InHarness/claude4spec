/**
 * M29 Entity Store — the file layer that makes entities git-committed text.
 *
 * Each entity = one JSON file `<entitiesDir>/<type>/<slug>.json`; tag
 * definitions = `<entitiesDir>/tags.json`. These files are the SOURCE OF TRUTH;
 * SQLite is a derived index rebuilt from them at boot (see EntityIndexerService).
 *
 * File content = `host.snapshot(row)` run through `canonicalize` so two writes
 * of an unchanged entity are byte-identical (the determinism invariant — any
 * non-deterministic field would produce git-diff noise on every rebuild).
 *
 * Writes are atomic (temp→rename) and `suppress()` the dedicated entities
 * watcher so a programmatic write does not trigger its own reindex.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { PluginHost } from '../core/plugin-host/types.js';
import {
  type RawEntityReader,
  type RawEntityType,
  isRawEntityType,
} from '../domain/raw-entity-reader.js';
import type { SnapshotData } from '../serialization/types.js';
import { canonicalize } from '../serialization/snapshot.js';
import { DomainError } from './tags.js';
import type { EntitiesWatcher } from '../fs/entities-watcher.js';

const ENTITY_TYPE_DIRS: RawEntityType[] = [
  'endpoint',
  'dto',
  'database-table',
  'ui-view',
  'ac',
  'design-system',
  'diagram',
];
const TAGS_FILE = 'tags.json';
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Tag definition as stored in tags.json (registry source of truth). */
export interface TagSnapshot {
  slug: string;
  name: string;
  color: string | null;
  description: string | null;
}

export interface EntityStoreFile {
  type: RawEntityType;
  slug: string;
  relPath: string;
}

export class EntityStore {
  readonly root: string;

  constructor(
    cwd: string,
    entitiesDir: string,
    private watcher: EntitiesWatcher,
    private reader: RawEntityReader,
    private host: PluginHost,
  ) {
    this.root = path.resolve(cwd, entitiesDir);
  }

  // ─── paths ────────────────────────────────────────────────────────────────

  relPathFor(type: RawEntityType, slug: string): string {
    return `${type}/${slug}.json`;
  }

  /** Invert a relPath → {type, slug}; null if it is not an active-type entity file. */
  parseRelPath(relPath: string): { type: RawEntityType; slug: string } | null {
    const norm = relPath.replaceAll('\\', '/');
    const m = /^([a-z-]+)\/([^/]+)\.json$/.exec(norm);
    if (!m) return null;
    const [, type, slug] = m;
    if (!type || !slug || !isRawEntityType(type)) return null;
    return { type, slug };
  }

  isTagsFile(relPath: string): boolean {
    return relPath.replaceAll('\\', '/') === TAGS_FILE;
  }

  private absFor(relPath: string): string {
    if (!relPath || relPath.includes('\0')) throw new DomainError('VALIDATION', 'invalid path');
    const abs = path.resolve(this.root, relPath);
    const rel = path.relative(this.root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new DomainError('VALIDATION', `path escapes entities root: ${relPath}`);
    }
    return abs;
  }

  // ─── lifecycle ──────────────────────────────────────────────────────────

  ensureRoot(): void {
    fs.mkdirSync(this.root, { recursive: true });
  }

  // ─── entity JSON ──────────────────────────────────────────────────────────

  exists(type: RawEntityType, slug: string): boolean {
    return fs.existsSync(this.absFor(this.relPathFor(type, slug)));
  }

  /** Parse `<type>/<slug>.json`. Throws on ENOENT or invalid JSON (caller decides). */
  read(type: RawEntityType, slug: string): SnapshotData {
    return this.readRel(this.relPathFor(type, slug));
  }

  readRel(relPath: string): SnapshotData {
    const raw = fs.readFileSync(this.absFor(relPath), 'utf-8');
    return JSON.parse(raw) as SnapshotData;
  }

  /** Write a snapshot to `<type>/<slug>.json` (atomic + suppress). */
  write(type: RawEntityType, slug: string, data: SnapshotData): void {
    if (!KEBAB_RE.test(slug)) {
      throw new DomainError('VALIDATION', `slug '${slug}' is not kebab-case`);
    }
    this.writeRel(this.relPathFor(type, slug), data);
  }

  private writeRel(relPath: string, data: SnapshotData): void {
    const abs = this.absFor(relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const body = JSON.stringify(canonicalize(data), null, 2) + '\n';
    this.watcher.suppress(relPath);
    const tmp = `${abs}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, abs);
  }

  /** Remove `<type>/<slug>.json` (atomic suppress; ignore if already gone). */
  remove(type: RawEntityType, slug: string): void {
    const relPath = this.relPathFor(type, slug);
    this.watcher.suppress(relPath);
    try {
      fs.unlinkSync(this.absFor(relPath));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  listType(type: RawEntityType): string[] {
    const dir = path.join(this.root, type);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
      .map((f) => f.slice(0, -'.json'.length))
      .sort();
  }

  listAll(): EntityStoreFile[] {
    const out: EntityStoreFile[] = [];
    for (const type of ENTITY_TYPE_DIRS) {
      for (const slug of this.listType(type)) {
        out.push({ type, slug, relPath: this.relPathFor(type, slug) });
      }
    }
    return out;
  }

  // ─── tags.json ──────────────────────────────────────────────────────────

  readTags(): TagSnapshot[] {
    const abs = path.join(this.root, TAGS_FILE);
    if (!fs.existsSync(abs)) return [];
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf-8')) as unknown;
    return Array.isArray(parsed) ? (parsed as TagSnapshot[]) : [];
  }

  writeTags(tags: TagSnapshot[]): void {
    const sorted = [...tags].sort((a, b) => a.slug.localeCompare(b.slug));
    this.writeRel(TAGS_FILE, sorted);
  }

  // ─── derive-from-index helpers (write-path + boot export) ─────────────────

  /**
   * Snapshot the entity's CURRENT index row and write its file. The snapshot is
   * derived via `host.snapshot` (the single source of snapshot truth) so the
   * file always equals what a rebuild would produce. Called by services after a
   * committed mutation, and by the boot DB→text export.
   */
  persist(type: RawEntityType, slug: string): void {
    const entity = this.reader.getEntity(type, slug);
    if (!entity) throw new DomainError('NOT_FOUND', `${type} '${slug}' not found for persist`);
    const snap = this.host.snapshot(type, entity, { reader: this.reader, depth: 0, maxDepth: 1 });
    this.write(type, slug, snap);
  }

  /** Read the full tag registry from the index and write tags.json. */
  persistTags(): void {
    const tags: TagSnapshot[] = this.reader.listTags().map((t) => ({
      slug: t.slug,
      name: t.name,
      color: t.color,
      description: t.description,
    }));
    this.writeTags(tags);
  }
}
