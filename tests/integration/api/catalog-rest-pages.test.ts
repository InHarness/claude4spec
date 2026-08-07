import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { crossRootPagesRouter, pagesRouter, type PageRootRuntime } from '../../../src/server/routes/pages.js';
import { sectionsRouter } from '../../../src/server/routes/sections.js';
import type { DiscoveryCore } from '../../../src/server/discovery/types.js';
import type { SectionsService } from '../../../src/server/services/sections.js';
import { PagesService } from '../../../src/server/services/pages.js';

/**
 * 0.2.13 (tier C) — the page and section renderings, against a RECORDING core.
 *
 * These four routes are tested at the router level rather than through
 * `createTestApp`, and that is a deliberate choice rather than a shortcut. The
 * harness has no page roots (`roots: []`), so every one of these operations
 * would answer with an empty envelope there — which proves the route exists and
 * nothing else. What can actually break in a thin handler is the mapping: a
 * query parameter parsed into the wrong field, dropped, or defaulted at the
 * transport instead of by the core. A core that records its input is the only
 * thing that catches that.
 *
 * Registration ORDER is the other risk, and it is checked here too: the routes
 * added by this release all sit on paths that a param route would otherwise
 * swallow.
 */

interface Call {
  op: string;
  input: unknown;
}

function recordingCore(): { core: DiscoveryCore; calls: Call[] } {
  const calls: Call[] = [];
  const record =
    (op: string, result: unknown) =>
    (input?: unknown): never => {
      calls.push({ op, input });
      return result as never;
    };
  const core = {
    listPages: record('listPages', Promise.resolve({ items: [], total: 0, hasMore: false })),
    searchPages: record('searchPages', Promise.resolve({ items: [], total: 0, hasMore: false })),
    listSections: record('listSections', Promise.resolve({ items: [], total: 0, hasMore: false })),
    getSections: record('getSections', Promise.resolve({ sections: [] })),
  } as unknown as DiscoveryCore;
  return { core, calls };
}

const ROOT: PageRootRuntime = {
  root: { id: 'mainspec', dir: 'pages', sectionIndexed: true, referenceValidated: true } as never,
  pages: { listTree: async () => [] } as never,
  writer: null,
};

function appWithPages(core: DiscoveryCore) {
  const app = express();
  // The same order `project-context.ts` mounts them in — cross-root FIRST.
  app.use('/api/pages', crossRootPagesRouter(core));
  app.use(
    '/api/pages/:rootId',
    pagesRouter((id) => (id === 'mainspec' ? ROOT : undefined), null, core),
  );
  return app;
}

function appWithSections(core: DiscoveryCore) {
  const app = express();
  const service = {
    list: () => [{ anchor: 'from-the-service' }],
    getByAnchor: (a: string) => ({ anchor: a, from: 'service' }),
  } as unknown as SectionsService;
  app.use('/api/sections', sectionsRouter(service, core));
  return app;
}

describe('GET /api/pages/search — the cross-root search_pages', () => {
  it('is matched before `:rootId`, so `search` is not read as a root id', async () => {
    const { core, calls } = recordingCore();
    const res = await request(appWithPages(core)).get('/api/pages/search?q=alpha').expect(200);
    expect(res.body).toHaveProperty('items');
    // Had the per-root router won, this would be a 404 ROOT_NOT_FOUND for a root
    // called `search` and `searchPages` would never have been called.
    expect(calls.map((c) => c.op)).toEqual(['searchPages']);
  });

  it('carries regex, rootId narrowing, mode and the window into the core input', async () => {
    const { core, calls } = recordingCore();
    await request(appWithPages(core))
      .get('/api/pages/search?regex=%5Ea.*z%24&rootId=mainspec&mode=count&limit=5&offset=10')
      .expect(200);
    expect(calls[0].input).toEqual({
      regex: '^a.*z$',
      rootId: 'mainspec',
      mode: 'count',
      limit: 5,
      offset: 10,
    });
  });

  it('omits what was not asked rather than substituting a transport default', async () => {
    const { core, calls } = recordingCore();
    await request(appWithPages(core)).get('/api/pages/search?q=x&mode=bogus&limit=notanumber').expect(200);
    // An unreadable `mode`/`limit` leaves the CORE's default standing. A
    // transport that invented one would answer differently from the same
    // operation reached over MCP.
    expect(calls[0].input).toEqual({ query: 'x' });
  });
});

