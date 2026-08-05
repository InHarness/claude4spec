/**
 * The bundle's type ↔ file-name rule (0.2.11).
 *
 * `buildBundleArchive` is the pure `(snapshot, release, config) → bytes` half of
 * the release tier — no DB, no host, no project — so it can be exercised
 * directly. Which is worth doing: before 0.2.11 this module had no test file at
 * all, and it silently dropped every entity type outside a hand-written map of
 * five.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bundleEntityFileMap,
  bundleEntityFileName,
  buildBundleArchive,
  extractBundleStream,
  type BundleEntityModule,
} from './release-bundle.js';
import type { NormalizedConfig } from '../config.js';
import type { Release, SpecSnapshot } from '../../shared/entities.js';

/** The six core types plus the external `database-table` plugin, real values. */
const MODULES: BundleEntityModule[] = [
  { type: 'endpoint', pathPrefix: '/endpoints' },
  { type: 'dto', pathPrefix: '/dtos' },
  { type: 'ui-view', pathPrefix: '/ui-views' },
  { type: 'ac', pathPrefix: '/acs' },
  { type: 'design-system', pathPrefix: '/design-systems' },
  { type: 'diagram', pathPrefix: '/diagrams' },
  { type: 'database-table', pathPrefix: '/database-tables' },
];

describe('bundleEntityFileName', () => {
  /**
   * THE regression net for this change. Every bundle ever produced carries these
   * five names, and `restoreBundleArchive` throws `BUNDLE_UNKNOWN_ENTITY_TYPE` on
   * a file it cannot map — so a derivation rule that renames any of them breaks
   * import and clone for every existing archive, silently and irreversibly.
   *
   * `ac` is the one that matters: `slugify(labelPlural)` — the obvious
   * alternative rule — yields `acceptance-criteria`, not `acs`.
   */
  it('reproduces every pre-0.2.11 file name exactly', () => {
    const { toFile } = bundleEntityFileMap(MODULES);
    expect(toFile.get('endpoint')).toBe('endpoints.json');
    expect(toFile.get('dto')).toBe('dtos.json');
    expect(toFile.get('ui-view')).toBe('ui-views.json');
    expect(toFile.get('ac')).toBe('acs.json');
    expect(toFile.get('database-table')).toBe('database-tables.json');
  });

  it('extends to the types the old static map omitted', () => {
    const { toFile } = bundleEntityFileMap(MODULES);
    expect(toFile.get('design-system')).toBe('design-systems.json');
    expect(toFile.get('diagram')).toBe('diagrams.json');
  });

  /**
   * The LAST segment, not the whole prefix with its leading slash stripped. The
   * spec documents `pathPrefix` as `/api/acs` while the code declares `/acs`;
   * taking the basename makes the rule indifferent to that, and means it can
   * never yield a name containing a path separator.
   */
  it('is indifferent to whether the prefix carries an /api mount', () => {
    expect(bundleEntityFileName({ type: 'ac', pathPrefix: '/acs' })).toBe('acs.json');
    expect(bundleEntityFileName({ type: 'ac', pathPrefix: '/api/acs' })).toBe('acs.json');
    expect(bundleEntityFileName({ type: 'ac', pathPrefix: 'acs/' })).toBe('acs.json');
  });

  it('refuses a prefix with no segment to name a file after', () => {
    expect(() => bundleEntityFileName({ type: 'ghost', pathPrefix: '/' })).toThrow(/pathPrefix/);
  });

  it('maps both directions', () => {
    const { toType } = bundleEntityFileMap(MODULES);
    expect(toType.get('acs.json')).toBe('ac');
    expect(toType.get('diagrams.json')).toBe('diagram');
  });

  /**
   * Two prefixes sharing a last segment would otherwise have one type's rows
   * silently overwrite the other's inside the archive.
   */
  it('throws BUNDLE_BASENAME_COLLISION rather than letting one type claim another file', () => {
    expect(() =>
      bundleEntityFileMap([
        { type: 'ac', pathPrefix: '/acs' },
        { type: 'ac-v2', pathPrefix: '/v2/acs' },
      ]),
    ).toThrow(/both map to bundle file 'acs.json'/);
  });

  it('tolerates the same module appearing twice', () => {
    const { toFile } = bundleEntityFileMap([MODULES[0]!, MODULES[0]!]);
    expect(toFile.get('endpoint')).toBe('endpoints.json');
  });
});

const RELEASE: Release = {
  id: 7,
  name: 'r7',
  description: 'seven',
  createdBy: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const CONFIG = {
  $schemaVersion: 4,
  name: 'demo',
  roots: [{ id: 'pages', name: 'Pages', dir: 'pages', releasable: true, linkTargets: [] }],
  writingStyle: null,
  onboardingCompleted: true,
  agent: { claudeUsePreset: false },
} as unknown as NormalizedConfig;

function snapshotWith(entities: SpecSnapshot['entities']): SpecSnapshot {
  return {
    release: RELEASE,
    entities,
    pages: [],
    serializerVersions: { endpoint: '1', 'design-system': '2', diagram: '1', page: '1.0.0' },
  } as unknown as SpecSnapshot;
}

describe('buildBundleArchive — entity layout', () => {
  /**
   * The bug this release fixes, end to end: a `design-system` and a `diagram`
   * had no entry in the old static map, so step 4's `if (!fileName) continue`
   * dropped them from every archive without a word.
   */
  it('lays out design-system and diagram alongside the types the old map knew', async () => {
    const { toFile } = bundleEntityFileMap(MODULES);
    const result = await buildBundleArchive(
      snapshotWith([
        { type: 'endpoint', slug: 'e-1', op: 'create', data: { slug: 'e-1' } },
        { type: 'design-system', slug: 'ds-1', op: 'create', data: { slug: 'ds-1', name: 'DS' } },
        { type: 'diagram', slug: 'd-1', op: 'create', data: { slug: 'd-1', format: 'mermaid' } },
      ] as SpecSnapshot['entities']),
      RELEASE,
      CONFIG,
      [],
      toFile,
    );

    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-bundle-test-'));
    try {
      await extractBundleStream(fs.createReadStream(result.tarGzPath), out);
      const entitiesDir = path.join(out, 'entities');
      expect(fs.readdirSync(entitiesDir).sort()).toEqual([
        'design-systems.json',
        'diagrams.json',
        'endpoints.json',
      ]);
      const ds = JSON.parse(fs.readFileSync(path.join(entitiesDir, 'design-systems.json'), 'utf8'));
      expect(ds).toEqual([{ type: 'design-system', slug: 'ds-1', op: 'create', data: { slug: 'ds-1', name: 'DS' } }]);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
      fs.rmSync(result.tarGzPath, { force: true }); // buildBundleArchive does not
    }
  });

  it('skips a type the host no longer knows rather than guessing a file name', async () => {
    const { toFile } = bundleEntityFileMap([MODULES[0]!]);
    const result = await buildBundleArchive(
      snapshotWith([
        { type: 'endpoint', slug: 'e-1', op: 'create', data: { slug: 'e-1' } },
        { type: 'retired', slug: 'r-1', op: 'create', data: { slug: 'r-1' } },
      ] as SpecSnapshot['entities']),
      RELEASE,
      CONFIG,
      [],
      toFile,
    );

    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-bundle-test-'));
    try {
      await extractBundleStream(fs.createReadStream(result.tarGzPath), out);
      expect(fs.readdirSync(path.join(out, 'entities'))).toEqual(['endpoints.json']);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
      fs.rmSync(result.tarGzPath, { force: true });
    }
  });
});
