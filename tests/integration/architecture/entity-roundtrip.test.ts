/**
 * 0.2.4 — the round trip is a FIXPOINT, so it is tested as one.
 *
 * `file → index → file` must be the identity. Once `createdAt`/`updatedAt` live
 * in the file, that stops being a nice property and becomes the thing the whole
 * tier rests on: if `persist(read(f))` is not byte-equal to `f`, then every
 * boot rewrites the entity files, every rebuild produces a git diff, and
 * `updatedAt` goes back to meaning "the indexer ran".
 *
 * Testing it per type would be five near-identical tests that each miss the
 * type nobody remembered to add. Testing the fixpoint over `store.listAll()`
 * covers determinism, envelope symmetry, verbatim restore and canonicalization
 * for every REGISTERED type at once — including plugin-contributed ones.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';
import { EntityIndexerService } from '../../../src/server/services/entity-indexer.js';
import { readSystemFields } from '../../../src/server/serialization/system-fields.js';
import { ReleaseService } from '../../../src/server/services/release.js';
import type { FileSerializer } from '../../../src/server/services/file-serializer.js';
import type { FileVersionService } from '../../../src/server/services/file-version.js';
import type { PagesService } from '../../../src/server/services/pages.js';

function indexerFor(t: TestApp): EntityIndexerService {
  return new EntityIndexerService(
    t.db,
    t.entityStore,
    t.entitiesWatcher,
    { broadcast: () => {} },
    t.host,
    t.tagsService,
    t.rawReader,
  );
}

function readAllFiles(t: TestApp): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of t.entityStore.listAll()) {
    const abs = path.join(t.entityStore.root, file.relPath);
    out.set(file.relPath, fs.readFileSync(abs, 'utf-8'));
  }
  return out;
}

/** A few entities across several types, created through the real REST surface. */
async function seed(t: TestApp): Promise<void> {
  const dto = await request(t.app).post('/api/dtos').send({ title: 'UserDto', fields: [] });
  expect(dto.status).toBe(201);
  const endpoint = await request(t.app)
    .post('/api/endpoints')
    .send({ method: 'GET', path: '/api/users', summary: 'list users', tags: ['alpha'] });
  expect(endpoint.status).toBe(201);
  const ac = await request(t.app).post('/api/acs').send({ title: 'the list is ordered' });
  expect(ac.status).toBe(201);
  const uiView = await request(t.app).post('/api/ui-views').send({ title: 'Users' });
  expect(uiView.status, JSON.stringify(uiView.body)).toBe(201);
}

