/**
 * Portable bundle — the third representation of a spec (alongside live HEAD and
 * versioned history). A `tar.gz` holding the full, self-contained state of a
 * release N, derived ONLY from the versioning tables (via `getReleaseSnapshot`),
 * never from `pagesDir` on disk or entity HEADs.
 *
 * Spec reference: briefs `0-1-27-to-0-1-28.md` and `0-2-23-to-0-2-24.md`. Direct
 * consumers: M25 (push to remote) writes; M27 (project clone / `c4s import`)
 * reads. The restore direction lives in `ReleaseService.restoreBundleArchive`.
 *
 * Since v4 the `entities/` tree is the M29 store's tree — same paths, same file
 * contents. The two differ only in SOURCE: the store reads HEAD, the bundle
 * derives entities from `entity_version` filtered by release. That is what makes
 * restore an unpack rather than a format translation. `tags.json` is the one
 * exception on both sides: it has no version table, so it is copied from HEAD.
 *
 * This module owns the pure write logic + the constants/types the read side
 * imports. The two public methods stay on `ReleaseService` per the M17 contract;
 * they are thin delegations to `buildBundleArchive(...)` here.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { create as tarCreate, extract as tarExtract } from 'tar';
import { nanoid } from 'nanoid';
import type { Release, SpecSnapshot } from '../../shared/entities.js';
import type { Root } from '../../shared/types.js';
import type { Config, NormalizedConfig } from '../config.js';
import { DomainError } from './tags.js';

/**
 * Bundle layout version. Bump = breaking change in the bundle shape (layout,
 * manifest, sanitization semantics). Import compares
 * `manifest.bundleSchemaVersion` against the highest version it supports →
 * greater ⇒ `BUNDLE_SCHEMA_UNSUPPORTED`. NOT bumped when an entity's
 * `serializer_version` changes — each bundle is self-contained w.r.t. entity
 * schema (carried per-type in the manifest's `serializerVersions`).
 *
 * The full history, which until 0.2.24 lived only in the reader's branches:
 *
 * | v | shipped | `entities/` layout                          | pages          |
 * |---|---------|---------------------------------------------|----------------|
 * | 1 | 0.1.28  | `<typePlural>.json`, static singular→plural  | flat `pages/`  |
 * | 2 | 0.1.96  | `<typePlural>.json`, static singular→plural  | `<rootId>/…`   |
 * | 3 | 0.2.11  | `<name>.json`, name from `pathPrefix`        | `<rootId>/…`   |
 * | 4 | 0.2.24  | `<type>/<slug>.json` + `tags.json`           | `<rootId>/…`   |
 *
 * v2 added `manifest.roots[]` and swapped the sanitized config's `pagesDir`
 * scalar for `roots[]`. v3 changed only how an entity FILE was named, so that a
 * plugin type could appear in an archive at all. v4 changes the layout itself:
 * one file per entity, mirroring the M29 store byte for byte, so restore is an
 * unpack rather than a translation — plus `entities/tags.json`, and no `op`
 * field, because an archive carries state and not a delta.
 *
 * WHY 4 AND NOT 3. Brief `0-2-23-to-0-2-24` specifies this layout as `3`,
 * reading the flat `entities/<typePlural>.json` shape as the current one. It is
 * not: `3` shipped in 0.2.11 and blobs declaring it are already out there, on a
 * remote that stores them append-only with no retention policy. Reusing `3`
 * would put two incompatible `entities/` layouts under one declared version with
 * nothing to tell them apart — exactly the failure this constant exists to
 * prevent, and one that presents as data corruption rather than version skew.
 * The deviation is filed as a drift patch against the brief.
 *
 * Reading v3 costs nothing extra: its file names were already irrelevant to the
 * reader, which takes the type from each entry's own `type` field, so v3 and v2
 * share one branch.
 */
export const BUNDLE_SCHEMA_VERSION = 4 as const;

/** The oldest layout whose `entities/` is an array-per-file rather than a tree. */
export const BUNDLE_LEGACY_ENTITY_LAYOUT_MAX = 3 as const;

/** `entities/tags.json` — the one file allowed at the top of `entities/`. */
export const BUNDLE_TAGS_FILE = 'tags.json';

/** One releasable page root as carried by the bundle manifest (id/name/dir only). */
export interface BundleRoot {
  id: string;
  name: string;
  dir: string;
}

