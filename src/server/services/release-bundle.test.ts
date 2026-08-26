/**
 * The bundle's `entities/` layout (v4).
 *
 * `buildBundleArchive` is the pure `(snapshot, release, config) → bytes` half of
 * the release tier — no DB, no host, no project — so it can be exercised
 * directly. Which is worth doing: before 0.2.11 this module had no test file at
 * all, and it silently dropped every entity type outside a hand-written map of
 * five.
 *
 * 0.2.24 replaced the file-per-TYPE layout with a file-per-ENTITY tree mirroring
 * the M29 store, so the type↔file-name derivation this file used to pin is gone
 * in both directions: the writer takes the directory name from the registry, and
 * the reader takes the type from each legacy entry's own `type` field.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUNDLE_SCHEMA_VERSION,
  buildBundleArchive,
  extractBundleStream,
  readBundleEntities,
  type BundleEntityInput,
  type BundleManifest,
  type BundleTagInput,
} from './release-bundle.js';
import type { NormalizedConfig } from '../config.js';
import type { Release, SpecSnapshot } from '../../shared/entities.js';

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
  entities: ['endpoint', 'design-system', 'diagram'],
  agent: { claudeUsePreset: false, disableDirectFilesystemAccess: true },
} as unknown as NormalizedConfig;

const VERSIONS: Record<string, string> = {
  endpoint: '3',
  'design-system': '3',
  diagram: '2',
  page: '1.0.0',
};

function snapshotWith(versions: Record<string, string> = VERSIONS): SpecSnapshot {
  return {
    release: RELEASE,
    entities: [],
    pages: [],
    serializer_versions: versions,
  } as unknown as SpecSnapshot;
}

/** Build, extract, hand the caller the extracted dir, always clean up. */
async function build(
  rows: BundleEntityInput[],
  tags: BundleTagInput[] | null = null,
  versions: Record<string, string> = VERSIONS,
): Promise<{ dir: string; cleanup: () => void }> {
  const result = await buildBundleArchive(snapshotWith(versions), RELEASE, CONFIG, [], rows, tags);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-bundle-test-'));
  await extractBundleStream(fs.createReadStream(result.tarGzPath), dir);
  return {
    dir,
    cleanup: () => {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(result.tarGzPath, { force: true }); // buildBundleArchive does not
    },
  };
}