describe('entity round trip is a fixpoint', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('[ac:ac-dwa-kolejne-snapshot-tej-samej-niezm] re-persisting every entity leaves its file byte-identical', async () => {
    await seed(t);
    await indexerFor(t).indexAll();

    const before = readAllFiles(t);
    expect(before.size).toBeGreaterThan(3);

    for (const file of t.entityStore.listAll()) {
      t.entityStore.persist(file.type, file.slug);
    }

    const after = readAllFiles(t);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [relPath, bytes] of before) {
      expect(after.get(relPath), `${relPath} changed on re-persist`).toBe(bytes);
    }
  });

  it('[ac:ac-rebuild-indeksu-ani-restore-nie-zmie] a second indexAll with no mutation leaves the files unchanged', async () => {
    await seed(t);
    const indexer = indexerFor(t);
    await indexer.indexAll();
    const before = readAllFiles(t);

    await indexer.indexAll();
    for (const file of t.entityStore.listAll()) {
      t.entityStore.persist(file.type, file.slug);
    }

    const after = readAllFiles(t);
    for (const [relPath, bytes] of before) {
      expect(after.get(relPath), `${relPath} drifted across rebuilds`).toBe(bytes);
    }
  });

  it('every entity file carries both timestamps, and createdAt never follows updatedAt', async () => {
    await seed(t);
    await indexerFor(t).indexAll();

    for (const file of t.entityStore.listAll()) {
      const stamp = readSystemFields(t.entityStore.readRel(file.relPath));
      expect(stamp, `${file.relPath} has no timestamp envelope`).not.toBeNull();
      expect(stamp!.createdAt <= stamp!.updatedAt).toBe(true);
    }
  });

  it('[ac:ac-rebuild-indeksu-ani-restore-nie-zmie] a rebuild does not move updatedAt — the value survives the index round trip', async () => {
    await seed(t);
    const indexer = indexerFor(t);
    await indexer.indexAll();

    const file = t.entityStore.listAll()[0]!;
    const before = readSystemFields(t.entityStore.readRel(file.relPath))!;

    // The pre-0.2.4 failure mode: `datetime('now')` fired on the restore and the
    // column — and therefore the next persisted file — moved even though nothing
    // about the entity had changed.
    await indexer.indexAll();
    const row = t.rawReader.getEntity(file.type, file.slug);
    expect(row?.system).toEqual(before);

    t.entityStore.persist(file.type, file.slug);
    expect(readSystemFields(t.entityStore.readRel(file.relPath))).toEqual(before);
  });

  it('a real content change moves updatedAt but never createdAt', async () => {
    await seed(t);
    await indexerFor(t).indexAll();

    const before = t.rawReader.getEntity('ui-view', 'users')!.system!;
    // Same millisecond would make the assertion vacuous, so compare on content
    // rather than on strict inequality of the clock.
    const res = await request(t.app).patch('/api/ui-views/users').send({ description: 'changed' });
    expect(res.status).toBe(200);

    const after = t.rawReader.getEntity('ui-view', 'users')!.system!;
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.updatedAt >= before.updatedAt).toBe(true);
  });

  /**
   * 0.2.7 — where a partial update takes `createdAt` FROM, when the two possible
   * sources disagree.
   *
   * Every test above keeps file and row in step, so both answers look right and
   * the question never gets asked. Force them apart and only one source is
   * admissible: the file is authoritative and the row is its projection, so
   * reading the row reverses the direction of flow — and since `persist`
   * regenerates the file from the row, the wrong answer does not stay in the
   * index, it is written back into the source.
   *
   * Unreachable through `snapshot → restore → snapshot`, which never assembles
   * an object from a delta — which is why this was invisible until 0.2.7.
   */
  it('[ac:ac-pola-systemowe-koperty-createdat-upda] a partial update takes createdAt from the FILE, not from the index row', async () => {
    await seed(t);
    await indexerFor(t).indexAll();

    const fileCreatedAt = readSystemFields(t.entityStore.read('ui-view', 'users'))!.createdAt;
    // Push the projection out of step with its source, behind the write path's
    // back — the state a stale or hand-edited index lands in.
    const rowCreatedAt = '2001-01-01T00:00:00.000Z';
    t.db.prepare(`UPDATE ui_view SET created_at = ? WHERE slug = 'users'`).run(rowCreatedAt);

    const res = await request(t.app).patch('/api/ui-views/users').send({ description: 'changed again' });
    expect(res.status).toBe(200);

    const after = t.rawReader.getEntity('ui-view', 'users')!.system!;
    expect(after.createdAt).toBe(fileCreatedAt);
    expect(after.createdAt).not.toBe(rowCreatedAt);
    // And the file the update just rewrote still says the same thing.
    expect(readSystemFields(t.entityStore.read('ui-view', 'users'))!.createdAt).toBe(fileCreatedAt);
    expect(after.updatedAt).not.toBe(fileCreatedAt);
  });
});

/**
 * The release path's own version of the fixpoint, and the one case Tier B had
 * to add a rule for.
 *
 * `diffEntity` now strips the timestamps, so "same content, different stamps"
 * short-circuits to `noop` — and a naive `noop` return would leave the entity
 * file at its CURRENT timestamps forever, never byte-equal to the release
 * snapshot it was just restored to. The rule: "no substantive change" governs
 * the diff report and the version log, never the projection.
 */
