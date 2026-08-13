/**
 * The payload upgrade chain, exercised end to end against real entity files.
 *
 * The unit tests in `serialization/payload-upgrade.test.ts` prove the chain
 * composes. They cannot prove the three properties that actually matter, because
 * every one of them is about what the SURROUNDING machinery does or does not do:
 *
 *   1. an upgrade must not stamp `updatedAt` or write an `entity_version` row —
 *      otherwise bumping a type's version rewrites the audit history of every
 *      entity of that type, and the next release diff reports thousands of edits
 *      nobody made;
 *   2. the file must be rewritten ONCE, not on every read;
 *   3. an entity the chain cannot honestly migrate must be skipped without
 *      taking its siblings' rebuild down with it.
 *
 * `endpoint` is the probe throughout because it is the type that actually moved
 * (payload v1 → v2), so its v1 files are the real legacy corpus rather than a
 * synthetic one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';
import { EntityIndexerService } from '../../../src/server/services/entity-indexer.js';
import { HostEntityWriter } from '../../../src/server/services/entity-writer.js';

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

const fileOf = (t: TestApp, type: string, slug: string) =>
  path.join(t.entityStore.root, type, `${slug}.json`);

const readFile = (t: TestApp, type: string, slug: string) =>
  JSON.parse(fs.readFileSync(fileOf(t, type, slug), 'utf-8')) as Record<string, unknown>;

const versionRows = (t: TestApp, type: string, slug: string) =>
  (
    t.db
      .prepare(`SELECT COUNT(*) AS c FROM entity_version WHERE entity_type = ? AND entity_slug = ?`)
      .get(type, slug) as { c: number }
  ).c;

/**
 * Write a v1-shaped endpoint file by hand — the shape 0.2.8 actually produced.
 *
 * `name` feeds both the path and the slug, because the slug a real file carries
 * is the one `{method}-{slugify(path)}` produced at create time. A fixture whose
 * slug disagrees with its path is not a legacy file, it is a corrupt one — and
 * it fails in a way that looks like an upgrade bug (the junction's FK rejects a
 * row pointing at an endpoint slug nothing wrote).
 */
function writeV1Endpoint(
  t: TestApp,
  name: string,
  extra: Record<string, unknown> = {},
): { slug: string; createdAt: string; updatedAt: string } {
  const slug = `get-legacy-${name}`;
  const createdAt = '2020-01-02T03:04:05.678Z';
  const updatedAt = '2021-06-07T08:09:10.111Z';
  const v1 = {
    slug,
    method: 'GET',
    path: `/legacy/${name}`,
    // v1 spelled an empty summary as null, against its own `default: ''`.
    summary: null,
    description: null,
    // v1 spelled the junction in COLUMN names.
    linked_dtos: [{ dto_slug: 'user-dto', relation: 'response', status_code: 200 }],
    tags: [],
    createdAt,
    updatedAt,
    ...extra,
  };
  fs.mkdirSync(path.dirname(fileOf(t, 'endpoint', slug)), { recursive: true });
  fs.writeFileSync(fileOf(t, 'endpoint', slug), JSON.stringify(v1, null, 2) + '\n');
  return { slug, createdAt, updatedAt };
}

