import express from 'express';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { referencesRouter } from '../../../src/server/routes/references.js';
import type { DiscoveryCore } from '../../../src/server/discovery/types.js';
import type { ReferencesService } from '../../../src/server/services/references.js';
import type { ProjectPluginHost } from '../../../src/server/core/plugin-host/types.js';

/**
 * 0.2.13 (tier C) — `GET /api/references?pages=<dir>`.
 *
 * `--pages <dir>` used to be applied while the CLI assembled a discovery core of
 * its own. With execution moved into the server process the parameter has to
 * reach the ROOT LIST a sweep walks, and the thing that can silently go wrong is
 * that it reaches nothing — a project-wide sweep labelled as a narrowed one is
 * the right status, the right shape and the wrong answer. So what is asserted
 * here is WHICH core answered, not what it said.
 */

function harness() {
  const seen: string[] = [];
  const narrowed = {
    findReferences: async () => ({ references: [{ from: 'narrowed' }], total: 1, hasMore: false }),
  } as unknown as DiscoveryCore;
  const wide = {
    findReferences: async () => ({ references: [{ from: 'wide-core' }], total: 1, hasMore: false }),
  } as unknown as DiscoveryCore;
  const service = {
    findReferences: async () => [{ from: 'service' }],
  } as unknown as ReferencesService;
  const host = {
    getAvailable: (t: string) => t === 'ac',
    listEntities: () => [{ type: 'ac' }],
  } as unknown as ProjectPluginHost;

  const app = express();
  app.use(
    '/api/references',
    referencesRouter(host, service, wide, (dir) => {
      seen.push(dir);
      return narrowed;
    }),
  );
  return { app, seen };
}

describe('GET /api/references?pages=', () => {
  it('without it, the sweep runs on the project-wide core', async () => {
    // This asserted `'service'` when it was written, because the entity arm
    // short-circuited to `ReferencesService` unless tag matching was asked for.
    // That shortcut is gone: it dropped the `anchor` the core attaches to every
    // hit, and the two reasons it existed (a `raw` the core used to drop, and a
    // page-size cap) had already been fixed elsewhere in this release.
    const { app, seen } = harness();
    const res = await request(app).get('/api/references?type=ac&slug=x').expect(200);
    expect(res.body.references[0].from).toBe('wide-core');
    expect(seen).toEqual([]);
  });

  it('with it, the sweep runs on a core built over the narrowed root list', async () => {
    const { app, seen } = harness();
    const res = await request(app).get('/api/references?type=ac&slug=x&pages=docs/guides').expect(200);
    expect(res.body.references[0].from).toBe('narrowed');
    expect(seen).toEqual(['docs/guides']);
  });

  it('narrows the section and page arms too — it names the root list, not a target kind', async () => {
    const { app, seen } = harness();
    const s = await request(app).get('/api/references?target=section&anchor=a1&pages=docs').expect(200);
    expect(s.body.references[0].from).toBe('narrowed');
    const p = await request(app)
      .get('/api/references?target=page&rootId=mainspec&path=a.md&pages=docs')
      .expect(200);
    expect(p.body.references[0].from).toBe('narrowed');
    expect(seen).toEqual(['docs', 'docs']);
  });

  it('an empty or whitespace value is not an override', async () => {
    const { app, seen } = harness();
    await request(app).get('/api/references?type=ac&slug=x&pages=').expect(200);
    await request(app).get('/api/references?type=ac&slug=x&pages=%20%20').expect(200);
    expect(seen).toEqual([]);
  });

  it('refuses to be combined with type=section rather than dropping it silently', async () => {
    // The `section` pseudo-type is answered by the references service, which
    // cannot narrow. A no-op flag is fine when turning it on cannot change the
    // answer; a narrowing quietly dropped is the failure this parameter exists
    // to prevent.
    const { app, seen } = harness();
    const res = await request(app).get('/api/references?type=section&slug=a1&pages=docs').expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(seen).toEqual([]);
    // …and without the override it still answers, as it always has.
    await request(app).get('/api/references?type=section&slug=a1').expect(200);
  });
});

/**
 * 0.2.13 review fix — the entity arm answers from the CORE, so hits keep the
 * `anchor` the core attaches, and `includeTagMatches` is forwarded rather than
 * assumed.
 */