/** Sanitized `config.json` shape embedded in the bundle (white-list, see below). */
export interface BundleConfig {
  $schemaVersion: number;
  name: string;
  /**
   * v2 (0.1.96): releasable page roots (was the `pagesDir` scalar in v1). v1
   * bundles carry `pagesDir` instead — the read direction maps it to a single
   * built-in `pages` root via the v3→v4 config path.
   */
  roots: Root[];
  writingStyle: string | null;
  onboardingCompleted: boolean;
  entities?: string[];
  agent?: { claudeUsePreset?: boolean };
}

export interface BundleManifest {
  /**
   * The version this bundle was WRITTEN at. Not pinned to a single literal: the
   * read path parses manifests from older bundles into this same shape, and
   * `restoreBundleArchive` branches on the value (v1 has a flat `pages/` tree and
   * no `roots[]`). Pinning it to the current constant would make every older
   * manifest un-typeable at the very site that has to handle them.
   */
  bundleSchemaVersion: number;
  /**
   * v2 (0.1.96): releasable roots present in the bundle (id/name/dir only). The
   * pages tree is laid out under `<rootId>/…`. Absent on v1 bundles (flat `pages/`).
   */
  roots: BundleRoot[];
  release: {
    id: number;
    name: string;
    description: string;
    createdAt: string; // ISO 8601 — copy of spec_release.created_at
  };
  /** Informational (debug/audit) — restore does NOT reject by this, only by `bundleSchemaVersion`. */
  c4sVersion: string;
  /** Build moment — `new Date().toISOString()`, distinct from `release.createdAt`. */
  createdAt: string;
  /**
   * Per-type payload versions at capture time: one key per ACTIVE entity type
   * (0.2.11 — no longer a fixed six), plus `page`. The snapshot model carries
   * them per-type, not per-entity, and the reader upgrades each entry from the
   * version recorded here.
   *
   * Keys are the type id, and from v4 they are also the `entities/` directory
   * names: `{directories in entities/} ⊆ ({keys} \ {page})`. Containment, not
   * equality — a key with no directory just means the release has no entity of
   * that type, while a directory with no key is a corrupt archive.
   *
   * The historical name is kept deliberately: the value is the type's
   * `payloadVersion`, and renaming the field would be a migration with no gain.
   */
  serializerVersions: Record<string, string>;
}

/**
 * One entity as it is laid out in a v4 bundle: `entities/<type>/<slug>.json`.
 *
 * The file's CONTENT is the M29 store's file, byte for byte — the snapshot
 * generated from the type's logical schema plus the envelope (`createdAt` /
 * `updatedAt` / `payloadVersion`). The identity lives in the PATH: the directory
 * names the type, the file names the slug, and the slug is authoritative there
 * because it is create-time and may legitimately diverge from `slugify(title)`.
 * There is no `op` — an archive carries state, so an incremental import derives
 * deletions from the difference of slug sets instead.
 */
export interface BundleEntityInput {
  type: string;
  slug: string;
  /** The store-shaped payload, envelope included. */
  data: unknown;
}

/** A tag definition as carried by `entities/tags.json` (mirror of the M29 store's file). */
export interface BundleTagInput {
  slug: string;
  name: string;
  color: string | null;
  description: string | null;
}

export interface BuildBundleResult {
  tarGzPath: string;
  sizeBytes: number;
  sha256: string; // lowercase hex64
  bundleSchemaVersion: number;
}

/**
 * One page to lay out in the bundle, carrying its `rootId` (the snapshot's
 * `SpecSnapshotPageRow` does not — the caller resolves `rootId` straight from
 * `file_version`). Delete tombstones are skipped by the writer.
 */
export interface BundlePageInput {
  rootId: string;
  path: string;
  op: 'create' | 'update' | 'delete';
  content: string;
}

/** claude4spec version read once at module load (pattern from `src/bin/c4s-mcp.ts`). */
function readC4sVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, '..', 'package.json'),
      path.resolve(here, '..', '..', 'package.json'),
      path.resolve(here, '..', '..', '..', 'package.json'),
      path.resolve(here, '..', '..', '..', '..', 'package.json'),
    ];
    for (const pkgPath of candidates) {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
        if (pkg.version) return pkg.version;
      }
    }
  } catch {
    /* ignore — fall through to fallback */
  }
  return '0.0.0';
}

export const C4S_VERSION = readC4sVersion();

/**
 * Explicit allow-list (fail-closed). This is the ONLY edit point when M01 adds
 * a new `Config` field: a new field is dropped from the bundle until someone
 * consciously decides to keep it here. No allow-list entry → no leak.
 */