describe('payload upgrades on the disk-load path', () => {
  let t: TestApp;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    t = await createTestApp();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The DTO the legacy junction points at. A dangling ref would be warned
    // through rather than written, which would hide the junction assertions.
    const dto = await request(t.app).post('/api/dtos').send({ name: 'UserDto', fields: [] });
    expect(dto.status).toBe(201);
  });
  afterEach(() => {
    warn.mockRestore();
    t.cleanup();
  });

  it('[ac:ac-kazdy-typ-deklaruje-payloadversion-pl] [ac:ac-upgrade-payloadu-nie-jest-mutacja-dom] [ac:ac-upgrade-payloadu-nie-zmienia-updatedat] rewrites a v1 file to v2 without stamping updatedAt or capturing a version', async () => {
    const stamp = writeV1Endpoint(t, 'one');
    await indexerFor(t).indexAll();

    const file = readFile(t, 'endpoint', 'get-legacy-one');
    expect(file.payloadVersion).toBe(2);
    expect(file.linkedDtos).toEqual([{ dto: 'user-dto', relation: 'response', statusCode: 200 }]);
    expect(file.linked_dtos).toBeUndefined();
    // The declaration's answer, applied to the value it was contradicted about.
    expect(file.summary).toBe('');

    /**
     * The two properties that make an upgrade not-a-mutation. Both would pass
     * accidentally if the assertion were merely "the file changed": the file
     * DOES change, and the question is only what else changed with it.
     */
    expect(file.updatedAt).toBe(stamp.updatedAt);
    expect(file.createdAt).toBe(stamp.createdAt);
    expect(versionRows(t, 'endpoint', 'get-legacy-one')).toBe(0);
  });

  it('[ac:ac-upgrade-payloadu-nie-jest-mutacja-dom] rewrites the file exactly once — a second rebuild leaves it byte-identical', async () => {
    writeV1Endpoint(t, 'two');
    await indexerFor(t).indexAll();

    const afterFirst = fs.readFileSync(fileOf(t, 'endpoint', 'get-legacy-two'), 'utf-8');
    const mtimeFirst = fs.statSync(fileOf(t, 'endpoint', 'get-legacy-two')).mtimeMs;

    await indexerFor(t).indexAll();

    // Idempotence with no bookkeeping: the marker itself short-circuits the
    // chain, so the rewrite branch is never reached a second time.
    expect(fs.readFileSync(fileOf(t, 'endpoint', 'get-legacy-two'), 'utf-8')).toBe(afterFirst);
    expect(fs.statSync(fileOf(t, 'endpoint', 'get-legacy-two')).mtimeMs).toBe(mtimeFirst);
    expect(versionRows(t, 'endpoint', 'get-legacy-two')).toBe(0);
  });

  it('carries the legacy junction all the way into the projection', async () => {
    writeV1Endpoint(t, 'three');
    await indexerFor(t).indexAll();

    // The end the upgrade exists to reach: the rows, not just the file. A chain
    // that renamed the key but never got it past the writer would still pass
    // every file-level assertion above.
    const links = t.db
      .prepare(`SELECT dto_slug, relation, status_code FROM endpoint_dto WHERE endpoint_slug = ?`)
      .all('get-legacy-three');
    expect(links).toEqual([{ dto_slug: 'user-dto', relation: 'response', status_code: 200 }]);
  });

  it('skips an entity the chain cannot honestly migrate, without failing its siblings', async () => {
    // `method` is declared `required` with no default, so dropping it leaves a
    // gap nothing can derive — a CONTRADICTORY gap, which must refuse rather
    // than invent a verb for someone's API.
    const slug = writeV1Endpoint(t, 'broken').slug;
    const good = writeV1Endpoint(t, 'good');
    const broken = readFile(t, 'endpoint', slug);
    delete broken.method;
    fs.writeFileSync(fileOf(t, 'endpoint', slug), JSON.stringify(broken, null, 2) + '\n');

    await indexerFor(t).indexAll();

    expect(t.rawReader.getEntity('endpoint', slug)).toBeNull();
    // The sibling indexed anyway — one unmigratable entity is not a broken boot.
    expect(t.rawReader.getEntity('endpoint', 'get-legacy-good')).not.toBeNull();
    expect(readFile(t, 'endpoint', 'get-legacy-good').updatedAt).toBe(good.updatedAt);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/get-legacy-broken/);
  });

  it('leaves a file the host wrote itself untouched by the chain', async () => {
    // The corpus this release CREATES: written at the current version, so it
    // must short-circuit. If it did not, every entity would be rewritten on
    // every boot forever.
    const created = await request(t.app)
      .post('/api/endpoints')
      .send({ method: 'POST', path: '/api/fresh', summary: 'fresh' });
    expect(created.status).toBe(201);
    const slug = created.body.data.slug as string;

    expect(readFile(t, 'endpoint', slug).payloadVersion).toBe(2);
    const before = fs.readFileSync(fileOf(t, 'endpoint', slug), 'utf-8');
    const versionsBefore = versionRows(t, 'endpoint', slug);

    await indexerFor(t).indexAll();

    expect(fs.readFileSync(fileOf(t, 'endpoint', slug), 'utf-8')).toBe(before);
    expect(versionRows(t, 'endpoint', slug)).toBe(versionsBefore);
  });
});

