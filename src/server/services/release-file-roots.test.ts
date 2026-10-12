import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from './release.js';
import { ReleaseFileStore } from './release-store.js';
import { buildBundleArchive, extractBundleStream, type BundleManifest } from './release-bundle.js';
import type { SelfWriteSuppressor } from '../fs/sources.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { FileSerializer } from './file-serializer.js';
import type { VersionService } from './versions.js';
import type { FileVersionService } from './file-version.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';
import type { NormalizedConfig } from '../config.js';
import type { Release, SpecSnapshot } from '../../shared/entities.js';

/**
 * 2.1.14 (M17 m17reldisk) — the lightweight release metadata file
 * `.claude4spec/releases/<slug>.json` records `roots` as the bare ids of the
 * `pages`-kind roots at the moment of the release (no `name`/`dir`). The richer
 * `{id,name,dir}` shape stays only in the bundle's `manifest.roots`.
 */

const fakeHost = { getEntity: () => null, listEntities: () => [] } as unknown as PluginHost;

describe('release metadata file roots (2.1.14)', () => {
  let dir: string;
  let db: Database.Database;
  let releases: ReleaseService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-release-roots-'));
    db = new Database(':memory:');
    runMigrations(db);
    const watcher = { suppress: () => {} } as SelfWriteSuppressor;
    const store = new ReleaseFileStore(dir, 'releases', watcher);
    store.ensureRoot();
    releases = new ReleaseService(
      db,
      fakeHost,
      {} as unknown as VersionService,
      { assignToRelease: () => {} } as unknown as FileVersionService,
      { version: 'v1' } as unknown as FileSerializer,
      {} as unknown as RawEntityReader,
      {} as unknown as TagsService,
      {} as unknown as PagesService,
      () => null,
      dir,
      ['pages', 'docs'],
      [path.join(dir, 'pages'), path.join(dir, 'docs')],
    );
    releases.setReleaseStore(store);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const readFile = (slug: string) =>
    JSON.parse(fs.readFileSync(path.join(dir, 'releases', `${slug}.json`), 'utf8')) as Record<string, unknown>;

  it('[section:m17reldisk] createRelease writes roots as the bare ids of the pages roots, not {id,name,dir} objects', () => {
    releases.createRelease({ name: '0.2.0', description: 'Git as an optional augmentation' }, 'user');
    const file = readFile('0-2-0');

    expect(file.roots).toEqual(['pages', 'docs']);
    for (const r of file.roots as unknown[]) expect(typeof r).toBe('string');
    // Metadata only: exactly the six identity keys, no manifest / gitSha / content.
    expect(Object.keys(file).sort()).toEqual(['createdAt', 'createdBy', 'description', 'name', 'roots', 'slug']);
    expect(file.slug).toBe('0-2-0');
  });

  it('[section:m17reldisk] updateRelease on the latest release rewrites the file keeping roots as bare ids', async () => {
    releases.createRelease({ name: 'v1', description: 'first' }, 'user');
    await releases.updateRelease({ releaseName: 'v1', name: 'v1 final', description: 'edited' });

    expect(fs.existsSync(path.join(dir, 'releases', 'v1.json'))).toBe(false);
    const file = readFile('v1-final');
    expect(file.description).toBe('edited');
    expect(file.roots).toEqual(['pages', 'docs']);
  });

  it('[section:m17reldisk] the bundle manifest.roots keeps the richer {id,name,dir} shape', async () => {
    const release: Release = {
      id: 1,
      name: '0.2.0',
      description: 'd',
      createdBy: 'user',
      createdAt: '2026-07-09T10:00:00.000Z',
    };
    const config = {
      $schemaVersion: 4,
      name: 'demo',
      roots: [
        { id: 'pages', name: 'Pages', dir: 'pages', builtin: true, linkTargets: [] },
        { id: 'docs', name: 'Docs', dir: 'documentation', builtin: false, linkTargets: [] },
      ],
      entities: [],
      agent: { claudeUsePreset: false, disableDirectFilesystemAccess: false },
    } as unknown as NormalizedConfig;
    const snapshot = {
      release,
      entities: [],
      pages: [],
      serializer_versions: { page: '1.0.0' },
    } as unknown as SpecSnapshot;

    const result = await buildBundleArchive(snapshot, release, config, [], [], null);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-release-roots-bundle-'));
    try {
      await extractBundleStream(fs.createReadStream(result.tarGzPath), out);
      const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')) as BundleManifest;
      expect(manifest.roots).toEqual([
        { id: 'pages', name: 'Pages', dir: 'pages' },
        { id: 'docs', name: 'Docs', dir: 'documentation' },
      ]);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
      fs.rmSync(result.tarGzPath, { force: true });
    }
  });
});