describe('GET /api/references — which implementation answers', () => {
  function coreHarness() {
    const calls: Array<Record<string, unknown>> = [];
    const core = {
      findReferences: async (input: Record<string, unknown>) => {
        calls.push(input);
        return {
          references: [{ rootId: 'pages', pagePath: 'a.md', anchor: 'aaaaaa11', raw: '<x/>' }],
          total: 1,
          hasMore: false,
        };
      },
    } as unknown as DiscoveryCore;
    const service = {
      findReferences: async () => [{ rootId: 'pages', pagePath: 'a.md', raw: '<x/>' }],
    } as unknown as ReferencesService;
    const host = {
      getAvailable: (t: string) => t === 'ac',
      listEntities: () => [{ type: 'ac' }],
    } as unknown as ProjectPluginHost;
    const app = express();
    app.use('/api/references', referencesRouter(host, service, core, () => core));
    return { app, calls };
  }

  it('the plain entity query keeps the anchor — the service projection dropped it', async () => {
    // `services/references.ts` projects to { rootId, pagePath, tagType, line, raw }.
    // The anchor is the entire link from a reference to `get-sections` /
    // `list-sections --by anchor`, which the CLI help advertises.
    const { app, calls } = coreHarness();
    const res = await request(app).get('/api/references?type=ac&slug=x').expect(200);
    expect(res.body.references[0].anchor).toBe('aaaaaa11');
    // …and `raw`, which is why the service shortcut existed, survives too.
    expect(res.body.references[0].raw).toBe('<x/>');
    expect(calls).toHaveLength(1);
  });

  it('includeTagMatches is FORWARDED, not forced on', async () => {
    // It was hardcoded `true` on the exhaustive path. Once `?pages=` started
    // routing through that path, a caller who passed `pages` alone silently got
    // phase-2 tag matches — the same operation answering differently because of
    // an unrelated flag.
    const a = coreHarness();
    await request(a.app).get('/api/references?type=ac&slug=x').expect(200);
    expect(a.calls[0]!.includeTagMatches).toBe(false);

    const b = coreHarness();
    await request(b.app).get('/api/references?type=ac&slug=x&pages=docs').expect(200);
    expect(b.calls[0]!.includeTagMatches).toBe(false);

    const c = coreHarness();
    await request(c.app).get('/api/references?type=ac&slug=x&includeTagMatches=true').expect(200);
    expect(c.calls[0]!.includeTagMatches).toBe(true);
  });

  it('`?offset=0` is a window, not the unbounded sweep', async () => {
    /**
     * The distinguishing observable is WHICH branch ran, so it is asserted on
     * the call the core received rather than on the row count — with a handful
     * of references both branches return the same body, which is exactly why
     * this went unnoticed.
     *
     * `limit` is the signal, not `offset`: the sweep
     * (`findReferencesAllPaged`) drives its own loop and always asks for
     * `MAX_LIMIT` rows, while the paged branch forwards only what the caller
     * gave. Both pass `offset: 0` on their first call, which is precisely why
     * that field cannot tell them apart.
     *
     * `?offset=0` used to be read as ABSENT: this route kept a private
     * `positiveInt` for both parameters, and `positiveInt('0')` is `undefined`
     * because zero is not greater than zero. A client asking for the first page
     * got every citation in the project in one body.
     */
    const a = coreHarness();
    await request(a.app).get('/api/references?type=ac&slug=x&offset=0').expect(200);
    expect(a.calls[0]!.offset).toBe(0);
    expect(a.calls[0]!.limit, 'a window request must not become a sweep').toBeUndefined();

    // And no window at all still sweeps — the property `find-references` relies on.
    const b = coreHarness();
    await request(b.app).get('/api/references?type=ac&slug=x').expect(200);
    expect(b.calls[0]!.limit).toBe(1000);
  });

  it('`section` still goes to the service — the core refuses the pseudo-type', async () => {
    const { app, calls } = coreHarness();
    const res = await request(app).get('/api/references?type=section&slug=a1').expect(200);
    expect(res.body.references[0].anchor).toBeUndefined();
    expect(calls).toEqual([]);
  });
});