/**
 * The junction gap — the highest-severity thing this tier could have broken.
 *
 * `EndpointService.upsert` writes the `endpoint` row and nothing else. Until
 * 0.2.9 the per-type `restore` slot called `syncEndpointDtos` immediately after,
 * and that slot is what this tier deletes. If nothing takes over, a boot rebuild
 * writes the row, leaves `endpoint_dto` empty, and the following `persist`
 * writes the emptied `linkedDtos` back into the file — the links are gone from
 * the source of truth, and the rebuild that did it reported success.
 *
 * This has to be an integration test. A unit test with a stub writer cannot see
 * it: the stub is exactly the thing that would have to be wrong.
 */
describe('a projected collection survives the rebuild that reads it', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('keeps every endpoint_dto link across two full rebuilds, and in the file', async () => {
    const post = async (url: string, body: unknown) => {
      const res = await request(t.app).post(url).send(body);
      expect(res.status, `${url}: ${JSON.stringify(res.body)}`).toBeLessThan(400);
      return (res.body as { data: { slug: string } }).data;
    };
    const dtos = [
      (await post('/api/dtos', { name: 'AlphaDto', fields: [] })).slug,
      (await post('/api/dtos', { name: 'BetaDto', fields: [] })).slug,
      (await post('/api/dtos', { name: 'GammaDto', fields: [] })).slug,
    ];
    const endpoint = (await post('/api/endpoints', { method: 'GET', path: '/api/things', summary: 's' })).slug;

    await post(`/api/endpoints/${endpoint}/dtos`, { dtoSlug: dtos[0], relation: 'response', statusCode: 200 });
    await post(`/api/endpoints/${endpoint}/dtos`, { dtoSlug: dtos[1], relation: 'error', statusCode: 404 });
    // A NULL status_code, because it is part of the junction's UNIQUE key and a
    // coercion to 0 would collide with a real one.
    await post(`/api/endpoints/${endpoint}/dtos`, { dtoSlug: dtos[2], relation: 'request', statusCode: null });

    const links = () =>
      (
        t.db
          .prepare(`SELECT COUNT(*) AS c FROM endpoint_dto WHERE endpoint_slug = ?`)
          .get(endpoint) as { c: number }
      ).c;
    expect(links()).toBe(3);

    // Twice: the first rebuild would empty the junction, and the second would
    // then read an already-emptied FILE, so one pass could still look fine.
    await indexerFor(t).indexAll();
    expect(links()).toBe(3);
    await indexerFor(t).indexAll();
    expect(links()).toBe(3);

    const file = readFile(t, 'endpoint', endpoint);
    expect(file.linkedDtos).toHaveLength(3);
    expect((file.linkedDtos as Array<{ dto: string }>).map((l) => l.dto).sort()).toEqual([...dtos].sort());
  });
});

/**
 * What the deleted per-type `restore` hooks were doing BESIDES writing rows.
 *
 * The parity gate compares snapshots, so it could only ever see the payload. It
 * is blind to validation, to warnings, and to error handling — and a review found
 * all three had been dropped along with the hooks they lived in. Each of these
 * exercises the real type through the real write path, because the whole failure
 * mode is "the generic door does not do what the specific one did".
 */
