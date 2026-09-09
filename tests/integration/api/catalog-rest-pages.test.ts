import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { crossRootPagesRouter, pagesRouter, type PageRootRuntime } from '../../../src/server/routes/pages.js';
import { sectionsRouter } from '../../../src/server/routes/sections.js';
import type { DiscoveryCore } from '../../../src/server/discovery/types.js';
import type Database from 'better-sqlite3';
import { SECTION_CONTENT_SNIPPET_CHARS, SectionsService } from '../../../src/server/services/sections.js';
import { createTestDb } from '../../helpers/test-db.js';
import { PagesService } from '../../../src/server/services/pages.js';
import { FileWatchRuntime, type WatchScope } from '../../../src/server/fs/watcher.js';
import { RecordStore } from '../../../src/server/fs/record-store.js';
import { markdownAdapter, type MarkdownRecord } from '../../../src/server/fs/record-adapters.js';
import {
  PROJECTION_IDS,
  ProjectionStatusRegistry,
} from '../../../src/server/services/projection-status.js';

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
    getPageOutline: record('getPageOutline', Promise.resolve({ rootId: 'mainspec', path: 'a.md', hash: 'h', sections: [] })),
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

/**
 * 0.2.77 — every rig here mounts a real M42 primitive.
 *
 * Spec content has exactly one writer since this release: the `markOrigin` →
 * write → `flush` fallback these fixtures relied on is gone from production, so
 * a rig without a record store would exercise a path that no longer exists.
 * `fsEvents: false` — these tests are about REST envelopes, not the file provider.
 */
const rigRuntimes: FileWatchRuntime[] = [];
const RIG_SCOPE: WatchScope = 'context:catalog-rest-pages-rig';

function withRecords(pages: PagesService): PagesService {
  fs.mkdirSync(pages.root, { recursive: true });
  const runtime = new FileWatchRuntime({ fsEvents: false });
  rigRuntimes.push(runtime);
  const source = `pages:${pages.rootId}`;
  runtime.mountSource({ source, dir: pages.root, scope: RIG_SCOPE });
  pages.records = new RecordStore<MarkdownRecord>({
    registrar: runtime.scoped(RIG_SCOPE),
    source,
    dir: pages.root,
    adapter: markdownAdapter,
  });
  return pages;
}

afterEach(async () => {
  for (const r of rigRuntimes.splice(0)) await r.close();
});

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

