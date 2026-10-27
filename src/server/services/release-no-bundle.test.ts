/**
 * 2.1.55 (M17) — a release is no longer a portable `tar.gz`. The bundle
 * archive, its `manifest.json` (dto `bundle-manifest`), the sanitized config
 * copy and the temp-file lifecycle are gone; a release's content is read from
 * the version tables (and from git when it is on), never from an archive.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, it, expect, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from './release.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { FileSerializer } from './file-serializer.js';
import type { VersionService } from './versions.js';
import type { FileVersionService } from './file-version.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';

const fakeHost = { listEntities: () => [], getEntity: () => null } as unknown as PluginHost;

describe('the release bundle archive is gone (2.1.55)', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('[entity:bundle-manifest] nothing builds or reads a bundle manifest: the bundle module is gone, the service has no archive methods, and a snapshot carries no manifest field', () => {
    // The module that declared `BundleManifest` and wrote `manifest.json` no
    // longer exists next to the release service (source or compiled form).
    for (const file of ['./release-bundle.ts', './release-bundle.js']) {
      expect(fs.existsSync(fileURLToPath(new URL(file, import.meta.url)))).toBe(false);
    }

    // Its only producer and its only reader left the service with it.
    for (const method of ['buildBundleArchive', 'restoreBundleArchive']) {
      expect(method in ReleaseService.prototype).toBe(false);
    }

    // What a release DOES hand out — its snapshot — is the version-table shape,
    // with none of the manifest's archive-only fields.
    db = new Database(':memory:');
    runMigrations(db);
    const releases = new ReleaseService(
      db,
      fakeHost,
      {} as unknown as VersionService,
      { assignToRelease: () => {} } as unknown as FileVersionService,
      { version: 'v1' } as unknown as FileSerializer,
      {} as unknown as RawEntityReader,
      {} as unknown as TagsService,
      {} as unknown as PagesService,
    );
    const snapshot = releases.getCurrentSnapshot();
    expect(Object.keys(snapshot).sort()).toEqual(['entities', 'pages', 'release', 'serializer_versions']);
    for (const field of ['bundleSchemaVersion', 'c4sVersion', 'roots', 'serializerVersions']) {
      expect(snapshot).not.toHaveProperty(field);
    }
  });
});