describe('behaviour the per-type restore hooks used to provide', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('warns about a dangling scalar ref, which uiViewRestore used to report by hand', async () => {
    // `designSystemSlug` declares `ref: 'design-system', onMissing: 'warn'`, and
    // there is deliberately no FK — the value is meant to survive its target.
    // `syncProjectionTable` honours `onMissing` for COLLECTION ITEMS only, so
    // removing `uiViewRestore` made a dangling design system completely silent:
    // a rebuild reported clean success and the user found out by opening the view.
    const created = await request(t.app)
      .post('/api/ui-views')
      .send({ name: 'Profile', designSystemSlug: 'never-existed' });
    expect(created.status).toBeLessThan(400);

    const writer = new HostEntityWriter(t.host, t.tagsService, { capture: false }, {
      db: t.db,
      store: t.entityStore,
      versions: null,
    });
    const result = writer.upsert('ui-view', created.body.data.slug, {
      name: 'Profile',
      designSystemSlug: 'never-existed',
    }, 'user');

    expect(result).not.toBeNull();
    expect(result!.warnings?.join() ?? '').toMatch(/never-existed.*does not exist \(dangling\)/);
  });

  it('does not store an endpoint link whose relation is misspelled', async () => {
    // `EndpointService.linkDto` rejected an unknown relation; the generic junction
    // door inserted it verbatim, so it rendered on the detail page and was written
    // back into the entity file as if it were real.
    const dto = await request(t.app).post('/api/dtos').send({ name: 'UserDto', fields: [] });
    const ep = await request(t.app)
      .post('/api/endpoints')
      .send({ method: 'GET', path: '/api/things', summary: 's' });

    const writer = new HostEntityWriter(t.host, t.tagsService, { capture: false }, {
      db: t.db,
      store: t.entityStore,
      versions: null,
    });
    const result = writer.upsert('endpoint', ep.body.data.slug, {
      method: 'GET',
      path: '/api/things',
      summary: 's',
      linkedDtos: [
        { dto: dto.body.data.slug, relation: 'resposne', statusCode: 200 },
        { dto: dto.body.data.slug, relation: 'response', statusCode: 200 },
      ],
    }, 'user');

    expect(result!.warnings?.join() ?? '').toMatch(/expected one of request, response, error/);
    const links = t.db
      .prepare(`SELECT relation FROM endpoint_dto WHERE endpoint_slug = ?`)
      .all(ep.body.data.slug) as Array<{ relation: string }>;
    // Only the well-formed link survives; the misspelling is not in the table.
    expect(links.map((l) => l.relation)).toEqual(['response']);
  });
});

/**
 * A release restore that cannot upgrade its capture must NOT report success.
 *
 * `upgradeCapture` degraded to the un-upgraded payload, which looked harmless and
 * was the worst option available: `restoreFromSchema` copies only keys matching
 * DECLARED fields, so a v1 capture's `linked_dtos` never reaches the writer,
 * `syncProjectionTables` skips the collection, and the junction keeps TODAY's
 * links — which `persist` then writes into the file as the restored state. The
 * API answered `op: 'updated'` while restoring nothing.
 */
describe('a release restore whose capture cannot be upgraded', () => {
  let t: TestApp;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    t = await createTestApp();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    t.cleanup();
  });

  it('reports a noop with the reason instead of a false success', async () => {
    const { ReleaseService } = await import('../../../src/server/services/release.js');
    const ep = await request(t.app)
      .post('/api/endpoints')
      .send({ method: 'GET', path: '/api/kept', summary: 'kept' });
    expect(ep.status).toBe(201);

    /**
     * Rewrite the real capture into a v1 payload the chain cannot honestly
     * migrate: `method` is `required` with no derivable default, so `classifyGap`
     * refuses rather than inventing an HTTP verb for someone's API.
     *
     * Going through the real capture first, then editing it, keeps the fixture
     * honest about the table's actual shape instead of hand-writing an INSERT
     * against columns this test would have to guess at.
     */
    t.db
      .prepare(
        `UPDATE entity_version SET data = ?, serializer_version = '1'
          WHERE entity_type = 'endpoint' AND entity_slug = ?`,
      )
      .run(JSON.stringify({ slug: ep.body.data.slug, path: '/api/kept' }), ep.body.data.slug);
    t.db
      .prepare(
        `INSERT INTO spec_release (id, name, description, created_by, created_at)
         VALUES (7, 'r7', 'legacy release', 'user', datetime('now'))`,
      )
      .run();
    t.db
      .prepare(`UPDATE entity_version SET release_id = 7 WHERE entity_slug = ?`)
      .run(ep.body.data.slug);

    const releases = new ReleaseService(
      t.db, t.host, t.rawReader, t.versionService, t.tagsService, process.cwd(), t.entityStore,
    ) as unknown as {
      restoreEntity(i: { releaseId: number; type: string; slug: string }): {
        op: string; warnings?: string[];
      };
    };

    const result = releases.restoreEntity({ releaseId: 7, type: 'endpoint', slug: ep.body.data.slug });
    expect(result.op).toBe('noop');
    expect(result.warnings?.join() ?? '').toMatch(/not restored/);
    // And the live entity is untouched, rather than half-written.
    expect(t.rawReader.getEntity('endpoint', ep.body.data.slug)?.data.summary).toBe('kept');
  });
});
