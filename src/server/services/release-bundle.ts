/**
 * Portable bundle — the third representation of a spec (alongside live HEAD and
 * versioned history). A `tar.gz` holding the full, self-contained state of a
 * release N, derived ONLY from the versioning tables (via `getReleaseSnapshot`),
 * never from `pagesDir` on disk or entity HEADs.
 *
 * Spec reference: brief `0-1-27-to-0-1-28.md`. Direct consumers (future):
 * M25 (push to remote) writes; M26 (`c4s import`) reads. The restore direction
 * lives in `ReleaseService.restoreBundleArchive` (contract-only in v1).
 *
 * This module owns the pure write logic + the constants/types M26 will import.
 * The two public methods stay on `ReleaseService` per the M17 contract; they
 * are thin delegations to `buildBundleArchive(...)` here.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { create as tarCreate, extract as tarExtract } from 'tar';
import { nanoid } from 'nanoid';
import type { Release, SpecSnapshot, SpecSnapshotEntityRow } from '../../shared/entities.js';
import type { Root } from '../../shared/types.js';
import type { Config } from '../config.js';
import { DomainError } from './tags.js';

/**
 * Bundle layout version. Bump = breaking change in the bundle shape (layout,
 * manifest, sanitization semantics). M26 import compares
 * `manifest.bundleSchemaVersion` against the highest version it supports →
 * mismatch ⇒ `BUNDLE_SCHEMA_UNSUPPORTED`. NOT bumped when an entity's
 * `serializer_version` changes — each bundle is self-contained w.r.t. entity
 * schema (carried per-type in the manifest's `serializerVersions`).
 *
 * v2 (0.1.96 multiroot): pages are laid out as `<rootId>/<path>.md` (was flat
 * `pages/`); the manifest gains `roots[]` and the sanitized config carries
 * `roots[]` instead of the `pagesDir` scalar. v1 bundles (flat `pages/`, no
 * `manifest.roots`) are still readable — see `ReleaseService.restoreBundleArchive`.
 */
export const BUNDLE_SCHEMA_VERSION = 2 as const;

/**
 * Strict singular entity type → plural bundle file name. Published for M26
 * (read direction maps plural file → entity type via the reverse).
 */
export const ENTITY_TYPE_TO_PLURAL_FILE: Record<string, string> = {
  endpoint: 'endpoints.json',
  dto: 'dtos.json',
  'database-table': 'database-tables.json',
  'ui-view': 'ui-views.json',
  ac: 'acs.json',
};

/** Reverse of {@link ENTITY_TYPE_TO_PLURAL_FILE} — read direction (M27 clone). */
export const PLURAL_FILE_TO_ENTITY_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(ENTITY_TYPE_TO_PLURAL_FILE).map(([type, file]) => [file, type]),
);

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
  bundleSchemaVersion: 2;
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
  /** Informational (debug/audit) — M26 does NOT reject by this, only by `bundleSchemaVersion`. */
  c4sVersion: string;
  /** Build moment — `new Date().toISOString()`, distinct from `release.createdAt`. */
  createdAt: string;
  /**
   * Per-type serializer versions at capture time (keys: endpoint, dto,
   * database-table, ui-view, ac, page). The snapshot model carries serializer
   * versions per-type, not per-entity — see the brief drift patch. M26 reads
   * the version per type and delegates to the matching deserializer.
   */
  serializerVersions: Record<string, string>;
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
 * `page_version`). Delete tombstones are skipped by the writer.
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
export function sanitizeConfigForBundle(config: Config): BundleConfig {
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
    agent: { claudeUsePreset: config.agent?.claudeUsePreset },
  };
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
  config: Config,
  pageRows: BundlePageInput[],
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

    // 4. entities/<typePlural>.json — one file per active type with rows.
    const byType = new Map<string, SpecSnapshotEntityRow[]>();
    for (const entity of snapshot.entities) {
      if (entity.op === 'delete') continue;
      const list = byType.get(entity.type) ?? [];
      list.push(entity);
      byType.set(entity.type, list);
    }
    if (byType.size > 0) {
      const entitiesDir = path.join(tempDir, 'entities');
      fs.mkdirSync(entitiesDir, { recursive: true });
      for (const [type, rows] of byType) {
        const fileName = ENTITY_TYPE_TO_PLURAL_FILE[type];
        if (!fileName) continue; // defensively skip unknown types
        fs.writeFileSync(path.join(entitiesDir, fileName), JSON.stringify(rows, null, 2), 'utf8');
      }
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
