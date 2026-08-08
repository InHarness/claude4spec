import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';

/**
 * 0.2.13 — the `rest` renderings the release adds, exercised over the real
 * router stack.
 *
 * The point of most of these is PARITY: the same operation, reached over HTTP,
 * has to answer with the core's shape and the core's error codes rather than a
 * transport-local approximation of them.
 */
describe('GET /api/_meta/* — the four M39 renderings', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('[ac:ac-operacje-overview-describe-types-reso] overview answers with roots, active types and the tag count', async () => {
    const res = await request(t.app).get('/api/_meta/overview').expect(200);
    expect(res.body).toHaveProperty('roots');
    expect(res.body).toHaveProperty('types');
    expect(res.body).toHaveProperty('tagCount');
    expect(res.body).toHaveProperty('claude4spec');
    // `types` is keyed BY TYPE (not a list) — one entry per active type, each
    // carrying its count and payload version.
    expect(Array.isArray(res.body.roots)).toBe(true);
    expect(Object.keys(res.body.types).length).toBeGreaterThan(0);
  });

  it('types describes every active type, and one when asked for one', async () => {
    const all = await request(t.app).get('/api/_meta/types').expect(200);
    expect(all.body.types.length).toBeGreaterThan(1);

    const one = await request(t.app).get('/api/_meta/types?type=ac').expect(200);
    expect(one.body.types).toHaveLength(1);
    expect(one.body.types[0].type).toBe('ac');
    expect(one.body.types[0]).toHaveProperty('schemas');
    // The answer to "what will search cover for this type" ships with the shape.
    expect(one.body.types[0]).toHaveProperty('searchableFields');
  });

  it('a type outside the activation set is INVALID_TYPE with the active list — not a generic fallback', async () => {
    const res = await request(t.app).get('/api/_meta/types?type=no-such-type').expect(404);
    expect(res.body.error.code).toBe('INVALID_TYPE');
    // The hint is FORWARDED from the core, not re-phrased at the transport.
    expect(res.body.error.hint).toMatch(/active types:/);
  });

  it('identities searches across every active type without being told a type', async () => {
    const res = await request(t.app).get('/api/_meta/identities?q=a&limit=5').expect(200);
    expect(Array.isArray(res.body.candidates)).toBe(true);
    for (const c of res.body.candidates) {
      expect(c).toHaveProperty('type');
      expect(c).toHaveProperty('slug');
    }
  });

  it('consistency keeps FULL counts in summary even when the findings list is cut', async () => {
    const full = await request(t.app).get('/api/_meta/consistency').expect(200);
    const cut = await request(t.app).get('/api/_meta/consistency?limit=1').expect(200);
    // A report that contradicts its own summary is worse than no filter at all.
    expect(cut.body.summary).toEqual(full.body.summary);
  });
});

describe('GET /api/entities/:type/search', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('[ac:ac-odpowiedz-search-entities-zawsze-niesi] answers with searchedFields, so an empty result is not confusable with an unsearched field', async () => {
    const res = await request(t.app).get('/api/entities/ac/search?q=nothing-matches-this').expect(200);
    expect(res.body).toHaveProperty('searchedFields');
    expect(Array.isArray(res.body.searchedFields)).toBe(true);
  });

  it('refuses an inactive type with INVALID_TYPE', async () => {
    const res = await request(t.app).get('/api/entities/no-such-type/search?q=x').expect(404);
    expect(res.body.error.code).toBe('INVALID_TYPE');
  });

  it('does not shadow the entity LIST route — `?search=` there is a different thing', async () => {
    // Both must answer; the list keeps its UI projection `{ data, total }`.
    const list = await request(t.app).get('/api/acs?search=x').expect(200);
    expect(list.body).toHaveProperty('data');
    await request(t.app).get('/api/entities/ac/search?q=x').expect(200);
  });
});

/**
 * 0.2.13 (tier C) — the renderings the CLI migration needed and the release did
 * not have. Every one of these is the CATALOG operation, not the UI's route for
 * the same noun; the pairs that coexist are asserted to coexist.
 */
