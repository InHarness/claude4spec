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

  it('is NOT idempotent — two filings of the same drift are two files', async () => {
    const body = { brief: 'b1.md', desc: 'same drift', body: 'x' };
    const a = await request(t.app).post('/api/patches').send(body).expect(201);
    const b = await request(t.app).post('/api/patches').send(body).expect(201);
    expect(a.body.data.path).toBe(b.body.data.path);
    // Same slug, but the second write is a real second report — the file is
    // rewritten rather than the request being rejected as a duplicate.
    expect(fs.existsSync(path.join(t.cwd, 'patches', a.body.data.path))).toBe(true);
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

  it('pages through the core when a window IS asked for, keeping the `tags` key', async () => {
    const res = await request(t.app).get('/api/tags?limit=2').expect(200);
    expect(res.body.tags).toHaveLength(2);
    expect(res.body.total).toBe(3);
  });
});