export function sanitizeConfigForBundle(config: NormalizedConfig): BundleConfig {
  // 0.1.96: only releasable roots enter the bundle (their pages are the only
  // ones snapshotted); non-releasable / brief / patch roots fall out here. Any
  // `linkTargets` pointing at a dropped root must also be pruned, else clone/
  // import would fail parseRootsArray with a "dangling link scope" error.
  const releasable = config.roots.filter((r) => r.releasable);
  const keptIds = new Set(releasable.map((r) => r.id));
  const roots = releasable.map((r) => ({
    ...r,
    linkTargets: r.linkTargets.filter((id) => keptIds.has(id)),
  }));
  return {
    $schemaVersion: config.$schemaVersion,
    name: config.name,
    roots,
    writingStyle: config.writingStyle,
    onboardingCompleted: config.onboardingCompleted,
    entities: config.entities,
    agent: { claudeUsePreset: config.agent.claudeUsePreset },
  };
}

/**
 * Refuse a type or slug that would not survive a round trip through the archive
 * path. From v4 the identity of an entity IS its path, so a segment carrying a
 * separator, a traversal or a null byte is not a naming quirk — it is a way to
 * write outside `entities/`, and a way for the reader to recover a different
 * identity than the writer meant.
 */
function assertSafeBundleSegment(segment: string, what: string): void {
  if (
    segment === '' ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('/') ||
    segment.includes('\\') ||
    segment.includes('\0')
  ) {
    throw new DomainError('BUNDLE_MALFORMED_ENTRY', `unsafe ${what} '${segment}' for a bundle path`);
  }
}

/** Recursively collect file entries under `dir`, as sorted posix-style relative paths. */
function collectSortedEntries(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else out.push(childRel);
    }
  };
  walk(dir, '');
  return out.sort();
}

/** Streaming SHA-256 over a file → lowercase hex64. */
export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Build a portable `tar.gz` for release N from an already-resolved snapshot.
 *
 * Pure `(snapshot, release, config) → bytes` — no DB / disk reads beyond the
 * temp working dir. The caller (`ReleaseService.buildBundleArchive`) resolves
 * `snapshot`/`release` from the versioning tables and `config` via `readConfig`.
 *
 * Determinism: entries are sorted and tar headers use `portable` + `noMtime` to
 * strip system-specific noise. The returned `sha256` is an integrity hash over
 * the ACTUAL produced bytes (round-trip self-consistent) — gzip OS-byte/level
 * differences mean it is NOT a cross-machine reproducible build hash.
 *
 * `tarGzPath` is NOT cleaned up here — the consumer (M25 push / M26 import /
 * test) owns it. The internal temp dir IS cleaned up in `finally`.
 */