describe('GET /api/pages/:rootId/list — the flat list_pages', () => {
  it('answers beside the tree rather than replacing it', async () => {
    const { core, calls } = recordingCore();
    const app = appWithPages(core);
    const tree = await request(app).get('/api/pages/mainspec').expect(200);
    expect(tree.body).toHaveProperty('tree');
    const list = await request(app).get('/api/pages/mainspec/list').expect(200);
    expect(list.body).toHaveProperty('items');
    expect(calls.map((c) => c.op)).toEqual(['listPages']);
  });

  it('passes prefix and sort through, and takes the root id from the URL', async () => {
    const { core, calls } = recordingCore();
    await request(appWithPages(core))
      .get('/api/pages/mainspec/list?prefix=guides/&sort=modified&limit=3')
      .expect(200);
    expect(calls[0].input).toEqual({
      rootId: 'mainspec',
      prefix: 'guides/',
      sort: 'modified',
      limit: 3,
    });
  });

  it('an unknown root is ROOT_NOT_FOUND, not an empty list', async () => {
    const { core, calls } = recordingCore();
    const res = await request(appWithPages(core)).get('/api/pages/nope/list').expect(404);
    expect(res.body.error.code).toBe('ROOT_NOT_FOUND');
    expect(calls).toHaveLength(0);
  });
});