describe('buildBundleArchive — entity layout', () => {
  it('writes one file per entity, under a directory named by its type', async () => {
    const { dir, cleanup } = await build([
      { type: 'endpoint', slug: 'e-1', data: { slug: 'e-1', payloadVersion: 3 } },
      { type: 'endpoint', slug: 'e-2', data: { slug: 'e-2', payloadVersion: 3 } },
      { type: 'design-system', slug: 'ds-1', data: { slug: 'ds-1', title: 'DS', payloadVersion: 3 } },
      { type: 'diagram', slug: 'd-1', data: { slug: 'd-1', format: 'mermaid', payloadVersion: 2 } },
    ]);
    try {
      const entities = path.join(dir, 'entities');
      expect(fs.readdirSync(entities).sort()).toEqual(['design-system', 'diagram', 'endpoint']);
      expect(fs.readdirSync(path.join(entities, 'endpoint')).sort()).toEqual(['e-1.json', 'e-2.json']);
      expect(JSON.parse(fs.readFileSync(path.join(entities, 'design-system', 'ds-1.json'), 'utf8'))).toEqual({
        slug: 'ds-1',
        title: 'DS',
        payloadVersion: 3,
      });
    } finally {
      cleanup();
    }
  });

  /**
   * The entry is the STORE's file — payload plus envelope, and nothing else. In
   * particular no `op`: an archive carries state, so an incremental import
   * derives deletions from the difference of slug sets rather than from a field
   * the writer would have to keep honest.
   */
  it('carries no `op` field on an entry', async () => {
    const { dir, cleanup } = await build([
      { type: 'endpoint', slug: 'e-1', data: { slug: 'e-1', payloadVersion: 3 } },
    ]);
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(dir, 'entities/endpoint/e-1.json'), 'utf8'));
      expect(entry).not.toHaveProperty('op');
    } finally {
      cleanup();
    }
  });

  it('declares the current schema version in the manifest and the result', async () => {
    const result = await buildBundleArchive(snapshotWith(), RELEASE, CONFIG, [], [], null);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-bundle-test-'));
    try {
      await extractBundleStream(fs.createReadStream(result.tarGzPath), dir);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as BundleManifest;
      expect(manifest.bundleSchemaVersion).toBe(BUNDLE_SCHEMA_VERSION);
      expect(result.bundleSchemaVersion).toBe(BUNDLE_SCHEMA_VERSION);
      expect(BUNDLE_SCHEMA_VERSION).toBe(4);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(result.tarGzPath, { force: true });
    }
  });

  /**
   * `{directories} ⊆ ({keys} \ {page})`. A directory the manifest cannot account
   * for leaves the reader with no payload version to upgrade its entries from,
   * so it is caught at write time rather than shipped.
   */
  it('refuses a type with no serializerVersions key', async () => {
    await expect(
      buildBundleArchive(
        snapshotWith(),
        RELEASE,
        CONFIG,
        [],
        [{ type: 'retired', slug: 'r-1', data: { slug: 'r-1' } }],
        null,
      ),
    ).rejects.toThrow(/no 'retired' key in manifest.serializerVersions/);
  });

  it('refuses `page` as an entity directory even though it is a key', async () => {
    await expect(
      buildBundleArchive(
        snapshotWith(),
        RELEASE,
        CONFIG,
        [],
        [{ type: 'page', slug: 'p-1', data: { slug: 'p-1' } }],
        null,
      ),
    ).rejects.toThrow(/no 'page' key/);
  });

  /** The identity IS the path, so a segment that escapes it is refused. */
  it.each([
    ['a slug with a separator', { type: 'endpoint', slug: '../escape', data: {} }],
    ['a traversal slug', { type: 'endpoint', slug: '..', data: {} }],
    ['a type with a separator', { type: 'a/b', slug: 'x', data: {} }],
  ])('refuses %s', async (_label, row) => {
    await expect(
      buildBundleArchive(snapshotWith(), RELEASE, CONFIG, [], [row as BundleEntityInput], null),
    ).rejects.toThrow(/unsafe entity (type|slug)/);
  });
});

