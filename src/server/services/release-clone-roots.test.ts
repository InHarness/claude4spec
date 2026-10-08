import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from './release.js';
import { FileVersionService } from './file-version.js';
import { buildBundleArchive } from './release-bundle.js';
import { buildClonePatch, rollbackClone, snapshotRootFiles } from './release-import.js';
import { builtinPagesRoot, type NormalizedConfig, type Root } from '../config.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { FileSerializer } from './file-serializer.js';
import type { VersionService } from './versions.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';
import type { Release, SpecSnapshot } from '../../shared/entities.js';

/**
 * 2.1.8 (M27 64bmqf81 / m27l13rt) — the clone materializes every root of kind
 * `pages` the bundle carries (layout A `<rootId>/<path>.md`) together with the
 * `config.roots[]` entries, and a failed clone rolls back the dirs of all roots
 * plus the system-root files restored in that run.
 */

const fakeFileSerializer = {
  version: 'v1',
  snapshotFromContent: (p: string, content: string) => ({ path: p, content }),
  snapshot: async (p: string) => ({ path: p, content: '' }),
} as unknown as FileSerializer;

const fakeHost = { listEntities: () => [], getEntity: () => null } as unknown as PluginHost;

const ROOTS: Root[] = [builtinPagesRoot(), { id: 'adr', name: 'ADRs', dir: 'docs/adr', builtin: false }];

describe('clone across page roots (2.1.8)', () => {
  let db: Database.Database;
  let cwd: string;
  let releases: ReleaseService;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-clone-roots-'));
    releases = new ReleaseService(
      db,
      fakeHost,
      {} as unknown as VersionService,
      new FileVersionService(db, fakeFileSerializer),
      fakeFileSerializer,
      {} as unknown as RawEntityReader,
      {} as unknown as TagsService,
      { rootId: 'pages', root: path.join(cwd, 'pages') } as unknown as PagesService,
      () => null,
      cwd,
      ['pages', 'adr'],
      [path.join(cwd, 'pages'), path.join(cwd, 'docs', 'adr')],
    );
  });

  afterEach(() => {
    db.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('[ac:ac-clone-restore-odtwarza-wszystkie-releasa] restore writes the pages of every pages-kind root to its dir and the clone carries the config.roots[] entries; a failed clone removes every root dir and the system-root files restored in the run', async () => {
    const release: Release = { id: 3, name: 'r3', description: '', createdBy: 'user', createdAt: '2026-01-01T00:00:00.000Z' };
    const snapshot = { release, entities: [], pages: [], serializer_versions: { page: '1.0.0' } } as unknown as SpecSnapshot;
    const config = {
      $schemaVersion: 4,
      name: 'Source',
      roots: ROOTS,
      writingStyle: null,
      onboardingCompleted: true,
      agent: { claudeUsePreset: false, disableDirectFilesystemAccess: true },
    } as unknown as NormalizedConfig;
    const built = await buildBundleArchive(
      snapshot,
      release,
      config,
      [
        { rootId: 'pages', path: 'intro.md', op: 'create', content: '# Pages intro\n' },
        { rootId: 'adr', path: 'intro.md', op: 'create', content: '# ADR intro\n' },
      ],
      [],
      null,
    );

    // A `.claude4spec/` that existed before the clone, with a pre-existing file in
    // the entities root: the rollback keeps both, it removes only what the run added.
    const entitiesDir = path.join(cwd, '.claude4spec', 'entities');
    fs.mkdirSync(entitiesDir, { recursive: true });
    fs.writeFileSync(path.join(entitiesDir, 'keep.txt'), 'pre-existing');
    const filesBefore = snapshotRootFiles(cwd, '.claude4spec/entities');
    expect(filesBefore).toEqual(['keep.txt']);

    try {
      const restored = await releases.restoreBundleArchive(fs.createReadStream(built.tarGzPath));
      // (1) the pages of BOTH roots, each under its own dir — same relPath, two files.
      expect(restored.pages.map((p) => p.path).sort()).toEqual(['intro.md', 'intro.md']);
      expect(fs.readFileSync(path.join(cwd, 'pages', 'intro.md'), 'utf8')).toBe('# Pages intro\n');
      expect(fs.readFileSync(path.join(cwd, 'docs', 'adr', 'intro.md'), 'utf8')).toBe('# ADR intro\n');
    } finally {
      fs.rmSync(built.tarGzPath, { force: true });
    }

    // (2) the config the clone writes carries every root entry of the bundle.
    const patch = buildClonePatch({ ...config, roots: ROOTS } as never, { projectId: 'p1', fallbackName: 'X' });
    expect(patch.roots?.map((r) => [r.id, r.dir])).toEqual([
      ['pages', 'pages'],
      ['adr', 'docs/adr'],
    ]);

    // Files the run restored into the pre-existing entities root.
    fs.mkdirSync(path.join(entitiesDir, 'ac'), { recursive: true });
    fs.writeFileSync(path.join(entitiesDir, 'ac', 'a.json'), '{}');
    fs.writeFileSync(path.join(entitiesDir, 'tags.json'), '[]');
    // A system root dir this run created from scratch.
    fs.mkdirSync(path.join(cwd, '.claude4spec', 'releases'), { recursive: true });

    rollbackClone(cwd, {
      rootDirs: ROOTS.map((r) => r.dir),
      systemRootDirs: ['.claude4spec/releases'],
      preexistingSystemRoots: [{ dir: '.claude4spec/entities', filesBefore }],
      configCreated: false,
      claudeDirCreated: false,
      gitignoreCreated: false,
    });

    // (3) every root dir is gone…
    expect(fs.existsSync(path.join(cwd, 'pages'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'docs', 'adr'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.claude4spec', 'releases'))).toBe(false);
    // …and so are the system-root files restored in the run, while what existed before stays.
    expect(fs.existsSync(path.join(entitiesDir, 'ac', 'a.json'))).toBe(false);
    expect(fs.existsSync(path.join(entitiesDir, 'tags.json'))).toBe(false);
    expect(fs.readFileSync(path.join(entitiesDir, 'keep.txt'), 'utf8')).toBe('pre-existing');
  });
});