describe('GET /api/sections/list and /api/sections/get', () => {
  it('both are matched before `/:anchor`', async () => {
    const { core, calls } = recordingCore();
    const app = appWithSections(core);
    await request(app).get('/api/sections/list?by=anchor&anchor=a1').expect(200);
    await request(app).get('/api/sections/get?anchors=a1').expect(200);
    // The `/:anchor` handler answers from the SERVICE, so if either had been
    // captured the recording core would show nothing.
    expect(calls.map((c) => c.op)).toEqual(['listSections', 'getSections']);
    // …and the service route still works, for an anchor that is not a keyword.
    const one = await request(app).get('/api/sections/a1').expect(200);
    expect(one.body.from).toBe('service');
  });

  it('list demands the discriminant, and the field the chosen arm needs', async () => {
    const { core } = recordingCore();
    const app = appWithSections(core);
    expect((await request(app).get('/api/sections/list').expect(400)).body.error.code).toBe('VALIDATION');
    expect((await request(app).get('/api/sections/list?by=anchor').expect(400)).body.error.code).toBe(
      'VALIDATION',
    );
    // `by=page` is keyed by (rootId, path) — a path alone is ambiguous across roots.
    expect(
      (await request(app).get('/api/sections/list?by=page&path=a.md').expect(400)).body.error.code,
    ).toBe('VALIDATION');
  });

  it('list by page carries both halves of the key', async () => {
    const { core, calls } = recordingCore();
    await request(appWithSections(core))
      .get('/api/sections/list?by=page&rootId=mainspec&path=guides/a.md&offset=2')
      .expect(200);
    expect(calls[0].input).toEqual({ by: 'page', rootId: 'mainspec', path: 'guides/a.md', offset: 2 });
  });

  it('get takes a comma list and the subtree flag, and no window', async () => {
    const { core, calls } = recordingCore();
    await request(appWithSections(core))
      .get('/api/sections/get?anchors=a1,%20a2%20,,a3&includeSubtree=true&limit=5')
      .expect(200);
    // Trimmed, empties dropped — a trailing comma from a shell loop must not
    // become a request for a section called "". `limit` is not a parameter of a
    // fetch-by-key operation and is ignored rather than forwarded.
    expect(calls[0].input).toEqual({ anchors: ['a1', 'a2', 'a3'], includeSubtree: true });
  });

  it('get without anchors is VALIDATION', async () => {
    const { core } = recordingCore();
    const res = await request(appWithSections(core)).get('/api/sections/get').expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});

/**
 * 0.2.13 (tier C-3) — `PUT /api/sections/:anchor`, the `rest` rendering of
 * `update_section`.
 *
 * The one page-write operation that had no REST route at all before this tier,
 * because it had no implementation at all. Asserted at the router level like its
 * siblings above: what a thin write handler gets wrong is the mapping and the
 * ordering, not the file I/O, which `page-write.test.ts` covers against a real
 * filesystem.
 */
describe('PUT /api/sections/:anchor — the rest rendering of update_section', () => {
  function appWithWrites() {
    const { core } = recordingCore();
    const app = express();
    app.use(express.json());
    const service = { list: () => [] } as unknown as SectionsService;
    // A REAL PagesService over a temp dir. The stubbed alternative could not
    // answer the one question this route exists to answer — whether the page
    // came out spliced or replaced — because the splice happens against bytes.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-put-section-'));
    const pages = new PagesService(dir, 'pages', 'mainspec');
    const writeDeps = {
      sections: {
        getByAnchor: (a: string) =>
          a === 'aaaa1111'
            ? { anchor: a, rootId: 'mainspec', pagePath: 'a.md', lineStart: 1, lineEnd: 2 }
            : null,
      },
      resolveRoot: (id: string) => (id === 'mainspec' ? { pages, writer: null } : undefined),
    };
    app.use('/api/sections', sectionsRouter(service, core, writeDeps as never));
    return { app, pages, dir };
  }

  it('does not shadow the static GET routes declared above it', async () => {
    // `PUT /:anchor` is method-scoped so it cannot, but the ordering claim is
    // worth an assertion rather than an argument — `/list` and `/get` are the
    // two segments a param route would swallow if the guarantee ever moved.
    const { app, dir } = appWithWrites();
    try {
      await request(app).get('/api/sections/list?by=page&rootId=mainspec&path=a.md').expect(200);
      await request(app).get('/api/sections/get?anchors=x').expect(200);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an unknown anchor is SECTION_NOT_FOUND with the call that would have worked', async () => {
    const { app, dir } = appWithWrites();
    try {
      const res = await request(app).put('/api/sections/nope').send({ content: 'x' }).expect(400);
      expect(res.body.error.code).toBe('SECTION_NOT_FOUND');
      expect(res.body.error.hint).toContain('list_sections');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes through the shared primitive, so the section body is spliced rather than replacing the page', async () => {
    /**
     * The failure this catches is a REST handler that "helpfully" writes
     * `content` as the whole page — which reads as working (200, right shape)
     * until someone notices the rest of the page is gone. The heading stays put
     * because the primitive replaces only what is below it.
     */
    const { app, pages, dir } = appWithWrites();
    try {
      await pages.ensureRoot();
      await pages.write('a.md', { body: '# H\nold body\n\n# Next\nkeep me' });
      const res = await request(app).put('/api/sections/aaaa1111').send({ content: 'new body' }).expect(200);
      expect(res.body.anchor).toBe('aaaa1111');
      const body = (await pages.read('a.md')).body;
      expect(body).toContain('# H');
      expect(body).toContain('new body');
      expect(body).not.toContain('old body');
      expect(body).toContain('keep me');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('forwards expectedHash rather than dropping it', async () => {
    // Silently ignoring the guard is worse than not offering it: the caller
    // believes its write was conflict-checked.
    const { app, pages, dir } = appWithWrites();
    try {
      await pages.ensureRoot();
      await pages.write('a.md', { body: '# H\nold body' });
      const res = await request(app)
        .put('/api/sections/aaaa1111')
        .send({ content: 'x', expectedHash: 'c'.repeat(64) })
        .expect(409);
      expect(res.body.error.code).toBe('PAGE_CONFLICT');
      expect((await pages.read('a.md')).body).toContain('old body');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