describe('release restore projects the stamp even when the diff is a noop', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  function releaseServiceFor(app: TestApp): ReleaseService {
    const service = new ReleaseService(
      app.db,
      app.host,
      app.versionService,
      { assignToRelease: () => {} } as unknown as FileVersionService,
      { version: 'v1' } as unknown as FileSerializer,
      app.rawReader,
      app.tagsService,
      {} as unknown as PagesService,
      null,
      app.cwd,
    );
    service.setEntityStore(app.entityStore);
    return service;
  }

  it('[ac:ac-round-trip-release-u-zachowuje-pola-syst] a stamp-only restore is reported noop, yet the file becomes identical', async () => {
    const created = await request(t.app).post('/api/acs').send({ title: 'the rule holds' });
    expect(created.status).toBe(201);
    const slug = created.body.data.slug as string;

    const releases = releaseServiceFor(t);
    const releaseId = Number(
      t.db
        .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?,?,?,?)`)
        .run('r1', 'r1', 'first', 'user').lastInsertRowid,
    );
    t.db.prepare(`UPDATE entity_version SET release_id = ? WHERE release_id IS NULL`).run(releaseId);

    const snapshot = t.entityStore.readRel(`ac/${slug}.json`);
    const releasedStamp = readSystemFields(snapshot)!;

    // Move ONLY the timestamps in the index, exactly as a pre-0.2.4 rebuild
    // would have. Content is untouched, so the diff must read `noop`.
    t.db.prepare(`UPDATE ac SET created_at = ?, updated_at = ? WHERE slug = ?`).run(
      '2030-01-01T00:00:00.000Z',
      '2030-01-01T00:00:00.000Z',
      slug,
    );
    t.entityStore.persist('ac', slug);
    expect(readSystemFields(t.entityStore.readRel(`ac/${slug}.json`))).not.toEqual(releasedStamp);

    const result = releases.restoreEntity({ type: 'ac', slug, releaseId });
    expect(result.op).toBe('noop');

    // The whole point: `noop` describes the REPORT, not the projection.
    expect(readSystemFields(t.entityStore.readRel(`ac/${slug}.json`))).toEqual(releasedStamp);
    expect(t.rawReader.getEntity('ac', slug)?.system).toEqual(releasedStamp);

    // And no version row was appended, because nothing substantive changed.
    const rows = t.db
      .prepare(`SELECT COUNT(*) AS n FROM entity_version WHERE release_id IS NULL`)
      .get() as { n: number };
    expect(rows.n).toBe(0);
  });

  /**
   * The counterpart, and the one place the verbatim rule is deliberately NOT
   * applied. `VersionService.restore` captures a fresh `update` version as part
   * of the restore — so it is a mutation, not a rewind, and its `updatedAt` has
   * to say so. `createdAt` is still immutable.
   */
  it('a version restore mints a new updatedAt rather than replaying the old one', async () => {
    const created = await request(t.app).post('/api/acs').send({ title: 'first text' });
    expect(created.status).toBe(201);
    const slug = created.body.data.slug as string;
    const originalStamp = t.rawReader.getEntity('ac', slug)!.system!;

    await new Promise((r) => setTimeout(r, 5));
    const patched = await request(t.app).patch(`/api/acs/${slug}`).send({ title: 'second text' });
    expect(patched.status).toBe(200);

    t.versionService.configureRestore(t.entityStore, t.tagsService);
    await new Promise((r) => setTimeout(r, 5));
    t.versionService.restore('ac', slug, 1, 'user');

    const after = t.rawReader.getEntity('ac', slug)!;
    expect((after.data as { title: string }).title).toBe('first text'); // content really rewound
    expect(after.system!.createdAt).toBe(originalStamp.createdAt); // never moves
    expect(after.system!.updatedAt > originalStamp.updatedAt).toBe(true); // the restore IS a change
  });
});