export async function buildBundleArchive(
  snapshot: SpecSnapshot,
  release: Release,
  config: NormalizedConfig,
  pageRows: BundlePageInput[],
  /**
   * The release's entities in STORE shape — one entry per file to lay out,
   * already stamped with its envelope and already filtered of delete tombstones
   * and inactive types by the caller.
   *
   * A parameter rather than a derivation from `snapshot.entities` inside this
   * module: `release-bundle.ts` deliberately depends on nothing but node,
   * `shared/` and the config — it is the pure `(snapshot, release, config) →
   * bytes` half, which is what makes it testable without standing up a project.
   * Stamping the envelope needs the host registry, which `ReleaseService` holds.
   */
  entityRows: readonly BundleEntityInput[],
  /**
   * Tag definitions for `entities/tags.json`, copied from HEAD and already
   * filtered to the slugs this release's entities actually carry. `null` when
   * the project has no `tags.json` on disk — the file is then simply absent,
   * which is not an error.
   */
  tagDefs: readonly BundleTagInput[] | null,
): Promise<BuildBundleResult> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-bundle-'));
  try {
    // 0.1.96: only releasable roots are carried (manifest + layout dirs).
    const releasableRoots: BundleRoot[] = config.roots
      .filter((r) => r.releasable)
      .map((r) => ({ id: r.id, name: r.name, dir: r.dir }));

    // 1. manifest.json
    const manifest: BundleManifest = {
      bundleSchemaVersion: BUNDLE_SCHEMA_VERSION,
      roots: releasableRoots,
      release: {
        id: release.id,
        name: release.name,
        description: release.description,
        createdAt: release.createdAt,
      },
      c4sVersion: C4S_VERSION,
      createdAt: new Date().toISOString(),
      serializerVersions: snapshot.serializer_versions,
    };
    fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    // 2. config.json (sanitized allow-list)
    fs.writeFileSync(
      path.join(tempDir, 'config.json'),
      JSON.stringify(sanitizeConfigForBundle(config), null, 2),
      'utf8',
    );

    // 3. <rootId>/<path>.md — byte-equal content, skip delete tombstones. v2
    //    layout keys pages by root so the same relative path in two roots does
    //    not collide (v1 was a flat `pages/`).
    for (const page of pageRows) {
      if (page.op === 'delete') continue;
      const dest = path.join(tempDir, page.rootId, page.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, page.content, 'utf8');
    }

    // 4. entities/<type>/<slug>.json — one file per entity, mirroring the M29
    //    store. The type is the DIRECTORY and the slug is the FILE NAME, so the
    //    reader recovers both from the path without parsing anything.
    const entitiesDir = path.join(tempDir, 'entities');
    const writtenTypes = new Set<string>();
    if (entityRows.length > 0) {
      fs.mkdirSync(entitiesDir, { recursive: true });
      for (const entity of entityRows) {
        assertSafeBundleSegment(entity.type, 'entity type');
        assertSafeBundleSegment(entity.slug, 'entity slug');
        const dir = path.join(entitiesDir, entity.type);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, `${entity.slug}.json`),
          JSON.stringify(entity.data, null, 2) + '\n',
          'utf8',
        );
        writtenTypes.add(entity.type);
      }
    }

    // 4a. `{directories in entities/} ⊆ ({keys of serializerVersions} \ {page})`.
    //     Containment, not equality: a key with no directory is a release that
    //     simply has no entity of that type, but a directory the manifest cannot
    //     account for would leave the reader unable to resolve its payload
    //     version — which is a corrupt archive, caught here rather than shipped.
    for (const type of writtenTypes) {
      if (type === 'page' || snapshot.serializer_versions[type] === undefined) {
        throw new DomainError(
          'BUNDLE_MALFORMED_ENTRY',
          `entities/${type}/ has no '${type}' key in manifest.serializerVersions`,
        );
      }
    }

    // 4b. entities/tags.json — definitions copied from HEAD, already filtered to
    //     the slugs this release uses, sorted by slug for a stable diff. Tags are
    //     not a plugin-host entity type (there is no `tag_version`), so HEAD is
    //     the only source there is; `config.json` has taken the same path since
    //     v1. No file on disk ⇒ no file in the bundle, and that is not an error.
    if (tagDefs !== null) {
      fs.mkdirSync(entitiesDir, { recursive: true });
      const sorted = [...tagDefs].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
      fs.writeFileSync(
        path.join(entitiesDir, BUNDLE_TAGS_FILE),
        JSON.stringify(sorted, null, 2) + '\n',
        'utf8',
      );
    }

    // 5. tar -czf (sorted entries, portable headers for stable-ish output).
    const tarGzPath = path.join(os.tmpdir(), `c4s-bundle-${nanoid()}.tar.gz`);
    await tarCreate(
      { gzip: true, file: tarGzPath, cwd: tempDir, portable: true, noMtime: true },
      collectSortedEntries(tempDir),
    );

    // 6. SHA-256 + size of the final archive.
    const sha256 = await sha256File(tarGzPath);
    const sizeBytes = fs.statSync(tarGzPath).size;

    return { tarGzPath, sizeBytes, sha256, bundleSchemaVersion: BUNDLE_SCHEMA_VERSION };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ─── Read direction (M27 Project Clone) ──────────────────────────────────────

/** One entity recovered from an archive, before its payload upgrade. */
export interface BundleEntityOutput {
  slug: string;
  data: unknown;
}

/**
 * Read a bundle's `entities/` into `type → rows`, dispatching on the layout
 * version the manifest declares.
 *
 * **v4 is a TREE.** The directory names the type, the file names the slug, and
 * the slug from the PATH wins: it is create-time and may legitimately differ
 * from `slugify(title)`, so it is read literally rather than recomputed. A file
 * sitting directly in `entities/` is a malformed entry — `tags.json` is the one
 * exception and has its own handling. Without that rule it would be read as a
 * type named `tags.json`, which is a spurious `BUNDLE_UNKNOWN_ENTITY_TYPE` at
 * best and a silent drop at worst.
 *
 * **v1–v3 are FLAT** — `entities/<something>.json`, each an array of
 * `{type, slug, op, data}`. All three share one branch because the reader has no
 * use for the file NAMES: the type is inside every entry. That is what makes v3
 * (whose names came from `pathPrefix`) free to keep reading, and it is why the
 * singular→plural map is not resurrected in either direction.
 *
 * `isActive` decides whether a type can be restored here. It is fatal rather
 * than a skip: dropping every row of a type without saying so leaves a
 * half-restored spec, which is worse than a refused one.
 */