describe('GET /api/entities/:type/list and /:type/get', () => {
  let t: TestApp;
  let alpha: string;
  let beta: string;
  beforeEach(async () => {
    t = await createTestApp();
    alpha = (await request(t.app).post('/api/acs').send({ text: 'alpha' }).expect(201)).body.data.slug;
    beta = (await request(t.app).post('/api/acs').send({ text: 'beta' }).expect(201)).body.data.slug;
  });
  afterEach(() => t.cleanup());

  it('list answers with the core envelope, not the UI list projection', async () => {
    const res = await request(t.app).get('/api/entities/ac/list').expect(200);
    // `{ items, total, hasMore }` — the core's page. The UI route answers
    // `{ data, total }` and is asserted below to keep doing so.
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('hasMore');
    expect(res.body.total).toBe(2);
  });

  it('list carries the tag filter and the window through to the core', async () => {
    // The filter is asserted by its EFFECT rather than by a fixture: an
    // unfiltered list answers 2, and one filtered by a tag nothing carries
    // answers 0. A parameter parsed and then dropped would answer 2 twice.
    const tagged = await request(t.app).get('/api/entities/ac/list?tags=no-such-tag').expect(200);
    expect(tagged.body.total).toBe(0);

    const paged = await request(t.app).get('/api/entities/ac/list?limit=1&offset=0').expect(200);
    expect(paged.body.items).toHaveLength(1);
    // `total` counts the query, not the window — otherwise `hasMore` is
    // unreadable and a caller cannot tell a short page from a last page.
    expect(paged.body.total).toBe(2);
    expect(paged.body.hasMore).toBe(true);
  });

  it('`?mode=count` answers a count, and `?offset=0` is honoured as zero rather than dropped', async () => {
    const counted = await request(t.app).get('/api/entities/ac/list?mode=count').expect(200);
    expect(counted.body.total).toBe(2);

    // The regression this guards: reading an offset with the LIMIT parser turns
    // `?offset=0` into undefined. Harmless only while the core's default offset
    // happens to be 0 — so it is asserted, not assumed.
    const zero = await request(t.app).get('/api/entities/ac/list?limit=1&offset=0').expect(200);
    const one = await request(t.app).get('/api/entities/ac/list?limit=1&offset=1').expect(200);
    expect(zero.body.items[0].slug).not.toBe(one.body.items[0].slug);
  });

  it('get fetches several slugs by key, and reports an unknown one as a null row rather than an error', async () => {
    const res = await request(t.app)
      .get(`/api/entities/ac/get?slugs=${alpha},no-such-ac,${beta}`)
      .expect(200);
    expect(res.body.results).toHaveLength(3);
    expect(res.body.results[1].entity).toBeNull();
    // The real slugs in the same call are still answers.
    expect(res.body.results[0].entity).not.toBeNull();
    expect(res.body.results[2].entity).not.toBeNull();
  });

  it('get without slugs is VALIDATION — it is fetch-by-key, so an absent key is not "everything"', async () => {
    const res = await request(t.app).get('/api/entities/ac/get').expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('both refuse an inactive type with INVALID_TYPE, like every other catalog route', async () => {
    const list = await request(t.app).get('/api/entities/no-such-type/list').expect(404);
    expect(list.body.error.code).toBe('INVALID_TYPE');
    const get = await request(t.app).get('/api/entities/no-such-type/get?slugs=x').expect(404);
    expect(get.body.error.code).toBe('INVALID_TYPE');
  });

  it('neither shadows the entity LIST route the UI calls, nor is shadowed by `/:type/:slug/...`', async () => {
    const ui = await request(t.app).get('/api/acs').expect(200);
    expect(ui.body).toHaveProperty('data');
    // `/ac/list` must not be captured as `:type/:slug`; the two-segment
    // `/ac/<slug>/tags` must still reach its own handler. Registration order is
    // what makes both true. The second is asserted by the CODE its handler
    // produced — the point is that the route matched, not what it found there.
    const listed = await request(t.app).get('/api/entities/ac/list').expect(200);
    expect(listed.body).toHaveProperty('items');
    const perSlug = await request(t.app).get(`/api/entities/ac/${alpha}/tags`);
    expect(perSlug.body.error?.code ?? 'matched').not.toBe('INVALID_TYPE');
  });
});

describe('GET /api/tags/list', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('answers the CORE projection, leaving the UI DTO on `GET /api/tags` untouched', async () => {
    await request(t.app).post('/api/tags').send({ slug: 'red', name: 'Red' }).expect(201);

    const ui = await request(t.app).get('/api/tags').expect(200);
    // The published DTO: `counts` REQUIRED, ordered by name — `TagsList.tsx`
    // reads `tag.counts[type]` unguarded.
    expect(ui.body.tags[0]).toHaveProperty('counts');
    expect(ui.body.tags[0]).toHaveProperty('createdAt');

    const core = await request(t.app).get('/api/tags/list').expect(200);
    expect(core.body).toHaveProperty('items');
    expect(core.body).toHaveProperty('total');
    // Counts are OPT-IN here: a caller listing names does not pay for a product
    // over tags × types.
    expect(core.body.items[0].counts).toBeUndefined();

    const withCounts = await request(t.app).get('/api/tags/list?withCounts=true').expect(200);
    expect(withCounts.body.items[0]).toHaveProperty('counts');
  });

  /**
   * Registration order decides who WINS this collision; it does not stop the
   * collision from being created, and the original version of this test asserted
   * only the first half.
   *
   * A tag named "List" slugs to `list` and used to be accepted. Its detail read
   * then answered the LIST envelope with a 200 — and `createTagIdempotent` treats
   * a 409 by falling through to `getBySlug`, so the client took `{ items, total,
   * hasMore }` as a `Tag` with no error anywhere, attached a tag whose `slug` and
   * `name` were `undefined`, and threw on the first `tag.counts[type]`. The tag
   * was also unreadable from its own detail view, permanently.
   *
   * So the slug is reserved on the write path, the same way `RESERVED_ROOT_IDS`
   * guards `/api/pages/search` — and the route still answers the operation.
   */
  it('reserves the `list` slug rather than letting a tag shadow the route', async () => {
    const refused = await request(t.app).post('/api/tags').send({ slug: 'list', name: 'List' }).expect(400);
    expect(refused.body.error.code).toBe('VALIDATION');
    expect(refused.body.error.message).toContain('reserved');

    const res = await request(t.app).get('/api/tags/list').expect(200);
    // The operation's envelope, not the single-tag DTO.
    expect(res.body).toHaveProperty('items');
    expect(res.body).not.toHaveProperty('slug');
  });

  /**
   * The other half of the reservation rule: it is a WRITE-path check.
   *
   * `ensure()` materializes the tags an entity file already declares, during
   * indexing. If it refused, an entity written under 0.2.12 carrying a tag named
   * "List" would fail to index on a rebuild — a validation added in release N
   * condemning data written under N-1, which is the exact failure this release
   * fixed for a root id named `search`.
   */
  it('still indexes an entity whose file already carries a `list` tag', async () => {
    const created = await request(t.app)
      .post('/api/acs')
      .send({ text: 'tagged with a reserved slug', tags: ['List'] })
      .expect(201);
    expect(created.body.data.tags).toContain('list');
  });
});

describe('POST /api/_meta/resolve-page', () => {
  let t: TestApp;
  let alphaSlug: string;
  beforeEach(async () => {
    t = await createTestApp();
    alphaSlug = (await request(t.app).post('/api/acs').send({ text: 'alpha' }).expect(201)).body.data.slug;
  });
  afterEach(() => t.cleanup());

  it('resolves the tags in a markdown body the caller sent, and hands back the sidecar', async () => {
    const content = `Intro\n\n<inline_mention type="ac" slug="${alphaSlug}"/>\n`;
    const res = await request(t.app)
      .post('/api/_meta/resolve-page')
      .send({ content })
      .expect(200);
    expect(res.body.content).toBe(content);
    expect(Array.isArray(res.body.resolved)).toBe(true);
    expect(res.body.resolved[0].tag).toBe('inline_mention');
    // The inline rendering is what `c4s resolve` prints in its default format.
    expect(typeof res.body.inlineContent).toBe('string');
    expect(res.body.inlineContent).not.toContain('<inline_mention');
  });

  it('refuses a body with no content — the markdown is the whole input', async () => {
    const res = await request(t.app).post('/api/_meta/resolve-page').send({}).expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});

describe('the plugin-tool proxy', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('lists a type\'s declared operations from the same registry the host mounts MCP from', async () => {
    const res = await request(t.app).get('/api/entities/diagram/tools').expect(200);
    const names = res.body.tools.map((x: { name: string }) => x.name);
    expect(names).toContain('validate_diagram');
    const tool = res.body.tools.find((x: { name: string }) => x.name === 'validate_diagram');
    expect(tool.description.length).toBeGreaterThan(0);
    // The zod raw shape is projected to JSON Schema, not leaked as zod internals.
    expect(tool.inputSchema).toHaveProperty('type', 'object');
  });

  it('answers a type with no custom operations with an empty list, not an error', async () => {
    const res = await request(t.app).get('/api/entities/dto/tools').expect(200);
    expect(res.body.tools).toEqual([]);
  });

  it('executes an operation through the very handler the tool channel calls', async () => {
    const res = await request(t.app)
      .post('/api/entities/diagram/tools/validate_diagram')
      .send({ source: 'graph TD;\n  A-->B;' })
      .expect(200);
    // The response is the tool result VERBATIM — a packing layer, not a second shape.
    expect(res.body).toHaveProperty('content');
    expect(Array.isArray(res.body.content)).toBe(true);
  });

  it('refuses an unknown operation with NOT_FOUND naming the ones that exist', async () => {
    const res = await request(t.app)
      .post('/api/entities/diagram/tools/no_such_tool')
      .send({})
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toMatch(/validate_diagram/);
  });

  it('validates the body with the SAME schema the tool channel validates against', async () => {
    const res = await request(t.app)
      .post('/api/entities/diagram/tools/validate_diagram')
      .send({ source: 12345 })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('does not shadow POST /:type/:slug/tags for an entity slugged `tools`', async () => {
    // Both patterns are three segments, so Express decides by registration order.
    // Declared first, the proxy swallowed this request and answered "type
    // 'ui-view' declares no operation 'tags'".
    const res = await request(t.app)
      .post('/api/entities/ui-view/tools/tags')
      .send({ tagSlugs: [] });
    // Whatever the tag route decides (404 for a missing entity is fine), it must
    // NOT be the proxy's "no operation named tags".
    expect(res.body?.error?.message ?? '').not.toMatch(/declares no operation/);
  });

  it('maps a FAILED plugin operation onto a status instead of answering 200', async () => {
    // An MCP handler reports failure in-band (`isError: true`), so forwarding the
    // envelope verbatim made every refusal a 200 and a client branching on
    // `response.ok` recorded a failed operation as a success.
    const res = await request(t.app)
      .post('/api/entities/diagram/tools/validate_diagram')
      .send({ source: 'graph TD;\n  A-->B;', format: 'not-a-real-format' });
    if (res.status === 200) {
      // The tool accepted it — then it must not be flagged as an error.
      expect(res.body.isError).not.toBe(true);
    } else {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.error?.code).toBeTruthy();
    }
  });

  it('refuses an inactive type with INVALID_TYPE on both halves of the proxy', async () => {
    const listed = await request(t.app).get('/api/entities/no-such-type/tools').expect(404);
    expect(listed.body.error.code).toBe('INVALID_TYPE');
    const called = await request(t.app)
      .post('/api/entities/no-such-type/tools/whatever')
      .send({})
      .expect(404);
    expect(called.body.error.code).toBe('INVALID_TYPE');
  });
});

describe('POST /api/patches', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
    fs.mkdirSync(path.join(t.cwd, 'briefs'), { recursive: true });
    fs.writeFileSync(path.join(t.cwd, 'briefs', 'b1.md'), '---\ntype: brief\n---\nbody\n', 'utf8');
  });
  afterEach(() => t.cleanup());

  it('[ac:ac-post-api-patches-tworzy-plik-patcha-z] writes the file and answers 201 with the path relative to patchesDir', async () => {
    const res = await request(t.app)
      .post('/api/patches')
      .send({ brief: 'b1.md', desc: 'route drifted', body: '## What I found\nx' })
      .expect(201);

    expect(res.body.data.path).toBe('b1-route-drifted.md');
    const written = fs.readFileSync(path.join(t.cwd, 'patches', res.body.data.path), 'utf8');
    expect(written).toMatch(/type: patch/);
    expect(written).toMatch(/brief: b1\.md/);
    expect(written).toMatch(/patch_kind: drift/);
    expect(written).toMatch(/status: awaiting/);
    expect(written).toMatch(/# Patch — route drifted/);
  });

  it('is NOT idempotent — two filings of the same drift are two SEPARATE files', async () => {
    const a = await request(t.app)
      .post('/api/patches')
      .send({ brief: 'b1.md', desc: 'same drift', body: 'first report' })
      .expect(201);
    const b = await request(t.app)
      .post('/api/patches')
      .send({ brief: 'b1.md', desc: 'same drift', body: 'second report' })
      .expect(201);

    // Distinct paths: `desc` drives the slug, so the naive filename collides —
    // and writing through it destroyed the first report while answering 201 as
    // though nothing had happened. A second report of the same drift is a real
    // event the spec author has to see.
    expect(a.body.data.path).toBe('b1-same-drift.md');
    expect(b.body.data.path).toBe('b1-same-drift-2.md');
    expect(fs.readFileSync(path.join(t.cwd, 'patches', a.body.data.path), 'utf8')).toMatch(/first report/);
    expect(fs.readFileSync(path.join(t.cwd, 'patches', b.body.data.path), 'utf8')).toMatch(/second report/);
  });

  it('400s VALIDATION on a non-string createdBy rather than 500ing on it', async () => {
    const res = await request(t.app)
      .post('/api/patches')
      .send({ brief: 'b1.md', desc: 'x', body: 'y', createdBy: 42 })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('404s BRIEF_NOT_FOUND when the brief does not exist — the N:1 guard', async () => {
    const res = await request(t.app)
      .post('/api/patches')
      .send({ brief: 'nope.md', desc: 'x', body: 'y' })
      .expect(404);
    expect(res.body.error.code).toBe('BRIEF_NOT_FOUND');
  });

  it('400s VALIDATION on an empty desc', async () => {
    const res = await request(t.app)
      .post('/api/patches')
      .send({ brief: 'b1.md', desc: '   ', body: 'y' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('400s VALIDATION on a patchKind outside the dictionary', async () => {
    const res = await request(t.app)
      .post('/api/patches')
      .send({ brief: 'b1.md', desc: 'x', body: 'y', patchKind: 'invented' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toMatch(/drift/);
  });

  it('defaults patchKind to drift and createdBy to the calling channel', async () => {
    const res = await request(t.app)
      .post('/api/patches')
      .send({ brief: 'b1.md', desc: 'defaults', body: 'y' })
      .expect(201);
    const written = fs.readFileSync(path.join(t.cwd, 'patches', res.body.data.path), 'utf8');
    expect(written).toMatch(/patch_kind: drift/);
    expect(written).toMatch(/created_by: rest/);
  });
});

describe('GET /api/references — paging that does not change the answer', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('keeps the same hit shape with and without a window', async () => {
    // The trap: routing the windowed request at `discovery.findReferences` runs
    // it through a projection that DROPS `raw` — the original tag text the
    // published ReferenceHit declares as required and the chips render. Adding
    // `&limit=` then returned empty chips with no error to explain them.
    const plain = await request(t.app).get('/api/references?type=ac&slug=whatever').expect(200);
    const windowed = await request(t.app).get('/api/references?type=ac&slug=whatever&limit=10').expect(200);
    expect(Array.isArray(plain.body.references)).toBe(true);
    expect(Array.isArray(windowed.body.references)).toBe(true);
    expect(windowed.body.references).toEqual(plain.body.references.slice(0, 10));
    expect(windowed.body.total).toBe(plain.body.references.length);
  });

  it('keeps accepting ?type=section once a window is added', async () => {
    // `assertType` has admitted the non-entity pseudo-type `section` since long
    // before the core existed, but `entityReferences` refuses anything
    // `host.getEntity()` does not know — so the same request answered 200 plain
    // and 404 INVALID_TYPE with `&limit=`.
    await request(t.app).get('/api/references?type=section&slug=some-anchor').expect(200);
    await request(t.app).get('/api/references?type=section&slug=some-anchor&limit=5').expect(200);
  });

  it('does not truncate at the core default when includeTagMatches is asked for', async () => {
    // The caller asking the BIGGER question ("what breaks if I rename this")
    // must not get the SMALLER answer. Without an explicit window this path uses
    // the exhaustive helper rather than one 100-row page.
    const res = await request(t.app)
      .get('/api/references?type=ac&slug=whatever&includeTagMatches=true')
      .expect(200);
    expect(Array.isArray(res.body.references)).toBe(true);
    expect(res.body.hasMore).toBe(false);
  });
});

describe('GET /api/tags — paging, added without moving the UI\'s cheese', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
    for (const slug of ['t-a', 't-b', 't-c']) t.tagsService.create({ slug, name: slug });
  });
  afterEach(() => t.cleanup());

  it('still returns every tag when no window is asked for', async () => {
    const res = await request(t.app).get('/api/tags').expect(200);
    expect(res.body.tags).toHaveLength(3);
    expect(res.body.total).toBe(3);
  });

  it('pages without changing the item shape or the ordering', async () => {
    const all = await request(t.app).get('/api/tags').expect(200);
    const paged = await request(t.app).get('/api/tags?limit=2').expect(200);
    expect(paged.body.tags).toHaveLength(2);
    expect(paged.body.total).toBe(3);
    /**
     * The trap this guards: handing `limit` to `discovery.listTags` returns the
     * core's NARROWER `TagListItem` (no `counts`, no `createdAt`/`updatedAt`) and
     * orders by slug instead of name. `counts` is required in the published DTO,
     * so `TagsList.tsx` (`tag.counts[m.type] ?? 0`) throws the moment anything
     * starts paging. Same shape, same order, sliced.
     */
    expect(paged.body.tags).toEqual(all.body.tags.slice(0, 2));
    for (const tag of paged.body.tags) {
      expect(tag).toHaveProperty('counts');
      expect(tag).toHaveProperty('createdAt');
    }
  });

  it('honours offset', async () => {
    const all = await request(t.app).get('/api/tags').expect(200);
    const res = await request(t.app).get('/api/tags?limit=1&offset=1').expect(200);
    expect(res.body.tags).toEqual(all.body.tags.slice(1, 2));
    expect(res.body.total).toBe(3);
  });
});

/**
 * 0.2.13 §7 — `/api/references` and the release's own error contract.
 *
 * A caller who mistypes a type name is the most ordinary failure this route has,
 * and it used to answer `500 INTERNAL` with no list of what would have worked.
 * "REST is a full channel" is a claim about the error taxonomy as much as about
 * the paths.
 */
describe('GET /api/references — a wrong type is a repairable error, not a 500', () => {
  it('answers INVALID_TYPE and names the active types', async () => {
    const app = await createTestApp();
    try {
      const res = await request(app.app).get('/api/references').query({ type: 'no-such-type', slug: 'x' });
      expect(res.status).not.toBe(500);
      expect(res.body.error.code).toBe('INVALID_TYPE');
      // The repair path: what the caller could have said instead.
      expect(res.body.error.hint ?? res.body.error.message).toMatch(/ac|endpoint|dto/);
    } finally {
      app.cleanup();
    }
  });

  it('still accepts the non-entity pseudo-type `section`', async () => {
    // Accepted here since long before the core existed; the stricter error must
    // not quietly narrow the vocabulary this route has always had.
    const app = await createTestApp();
    try {
      const res = await request(app.app).get('/api/references').query({ type: 'section', slug: 'x' });
      expect(res.status).toBe(200);
    } finally {
      app.cleanup();
    }
  });
});

/**
 * 0.2.13 §7 — `section` is a pseudo-type on this route, on BOTH branches.
 *
 * `assertType` admits it and always has, but the `includeTagMatches` branch went
 * to the discovery core, which refuses anything `host.getEntity()` does not
 * know. So the same target answered 200 plain and 404 INVALID_TYPE the moment a
 * caller turned tag matching on — told the type does not exist, with a hint
 * listing entity types that will never contain a section.
 */
describe('GET /api/references — type=section survives includeTagMatches', () => {
  it('answers the same way with the flag as without it', async () => {
    const app = await createTestApp();
    try {
      const plain = await request(app.app).get('/api/references').query({ type: 'section', slug: 'intro' });
      const tagged = await request(app.app)
        .get('/api/references')
        .query({ type: 'section', slug: 'intro', includeTagMatches: 'true' });

      expect(plain.status).toBe(200);
      expect(tagged.status).toBe(200);
      // Tag matching is meaningless for a section — phase 2 matches an ENTITY
      // against `<tagged_list/>` queries — so the flag is a no-op, not an error.
      expect(tagged.body.references).toEqual(plain.body.references);
    } finally {
      app.cleanup();
    }
  });
});