describe('buildBundleArchive — entities/tags.json', () => {
  it('writes the definitions sorted by slug, inside entities/', async () => {
    const { dir, cleanup } = await build(
      [{ type: 'endpoint', slug: 'e-1', data: { slug: 'e-1', tags: ['zebra', 'alpha'] } }],
      [
        { slug: 'zebra', name: 'Zebra', color: '#000', description: null },
        { slug: 'alpha', name: 'Alpha', color: null, description: 'first' },
      ],
    );
    try {
      const tags = JSON.parse(fs.readFileSync(path.join(dir, 'entities/tags.json'), 'utf8'));
      expect(tags.map((t: BundleTagInput) => t.slug)).toEqual(['alpha', 'zebra']);
      expect(tags[0]).toEqual({ slug: 'alpha', name: 'Alpha', color: null, description: 'first' });
    } finally {
      cleanup();
    }
  });

  /** No `tags.json` on disk ⇒ no file in the bundle, and that is not an error. */
  it('omits the file when the project has no tag registry', async () => {
    const { dir, cleanup } = await build(
      [{ type: 'endpoint', slug: 'e-1', data: { slug: 'e-1' } }],
      null,
    );
    try {
      expect(fs.existsSync(path.join(dir, 'entities/tags.json'))).toBe(false);
    } finally {
      cleanup();
    }
  });

  /** It lives in `entities/`, mirroring the store — not at the archive root. */
  it('is not written at the archive root', async () => {
    const { dir, cleanup } = await build(
      [{ type: 'endpoint', slug: 'e-1', data: { slug: 'e-1' } }],
      [{ slug: 'alpha', name: 'Alpha', color: null, description: null }],
    );
    try {
      expect(fs.existsSync(path.join(dir, 'tags.json'))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'entities/tags.json'))).toBe(true);
    } finally {
      cleanup();
    }
  });

  /** A release with no entities can still carry a registry the clone needs. */
  it('is written even when the release has no entities', async () => {
    const { dir, cleanup } = await build([], [
      { slug: 'alpha', name: 'Alpha', color: null, description: null },
    ]);
    try {
      expect(fs.existsSync(path.join(dir, 'entities/tags.json'))).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe('readBundleEntities', () => {
  const ACTIVE = (t: string): boolean => ['endpoint', 'dto', 'design-system', 'diagram'].includes(t);

  /** Lay out a tree under a temp `entities/` and read it back. */
  function withEntitiesDir(files: Record<string, unknown>, fn: (dir: string) => void): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-read-test-'));
    const dir = path.join(root, 'entities');
    try {
      for (const [rel, body] of Object.entries(files)) {
        const abs = path.join(dir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, JSON.stringify(body, null, 2), 'utf8');
      }
      fs.mkdirSync(dir, { recursive: true });
      fn(dir);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  it('reads the v4 tree, taking type from the directory and slug from the file name', () => {
    withEntitiesDir(
      {
        'endpoint/get-users.json': { slug: 'get-users', title: 'GET /users' },
        'endpoint/get-orders.json': { slug: 'get-orders', title: 'GET /orders' },
        'dto/user.json': { slug: 'user', title: 'User' },
      },
      (dir) => {
        const byType = readBundleEntities(dir, 4, ACTIVE);
        expect([...byType.keys()].sort()).toEqual(['dto', 'endpoint']);
        expect(byType.get('endpoint')!.map((r) => r.slug).sort()).toEqual(['get-orders', 'get-users']);
      },
    );
  });

  /**
   * The slug is create-time and may legitimately diverge from `slugify(title)`,
   * so the FILE NAME is authoritative. A body that disagrees is not a rename to
   * honour — it is an archive whose two statements of identity do not match.
   */
  it('refuses an entry whose body slug disagrees with its file name', () => {
    withEntitiesDir({ 'endpoint/get-users.json': { slug: 'something-else' } }, (dir) => {
      expect(() => readBundleEntities(dir, 4, ACTIVE)).toThrow(/file name is authoritative/);
    });
  });

  it('accepts a body carrying no slug at all — the path already says it', () => {
    withEntitiesDir({ 'endpoint/get-users.json': { title: 'GET /users' } }, (dir) => {
      expect(readBundleEntities(dir, 4, ACTIVE).get('endpoint')![0]!.slug).toBe('get-users');
    });
  });

  /**
   * Without this rule `tags.json` would be read as a type NAMED `tags.json` —
   * a spurious BUNDLE_UNKNOWN_ENTITY_TYPE, or a silent drop.
   */
  it('skips entities/tags.json rather than reading it as a type', () => {
    withEntitiesDir(
      {
        'tags.json': [{ slug: 'api', name: 'API', color: null, description: null }],
        'endpoint/get-users.json': { slug: 'get-users' },
      },
      (dir) => {
        expect([...readBundleEntities(dir, 4, ACTIVE).keys()]).toEqual(['endpoint']);
      },
    );
  });

  it('refuses any OTHER file sitting directly in entities/', () => {
    withEntitiesDir({ 'stray.json': [{ type: 'endpoint', slug: 'x', data: {} }] }, (dir) => {
      expect(() => readBundleEntities(dir, 4, ACTIVE)).toThrow(/type is a DIRECTORY/);
    });
  });

  it('refuses an inactive type even when its directory is empty', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-read-test-'));
    try {
      fs.mkdirSync(path.join(root, 'entities', 'retired'), { recursive: true });
      expect(() => readBundleEntities(path.join(root, 'entities'), 4, ACTIVE)).toThrow(
        /'retired' is not active locally/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * v2 and v3 differ only in how the writer NAMED these files, and the reader
   * never used the name — it takes the type from inside each entry. So one
   * branch serves both, and the singular→plural map stays dead in both
   * directions.
   */
  it.each([2, 3])('reads a v%i flat archive by the entry\'s own `type` field', (version) => {
    withEntitiesDir(
      {
        // Deliberately misleading names: v2 would have written `dtos.json`, v3
        // `endpoints.json`. Neither is consulted.
        'whatever.json': [
          { type: 'endpoint', slug: 'get-users', op: 'create', data: { slug: 'get-users' } },
          { type: 'dto', slug: 'user', op: 'update', data: { slug: 'user' } },
        ],
      },
      (dir) => {
        const byType = readBundleEntities(dir, version, ACTIVE);
        expect(byType.get('endpoint')!.map((r) => r.slug)).toEqual(['get-users']);
        expect(byType.get('dto')!.map((r) => r.slug)).toEqual(['user']);
      },
    );
  });

  it('drops delete tombstones from a legacy archive', () => {
    withEntitiesDir(
      {
        'endpoints.json': [
          { type: 'endpoint', slug: 'kept', op: 'create', data: {} },
          { type: 'endpoint', slug: 'gone', op: 'delete', data: {} },
        ],
      },
      (dir) => {
        expect(readBundleEntities(dir, 3, ACTIVE).get('endpoint')!.map((r) => r.slug)).toEqual(['kept']);
      },
    );
  });

  it('refuses a legacy entry naming a locally inactive type', () => {
    withEntitiesDir({ 'x.json': [{ type: 'retired', slug: 'r', op: 'create', data: {} }] }, (dir) => {
      expect(() => readBundleEntities(dir, 2, ACTIVE)).toThrow(/'retired' is not active locally/);
    });
  });
});

describe('buildBundleArchive — round trip', () => {
  /**
   * The point of v4: what the writer lays out is what the reader recovers, with
   * the identity carried by the path on both sides.
   */
  it('recovers every entity the writer laid out', async () => {
    const rows: BundleEntityInput[] = [
      { type: 'endpoint', slug: 'e-1', data: { slug: 'e-1', title: 'GET /a', payloadVersion: 3 } },
      { type: 'endpoint', slug: 'e-2', data: { slug: 'e-2', title: 'GET /b', payloadVersion: 3 } },
      { type: 'diagram', slug: 'd-1', data: { slug: 'd-1', payloadVersion: 2 } },
    ];
    const { dir, cleanup } = await build(rows, [
      { slug: 'api', name: 'API', color: null, description: null },
    ]);
    try {
      const byType = readBundleEntities(path.join(dir, 'entities'), BUNDLE_SCHEMA_VERSION, () => true);
      expect(byType.get('endpoint')!.map((r) => r.slug).sort()).toEqual(['e-1', 'e-2']);
      expect(byType.get('diagram')![0]!.data).toEqual({ slug: 'd-1', payloadVersion: 2 });
    } finally {
      cleanup();
    }
  });
});

describe('buildBundleArchive — sanitized config', () => {
  it('carries only releasable roots and the allow-listed keys', async () => {
    const { dir, cleanup } = await build([]);
    try {
      const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
      expect(Object.keys(config).sort()).toEqual([
        '$schemaVersion',
        'agent',
        'entities',
        'name',
        'onboardingCompleted',
        'roots',
        'writingStyle',
      ]);
      for (const excluded of ['pagesDir', 'mode', 'briefsDir', 'patchesDir', 'plansDir', 'entitiesDir', 'releasesDir', 'remoteApiUrl']) {
        expect(config).not.toHaveProperty(excluded);
      }
      /**
       * 0.2.53: the working convention travels (verdict KEEP) so a clone
       * reproduces a project whose agent works through core operations. The
       * path scope does NOT — absolute paths from another machine mean nothing
       * here, and that asymmetry is the point of the allow-list.
       */
      expect(config.agent).toEqual({ claudeUsePreset: false, disableDirectFilesystemAccess: true });
      expect(config.agent).not.toHaveProperty('allowedPaths');
      expect(config.agent).not.toHaveProperty('disallowedPaths');
    } finally {
      cleanup();
    }
  });
});