export function readBundleEntities(
  entitiesDir: string,
  schemaVersion: number,
  isActive: (type: string) => boolean,
): Map<string, BundleEntityOutput[]> {
  const byType = new Map<string, BundleEntityOutput[]>();
  const requireActive = (type: string): void => {
    if (isActive(type)) return;
    throw new DomainError(
      'BUNDLE_UNKNOWN_ENTITY_TYPE',
      `entity type '${type}' is not active locally — activate it in config.entities to import this bundle`,
    );
  };
  const push = (type: string, row: BundleEntityOutput): void => {
    requireActive(type);
    byType.set(type, [...(byType.get(type) ?? []), row]);
  };

  const entries = fs.readdirSync(entitiesDir, { withFileTypes: true });

  if (schemaVersion <= BUNDLE_LEGACY_ENTITY_LAYOUT_MAX) {
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const rows = JSON.parse(fs.readFileSync(path.join(entitiesDir, entry.name), 'utf8')) as Array<{
        type: string;
        slug: string;
        op?: string;
        data: unknown;
      }>;
      for (const row of rows) {
        if (row.op === 'delete') continue;
        push(row.type, { slug: row.slug, data: row.data });
      }
    }
    return byType;
  }

  for (const entry of entries) {
    if (entry.isFile()) {
      if (entry.name === BUNDLE_TAGS_FILE) continue;
      throw new DomainError(
        'BUNDLE_MALFORMED_ENTRY',
        `'entities/${entry.name}' is a file — in this layout a type is a DIRECTORY, ` +
          `and '${BUNDLE_TAGS_FILE}' is the only file allowed at this level`,
      );
    }
    if (!entry.isDirectory()) continue;
    // Checked on the DIRECTORY, so an empty one still refuses an inactive type
    // rather than passing for having no rows to object to.
    requireActive(entry.name);
    byType.set(entry.name, []);
    const typeDir = path.join(entitiesDir, entry.name);
    for (const file of fs.readdirSync(typeDir).filter((f) => f.endsWith('.json'))) {
      const slug = file.slice(0, -'.json'.length);
      const data = JSON.parse(fs.readFileSync(path.join(typeDir, file), 'utf8')) as unknown;
      const inBody = (data as { slug?: unknown } | null)?.slug;
      if (typeof inBody === 'string' && inBody !== slug) {
        throw new DomainError(
          'BUNDLE_MALFORMED_ENTRY',
          `entities/${entry.name}/${file} declares slug '${inBody}' — the file name is authoritative`,
        );
      }
      push(entry.name, { slug, data });
    }
  }
  return byType;
}

/**
 * Extract a bundle `tar.gz` stream into `destDir`. The inverse transport step of
 * {@link buildBundleArchive}'s `tarCreate`. Caller owns `destDir` (cleanup).
 */
export async function extractBundleStream(
  stream: NodeJS.ReadableStream,
  destDir: string,
): Promise<void> {
  await pipeline(stream, tarExtract({ cwd: destDir }));
}

/**
 * Cheaply read just `manifest.json` + `config.json` out of an already-downloaded
 * bundle tar.gz. Consumed by the M27 clone service for the `release_import`
 * audit row's `bundle_schema_version` and for the post-restore config patch
 * (name / entities) — facts that the `restoreBundleArchive(): Promise<SpecSnapshot>`
 * signature cannot carry. Missing manifest ⇒ `BUNDLE_MANIFEST_MISSING`.
 */
export async function readBundleMeta(
  tarGzPath: string,
): Promise<{ manifest: BundleManifest; config: BundleConfig | null }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-bundle-meta-'));
  try {
    await pipeline(fs.createReadStream(tarGzPath), tarExtract({ cwd: tmpDir }));
    const manifestPath = path.join(tmpDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new DomainError('BUNDLE_MANIFEST_MISSING', 'bundle is missing manifest.json');
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BundleManifest;
    const configPath = path.join(tmpDir, 'config.json');
    const config = fs.existsSync(configPath)
      ? (JSON.parse(fs.readFileSync(configPath, 'utf8')) as BundleConfig)
      : null;
    return { manifest, config };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