describe('an unknown :rootId', () => {
  it('names the roots that DO exist rather than answering a bare not-found', () => {
    /**
     * Before the read commands became server-delegating this refusal came from
     * the core (`PageSource.service()` → `invalidArgument('unknown rootId …',
     * 'roots in this project: …')`), so `c4s list-pages --root-id typo` printed
     * the list. The REST rendering short-circuits ahead of the core, and its
     * first version answered a bare message — turning a one-keystroke mistake
     * into a dead end on the surface whose whole job is to be navigable.
     */
    const app = express();
    app.use(
      '/api/pages/:rootId',
      pagesRouter((id) => (id === 'mainspec' ? ROOT : undefined), null, recordingCore().core, () => [
        'mainspec',
        'guides',
      ]),
    );
    return request(app)
      .get('/api/pages/nope/list')
      .expect(404)
      .then((res) => {
        expect(res.body.error.code).toBe('ROOT_NOT_FOUND');
        expect(res.body.error.hint).toContain('mainspec');
        expect(res.body.error.hint).toContain('guides');
      });
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

/**
 * 0.2.46 — the plain index listing, against a REAL `SectionsService`.
 *
 * The rest of this file drives a recording core and a fake service, because
 * what it checks is the mapping a thin handler can get wrong. Here the thing
 * under test IS the emitted row, so the fake would be testing itself: the
 * service is wired to a real database instead.
 */
describe('GET /api/sections — the index listing', () => {
  function appWithRealSections(): { app: express.Express; db: Database.Database } {
    const db = createTestDb();
    const app = express();
    app.use('/api/sections', sectionsRouter(new SectionsService(db), recordingCore().core));
    return { app, db };
  }

  function insert(db: Database.Database, anchor: string, page: string, heading: string, body: string): void {
    db.prepare(
      `INSERT INTO section_index
         (rootId, anchor, page_path, parent_anchor, heading_slug, heading_level, heading_text,
          content_hash, body, line_start, line_end, paragraph_count)
       VALUES ('pages', ?, ?, NULL, ?, 2, ?, 'hash', ?, 1, 5, 1)`,
    ).run(anchor, page, heading.toLowerCase(), heading, body);
  }

  it('emits a bounded snippet and never the materialized column', async () => {
    const { app, db } = appWithRealSections();
    try {
      insert(db, 'aaaa1111', 'notes.md', 'Alpha', 'A'.repeat(SECTION_CONTENT_SNIPPET_CHARS * 3));

      const res = await request(app).get('/api/sections').expect(200);

      const [entry] = res.body.sections;
      expect(entry.contentSnippet).toHaveLength(SECTION_CONTENT_SNIPPET_CHARS);
      expect(Object.keys(entry)).not.toContain('body');
      // The coordinates and header metadata are untouched by the addition.
      expect(entry).toMatchObject({
        anchor: 'aaaa1111',
        pagePath: 'notes.md',
        headingText: 'Alpha',
        headingLevel: 2,
        contentHash: 'hash',
        lineStart: 1,
        lineEnd: 5,
      });
    } finally {
      db.close();
    }
  });

  it('keeps `pagePath` an optional filter', async () => {
    const { app, db } = appWithRealSections();
    try {
      insert(db, 'aaaa1111', 'notes.md', 'Alpha', 'from notes');
      insert(db, 'bbbb2222', 'other.md', 'Beta', 'from other');

      const all = await request(app).get('/api/sections').expect(200);
      expect(all.body.sections).toHaveLength(2);

      const scoped = await request(app).get('/api/sections?pagePath=notes.md').expect(200);
      expect(scoped.body.sections.map((s: { anchor: string }) => s.anchor)).toEqual(['aaaa1111']);
      expect(scoped.body.sections[0].contentSnippet).toBe('from notes');
    } finally {
      db.close();
    }
  });
});

describe("GET /api/sections/get, and the /list route 0.2.59 removed", () => {
  it('`get` is matched before `/:anchor`', async () => {
    const { core, calls } = recordingCore();
    const app = appWithSections(core);
    await request(app).get('/api/sections/get?anchors=a1').expect(200);
    // The `/:anchor` handler answers from the SERVICE, so if this had been
    // captured the recording core would show nothing.
    expect(calls.map((c) => c.op)).toEqual(['getSections']);
    // …and the service route still works, for an anchor that is not a keyword.
    const one = await request(app).get('/api/sections/a1').expect(200);
    expect(one.body.from).toBe('service');
  });

  /**
   * 0.2.59 — `/api/sections/list` went with the operation it rendered.
   *
   * It is NOT renamed to an outline route: this router is keyed by anchors and by
   * nothing, while an outline is keyed by ONE page, so its transport belongs in the
   * page family (`GET /api/pages/:rootId/outline`). Asserted as a 404 rather than
   * simply deleted, because the path is now free for `/:anchor` to swallow — an
   * old caller must get a miss, not a lookup for a section named "list".
   */
  it('`/list` is gone, and falls through to the anchor route rather than lingering', async () => {
    const { core, calls } = recordingCore();
    const app = appWithSections(core);
    // The stub service answers every anchor, so this proves only that no dedicated
    // handler intercepted it — the core was never called.
    await request(app).get('/api/sections/list?by=page&rootId=mainspec&path=a.md').expect(200);
    expect(calls).toEqual([]);
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
 * 0.2.13 (tier C-3) — the `rest` rendering of M06's write, `PATCH /api/sections`.
 *
 * The one page-write operation that had no REST route at all before that tier,
 * because it had no implementation at all. 0.2.15 moved it from `PUT /:anchor`
 * to `PUT /`: the operation takes a batch, so the anchor lives inside the
 * payload once per edit and a URL naming one of them would be naming an
 * arbitrary member of the set.
 *
 * Asserted at the router level like its siblings above: what a thin write
 * handler gets wrong is the mapping and the ordering, not the file I/O, which
 * `page-write.test.ts` covers against a real filesystem.
 */
describe('PATCH /api/sections — the rest rendering of update_sections', () => {
  /**
   * @param referents Who cites a given anchor, for the anchor-loss guard. A
   *   stub rather than the real discovery core: what these cases are about is
   *   the ROUTE — that it forwards `dropAnchors`, and that it renders the
   *   refusal as a 400 carrying `details`. Whether the guard finds the right
   *   referents is settled over real pages in `page-write.test.ts`.
   */
  function appWithWrites(
    referents: Record<string, Array<{ page: string }>> = {},
    projectionStatus?: ProjectionStatusRegistry,
  ) {
    const { core } = recordingCore();
    const app = express();
    app.use(express.json());
    const service = { list: () => [] } as unknown as SectionsService;
    // A REAL PagesService over a temp dir. The stubbed alternative could not
    // answer the one question this route exists to answer — whether the page
    // came out spliced or replaced — because the splice happens against bytes.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-put-section-'));
    const pages = withRecords(new PagesService(dir, 'pages', 'mainspec'));
    const writeDeps = {
      sections: {
        /**
         * `lineStart`/`lineEnd` are DELIBERATELY wrong — they address the whole
         * page, heading included.
         *
         * The primitive recomputes the range from the file by anchor, so a row
         * that has drifted from the bytes cannot steer the splice. Feeding it a
         * stale row here is the mutation check: revert that and this fixture
         * replaces the entire page, which is exactly the corruption the review
         * found. `expectedHash` is mandatory as of 0.2.15 and would catch a
         * stale CALLER, but not this — the caller's hash here is perfectly
         * current and it is the INDEX that drifted.
         */
        getByAnchor: (a: string) =>
          a === 'aaaa1111'
            ? { anchor: a, rootId: 'mainspec', pagePath: 'a.md', lineStart: 1, lineEnd: 6 }
            : null,
      },
      resolveRoot: (id: string) => (id === 'mainspec' ? { pages, writer: null } : undefined),
      findSectionReferents: async (anchor: string) => referents[anchor] ?? [],
      projectionStatus,
    };
    app.use('/api/sections', sectionsRouter(service, core, writeDeps as never));
    return { app, pages, dir };
  }

  it('does not shadow the static GET routes declared above it', async () => {
    // `PATCH /` is method-scoped so it cannot, but the ordering claim is worth an
    // assertion rather than an argument. Since 0.2.59 `/get` is the only static
    // segment left here — `/list` went with `list_sections`.
    const { app, dir } = appWithWrites();
    try {
      await request(app).get('/api/sections/get?anchors=x').expect(200);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an unknown anchor is SECTION_NOT_FOUND with the call that would have worked', async () => {
    const { app, dir } = appWithWrites();
    try {
      const res = await request(app)
        .patch('/api/sections')
        .send({ expectedHash: 'a'.repeat(64), edits: [{ anchor: 'nope', action: 'replace', content: 'x' }] })
        .expect(400);
      expect(res.body.error.code).toBe('SECTION_NOT_FOUND');
      expect(res.body.error.hint).toContain('get_page_outline');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('[ac:ac-patch-api-sections-odpowiada-statusem] answers 409 for INDEX_STALE as it does for PAGE_CONFLICT, and the codes tell them apart', async () => {
    /**
     * 0.2.78 — the route is `PATCH /api/sections` now, so this criterion and the
     * code finally name the same thing. It read `PUT` from 0.2.15 (which moved it
     * off `PUT /:anchor`) until the verb was corrected: the batch describes
     * CHANGES to a few sections, which is what `PATCH` means, where `PUT` claimed
     * the payload was the whole resource.
     *
     * Two 409s side by side are not an ambiguity trap. The retry instruction is
     * identical ("refresh and retry"); the CODE says only WHAT to refresh — the
     * page hash, or the index. A client that cannot tell them apart retries the
     * wrong thing forever, which is why the code, not the status, is the contract.
     */
    const status = new ProjectionStatusRegistry();
    const { app, pages, dir } = appWithWrites({}, status);
    try {
      await pages.ensureRoot();
      await pages.write('a.md', {
        body: '<!-- anchor: aaaa1111 -->\n# H\nold body\n',
      });
      const hash = (await pages.read('a.md')).hash;

      // 1 — a stale CALLER hash.
      const conflict = await request(app)
        .patch('/api/sections')
        .send({
          expectedHash: 'a'.repeat(64),
          edits: [{ anchor: 'aaaa1111', action: 'replace', content: 'x' }],
        })
        .expect(409);
      expect(conflict.body.error.code).toBe('PAGE_CONFLICT');

      // 2 — a perfectly current caller hash, and a stale INDEX.
      status.markStale(PROJECTION_IDS.sections, 'mainspec:a.md');
      const stale = await request(app)
        .patch('/api/sections')
        .send({ expectedHash: hash, edits: [{ anchor: 'aaaa1111', action: 'replace', content: 'x' }] })
        .expect(409);
      expect(stale.body.error.code).toBe('INDEX_STALE');
      expect(stale.body.error.hint).toContain('rebuild');
      // Nothing was written: the batch is refused in its entirety.
      expect((await pages.read('a.md')).body).toContain('old body');
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
      // With the anchor comments the indexer injects — they are how the section
      // is located in the bytes, and a fixture without them is not a page the
      // section index could ever have been built from.
      await pages.write('a.md', {
        body: '<!-- anchor: aaaa1111 -->\n# H\nold body\n\n<!-- anchor: bbbb2222 -->\n# Next\nkeep me',
      });
      const res = await request(app)
        .patch('/api/sections')
        .send({
          expectedHash: (await pages.read('a.md')).hash,
          edits: [{ anchor: 'aaaa1111', action: 'replace', content: 'new body' }],
        })
        .expect(200);
      expect(res.body.results[0].anchor).toBe('aaaa1111');
      const body = (await pages.read('a.md')).body;
      expect(body).toContain('# H');
      expect(body).toContain('new body');
      expect(body).not.toContain('old body');
      expect(body).toContain('keep me');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers a section write with the delta, not with the page — REST is bound by echo-free too', async () => {
    /**
     * The rule is the operation's, not the agent channel's: "the output shape is
     * the operation's, the channel adapter does not widen it". A REST handler
     * that appends the body because its own front-end finds it convenient has
     * authored a second semantics for the same operation.
     *
     * There was no test on this response shape at all before — which is how the
     * whole serialized page went out of here unnoticed.
     */
    const { app, pages, dir } = appWithWrites();
    try {
      await pages.ensureRoot();
      await pages.write('a.md', {
        body: '<!-- anchor: aaaa1111 -->\n# H\nold body\n\n<!-- anchor: bbbb2222 -->\n# Next\nkeep me',
      });
      const res = await request(app)
        .patch('/api/sections')
        .send({
          expectedHash: (await pages.read('a.md')).hash,
          edits: [{ anchor: 'aaaa1111', action: 'replace', content: 'new body' }],
        })
        .expect(200);
      expect(Object.keys(res.body).sort()).toEqual(['hash', 'path', 'results', 'version']);
      expect(res.body).not.toHaveProperty('body');
      expect(res.body).not.toHaveProperty('frontmatter');
      expect(JSON.stringify(res.body)).not.toContain('keep me');
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
        .patch('/api/sections')
        .send({
          expectedHash: 'c'.repeat(64),
          edits: [{ anchor: 'aaaa1111', action: 'replace', content: 'x' }],
        })
        .expect(409);
      expect(res.body.error.code).toBe('PAGE_CONFLICT');
      expect((await pages.read('a.md')).body).toContain('old body');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** A page whose first section CONTAINS a subsection — the anchor-loss shape. */
  const NESTED =
    '<!-- anchor: aaaa1111 -->\n# H\nold body\n\n' +
    '<!-- anchor: cccc3333 -->\n## Sub\nsub body\n\n' +
    '<!-- anchor: bbbb2222 -->\n# Next\nkeep me';

  it('renders ANCHOR_LOSS as 400 with details, not as a 409', async () => {
    /**
     * The status is the assertion. `PAGE_CONFLICT` next door is 409 because its
     * repair is "re-read and retry"; this refusal is deterministic, so a client
     * that treated it as a conflict would retry the identical request forever.
     * `details` rides along because an anchor is an opaque token — without it the
     * caller cannot tell WHICH section it was about to orphan.
     */
    const { app, pages, dir } = appWithWrites({ cccc3333: [{ page: 'cites.md' }] });
    try {
      await pages.ensureRoot();
      await pages.write('a.md', { body: NESTED });
      const res = await request(app)
        .patch('/api/sections')
        .send({
          expectedHash: (await pages.read('a.md')).hash,
          edits: [{ anchor: 'aaaa1111', action: 'replace', content: 'new body' }],
        })
        .expect(400);
      expect(res.body.error.code).toBe('ANCHOR_LOSS');
      expect(res.body.error.details).toEqual([
        { anchor: 'cccc3333', headingText: '', referencedBy: [{ page: 'cites.md' }] },
      ]);
      // Refused BEFORE the write: the page is untouched.
      expect((await pages.read('a.md')).body).toContain('sub body');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renders ANCHOR_DUPLICATE as 400 with details, not as a 409', async () => {
    /**
     * The mirror of the case above, and 400 for the identical reason: no retry
     * of the same request can come out differently, because the offending value
     * is in the request. `details` says where the value is currently held, which
     * is the only thing that makes an opaque 8-character token actionable.
     */
    const { app, pages, dir } = appWithWrites({});
    try {
      await pages.ensureRoot();
      await pages.write('a.md', { body: NESTED });
      const res = await request(app)
        .patch('/api/sections')
        .send({
          expectedHash: (await pages.read('a.md')).hash,
          edits: [
            {
              anchor: 'aaaa1111',
              action: 'replace',
              content: 'new body\n\n<!-- anchor: bbbb2222 -->\n## Stolen\nbody',
            },
          ],
          dropAnchors: ['cccc3333'],
        })
        .expect(400);
      expect(res.body.error.code).toBe('ANCHOR_DUPLICATE');
      // Two headings would answer to `bbbb2222` — the copy and the original.
      // `headingText` names the first of them, so the caller can see the clash.
      expect(res.body.error.details).toEqual([{ anchor: 'bbbb2222', page: 'a.md', headingText: 'Stolen' }]);
      expect((await pages.read('a.md')).body).toContain('old body');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('forwards dropAnchors rather than dropping it', async () => {
    // Same failure mode as `expectedHash` above: a route that silently discards
    // the field turns an accepted loss into a permanent refusal, and the caller
    // has no way to tell it was never read.
    const { app, pages, dir } = appWithWrites({ cccc3333: [{ page: 'cites.md' }] });
    try {
      await pages.ensureRoot();
      await pages.write('a.md', { body: NESTED });
      const res = await request(app)
        .patch('/api/sections')
        .send({
          expectedHash: (await pages.read('a.md')).hash,
          edits: [{ anchor: 'aaaa1111', action: 'replace', content: 'new body' }],
          dropAnchors: ['cccc3333'],
        })
        .expect(200);
      expect(res.body.results[0].droppedAnchors).toEqual(['cccc3333']);
      expect((await pages.read('a.md')).body).not.toContain('sub body');
      expect((await pages.read('a.md')).body).toContain('keep me');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * 0.2.37 — `PATCH /api/pages/:rootId/*`, the second REST rendering of
 * `update_page`.
 *
 * The claim under test is the one the L3 rule rests on: this route and the `PUT`
 * beside it call the SAME core function and answer the SAME shape, differing
 * only in how the body describes the new content. So the cases here are about
 * the mapping and the status rendering — whether the substitution itself is
 * correct is settled over real pages in `page-write.test.ts`.
 */
describe('PATCH /api/pages/:rootId/* — the differential rendering of update_page', () => {
  const PAGE = ['# Doc', '', 'alpha beta', ''].join('\n');

  function appWithPageWrites(referents: Record<string, Array<{ page: string }>> = {}) {
    const { core } = recordingCore();
    const app = express();
    app.use(express.json());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-patch-page-'));
    const pages = withRecords(new PagesService(dir, 'pages', 'mainspec'));
    fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pages', 'a.md'), PAGE, 'utf-8');
    const root: PageRootRuntime = {
      root: { id: 'mainspec', dir: 'pages', sectionIndexed: true, referenceValidated: true } as never,
      pages,
      writer: null,
    };
    const writeDeps = {
      sections: { getByAnchor: () => null },
      resolveRoot: (id: string) => (id === 'mainspec' ? root : undefined),
      findSectionReferents: async (anchor: string) => referents[anchor] ?? [],
    };
    app.use(
      '/api/pages/:rootId',
      pagesRouter((id) => (id === 'mainspec' ? root : undefined), null, core, () => ['mainspec'], writeDeps as never),
    );
    return { app, pages, dir };
  }

  const hashOf = (dir: string) =>
    import('node:crypto').then((c) =>
      c.createHash('sha256').update(fs.readFileSync(path.join(dir, 'pages', 'a.md'), 'utf-8'), 'utf-8').digest('hex'),
    );

  it('substitutes and answers UpdatePageResponse — hash, version, changedAnchors, replacements', async () => {
    const { app, dir } = appWithPageWrites();
    try {
      const res = await request(app)
        .patch('/api/pages/mainspec/a.md')
        .send({ textEdits: [{ find: 'alpha', replaceWith: 'ALPHA' }], expectedHash: await hashOf(dir) })
        .expect(200);
      expect(res.body).toMatchObject({ replacements: 1, version: expect.any(Number) });
      expect(res.body.hash).toEqual(expect.any(String));
      expect(res.body.changedAnchors).toBeInstanceOf(Array);
      expect(fs.readFileSync(path.join(dir, 'pages', 'a.md'), 'utf-8')).toContain('ALPHA beta');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a stale expectedHash is 409 PAGE_CONFLICT carrying currentHash — same as PUT', async () => {
    const { app, dir } = appWithPageWrites();
    try {
      const res = await request(app)
        .patch('/api/pages/mainspec/a.md')
        .send({ textEdits: [{ find: 'alpha', replaceWith: 'X' }], expectedHash: 'b'.repeat(64) })
        .expect(409);
      expect(res.body.error.code).toBe('PAGE_CONFLICT');
      expect(res.body.currentHash).toEqual(await hashOf(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a pattern that matches nothing is 400 FIND_NOT_FOUND with the normalization diagnosis', async () => {
    const { app, dir } = appWithPageWrites();
    try {
      const res = await request(app)
        .patch('/api/pages/mainspec/a.md')
        .send({ textEdits: [{ find: 'alpha  beta', replaceWith: 'X' }], expectedHash: await hashOf(dir) })
        .expect(400);
      expect(res.body.error.code).toBe('FIND_NOT_FOUND');
      expect(res.body.error.details[0].matchesAfterWhitespaceNormalization).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a wrong count is 400 MATCH_COUNT_MISMATCH', async () => {
    const { app, dir } = appWithPageWrites();
    try {
      const res = await request(app)
        .patch('/api/pages/mainspec/a.md')
        .send({ textEdits: [{ find: 'alpha', replaceWith: 'X', expectedMatches: 2 }], expectedHash: await hashOf(dir) })
        .expect(400);
      expect(res.body.error.code).toBe('MATCH_COUNT_MISMATCH');
      expect(res.body.error.details[0]).toMatchObject({ expectedMatches: 2, actualMatches: 1 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an empty textEdits reaches the core, which says what the bounds are', async () => {
    const { app, dir } = appWithPageWrites();
    try {
      const res = await request(app)
        .patch('/api/pages/mainspec/a.md')
        .send({ textEdits: [], expectedHash: await hashOf(dir) })
        .expect(400);
      expect(res.body.error.code).toBe('INVALID_ARGUMENT');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * The adapter forwards `textEdits` verbatim rather than defaulting it to `[]`,
   * so a PATCH that describes no change at all is refused for what it forgot to
   * say — not for the shape of an array it never sent.
   */
  it('a PATCH with no textEdits at all is refused by the core disjunction, not by the array bound', async () => {
    const { app, dir } = appWithPageWrites();
    try {
      const res = await request(app)
        .patch('/api/pages/mainspec/a.md')
        .send({ expectedHash: await hashOf(dir) })
        .expect(400);
      expect(res.body.error.code).toBe('INVALID_ARGUMENT');
      expect(res.body.error.message).toMatch(/one of body or textEdits/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an unknown root is 404 ROOT_NOT_FOUND, inherited from PUT', async () => {
    const { app, dir } = appWithPageWrites();
    try {
      const res = await request(app).patch('/api/pages/typo/a.md').send({ textEdits: [] }).expect(404);
      expect(res.body.error.code).toBe('ROOT_NOT_FOUND');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves PUT alone — the literal mode still takes a whole body', async () => {
    const { app, dir } = appWithPageWrites();
    try {
      const res = await request(app)
        .put('/api/pages/mainspec/a.md')
        .send({ body: '# Doc\n\nreplaced\n', expectedHash: await hashOf(dir) })
        .expect(200);
      // The two routes answer the same shape; only `replacements` is mode-specific.
      expect(res.body.replacements).toBeUndefined();
      expect(res.body.hash).toEqual(expect.any(String));
      expect(fs.readFileSync(path.join(dir, 'pages', 'a.md'), 'utf-8')).toContain('replaced');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * 0.2.78 — `POST /api/pages/:rootId/move`, the `rest` rendering of `move_page`.
   *
   * The addressing is the unusual part and the first test is about it: both
   * paths travel in the BODY. This family addresses pages with a splat, so
   * `…/foo.md/move` is a legal address for a page called `move` inside a
   * directory called `foo.md` — the URL cannot carry a verb here at all. The
   * verb therefore goes on the root COLLECTION, exactly where `GET /search`
   * already sits.
   */
  describe('POST /api/pages/:rootId/move — the rest rendering of move_page', () => {
    const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, 'pages', rel), 'utf-8');
    const exists = (dir: string, rel: string) => fs.existsSync(path.join(dir, 'pages', rel));

    it('moves the page, answers the NEW path, and leaves the hash unchanged', async () => {
      const { app, dir } = appWithPageWrites();
      try {
        const before = await hashOf(dir);
        const res = await request(app)
          .post('/api/pages/mainspec/move')
          .send({ from: 'a.md', to: 'guides/b.md', expectedHash: before })
          .expect(200);
        expect(res.body.path).toBe('guides/b.md');
        expect(res.body.rootId).toBe('mainspec');
        /**
         * The hash is the SAME value, and that is the contract rather than an
         * accident of the fixture: a move relocates bytes by rename and never
         * runs the format adapter, so re-serialization cannot have happened. It
         * is echoed at all because the caller needs it to arm its next write at
         * the new address — re-reading a file it just moved, to learn a value it
         * already held, is the round trip this saves.
         */
        expect(res.body.hash).toBe(before);
        // A move answers no content: it is the one write that never reads what
        // it writes.
        expect(res.body.content).toBeUndefined();
        expect(exists(dir, 'a.md')).toBe(false);
        expect(read(dir, 'guides/b.md')).toContain('alpha');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('is NOT idempotent — the replay is NOT_FOUND, because the source is gone', async () => {
      // The `delete` class, not the `replace` class. A caller that retries on a
      // timeout has to be able to tell "it already worked" from "it never did",
      // and this refusal is the only honest answer to the second call.
      const { app, dir } = appWithPageWrites();
      try {
        const hash = await hashOf(dir);
        await request(app).post('/api/pages/mainspec/move').send({ from: 'a.md', to: 'b.md', expectedHash: hash }).expect(200);
        const res = await request(app)
          .post('/api/pages/mainspec/move')
          .send({ from: 'a.md', to: 'b.md', expectedHash: hash })
          .expect(404);
        /**
         * `NOT_FOUND`, not `INVALID_ARGUMENT`. The request was well formed and
         * the first call is what made it fail — a retrying client has to be able
         * to tell "my path was wrong" from "my work already landed", and only
         * the code carries that.
         */
        expect(res.body.error.code).toBe('NOT_FOUND');
        expect(res.body.error.message).toContain('a.md');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('refuses PAGE_EXISTS rather than overwriting the destination', async () => {
      const { app, dir } = appWithPageWrites();
      try {
        fs.writeFileSync(path.join(dir, 'pages', 'taken.md'), '# Taken\n', 'utf-8');
        const res = await request(app)
          .post('/api/pages/mainspec/move')
          .send({ from: 'a.md', to: 'taken.md', expectedHash: await hashOf(dir) })
          .expect(409);
        expect(res.body.error.code).toBe('PAGE_EXISTS');
        // NEITHER file is touched. `fs.renameSync` would have clobbered the
        // destination silently, which is the one outcome a move must not have.
        expect(read(dir, 'taken.md')).toContain('Taken');
        expect(exists(dir, 'a.md')).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('refuses PAGE_CONFLICT on a stale expectedHash, and moves nothing', async () => {
      const { app, dir } = appWithPageWrites();
      try {
        const res = await request(app)
          .post('/api/pages/mainspec/move')
          .send({ from: 'a.md', to: 'b.md', expectedHash: 'a'.repeat(64) })
          .expect(409);
        expect(res.body.error.code).toBe('PAGE_CONFLICT');
        expect(res.body.currentHash).toBe(await hashOf(dir));
        expect(exists(dir, 'a.md')).toBe(true);
        expect(exists(dir, 'b.md')).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('requires expectedHash — a move never reads the file it relocates', async () => {
      /**
       * The guard is mandatory here for a sharper reason than on a write. Every
       * other write either produces the bytes or has just been handed them, so
       * an unguarded caller is at least holding a copy of SOMETHING. A move
       * opens nothing: without this the caller relocates a file it has never
       * seen, on the strength of a path it may have mistyped.
       */
      const { app, dir } = appWithPageWrites();
      try {
        const res = await request(app)
          .post('/api/pages/mainspec/move')
          .send({ from: 'a.md', to: 'b.md' })
          .expect(400);
        expect(res.body.error.code).toBe('INVALID_ARGUMENT');
        expect(res.body.error.message).toContain('expectedHash');
        expect(exists(dir, 'a.md')).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('refuses a destination that climbs out of the root — a move stays in one source', async () => {
      // A page's identity is `(rootId, path)`. A destination elsewhere is a write
      // in one store plus a delete in another: two mutexes, two chains, a
      // different failure surface. That is not this operation.
      const { app, dir } = appWithPageWrites();
      try {
        const res = await request(app)
          .post('/api/pages/mainspec/move')
          .send({ from: 'a.md', to: '../escaped.md', expectedHash: await hashOf(dir) })
          .expect(400);
        expect(res.body.error.code).toBe('INVALID_ARGUMENT');
        expect(exists(dir, 'a.md')).toBe(true);
        expect(fs.existsSync(path.join(dir, 'escaped.md'))).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('is not shadowed by the page splat — `move` reaches the verb, not a page called move', async () => {
      // The whole reason both paths are in the body. Registration order is what
      // keeps this true, so it is asserted rather than assumed.
      const { app, dir } = appWithPageWrites();
      try {
        await request(app)
          .post('/api/pages/mainspec/move')
          .send({ from: 'a.md', to: 'b.md', expectedHash: await hashOf(dir) })
          .expect(200);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('answers ROOT_NOT_FOUND with the roots that do exist', async () => {
      const { app, dir } = appWithPageWrites();
      try {
        const res = await request(app)
          .post('/api/pages/nope/move')
          .send({ from: 'a.md', to: 'b.md', expectedHash: 'a'.repeat(64) })
          .expect(404);
        expect(res.body.error.code).toBe('ROOT_NOT_FOUND');
        expect(res.body.error.hint).toContain('mainspec');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
