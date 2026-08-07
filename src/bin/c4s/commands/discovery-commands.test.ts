/**
 * The discovery commands, as TRANSPORTS.
 *
 * ## Why this test changed shape in 0.2.13
 *
 * It used to build a real db slot, insert rows, and assert what came back —
 * because the commands opened that slot themselves. Item 22 took the slot away:
 * a command now resolves an address, health-checks it, calls the operation's
 * route, and prints what it was handed. So there is nothing left here that the
 * core's own tests do not already own, and everything left that a wire contract
 * owns.
 *
 * What is asserted, against a real HTTP server on an ephemeral port:
 *
 *   1. WHICH request. Method, path and query string — the mapping from flags to
 *      the operation's route. This is the only place that mapping exists, and
 *      the only way to catch a parameter that is parsed and then dropped.
 *   2. That the payload is printed AS RECEIVED. The CLI does not serialize,
 *      re-shape or re-order; where it does project (the tag commands' buckets,
 *      `list-slugs`), the projection is asserted.
 *   3. That the CLI's OWN guards still refuse before a request is made — a flag
 *      the command does not accept must not reach the server at all.
 *
 * Guards that used to be asserted here and are not any more — `--range` on a
 * section-indexed root, an empty `--anchors`, an unknown `--root-id` — belong to
 * the core, which raises them with the repair path attached. They are asserted
 * in `src/server/discovery/discovery.test.ts`; asserting them again through a
 * stub would only prove the stub.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../args.js';
import { WorkspaceRegistry } from '../../../server/workspace/registry.js';
import { __resetDelegateTargets } from '../delegate.js';
import { runGetPage } from './get-page.js';
import { runGetSections } from './get-sections.js';
import { runListPages } from './list-pages.js';
import { runListSections } from './list-sections.js';
import { runSearchPages } from './search-pages.js';
import { runSearchEntities } from './search-entities.js';
import { runResolveIdentity } from './resolve-identity.js';
import { runCheckConsistency } from './check-consistency.js';
import { runListEntities } from './list-entities.js';
import { runGetEntities } from './get-entities.js';
import { runListSlugs } from './list-slugs.js';
import { runFindReferences } from './find-references.js';
import { runTaggedList } from './tagged-list.js';
import { runCatalog } from './catalog.js';
import { runDescribe } from './describe.js';
import { runListTags } from './list-tags.js';
import { runInlineMention } from './inline-mention.js';
import { runElementList } from './element-list.js';

/** The shape `healthCheck` demands of `GET /api/projects/:id/config`. */
const CONFIG = {
  name: 'test-project',
  roots: [{ id: 'pages', dir: 'pages' }],
  entitiesDir: 'entities',
  writingStyle: null,
  onboarding: {},
};

describe('discovery commands on the CLI', () => {
  let registryDir: string;
  let projectDir: string;
  let prevHome: string | undefined;
  let stdout: string;
  let server: http.Server;
  let seen: Array<{ method: string; url: string }>;
  /** What the next non-config request answers with. */
  let reply: unknown;

  beforeEach(async () => {
    registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-disc-cmd-registry-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-disc-cmd-project-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = registryDir;

    seen = [];
    reply = { ok: true };
    server = http.createServer((req, res) => {
      const url = req.url ?? '';
      if (url.endsWith('/config')) {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify(CONFIG));
      }
      seen.push({ method: req.method ?? 'GET', url });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(reply));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    // The registry is how the CLI finds the address: `defaultPort` is the only
    // thing it reads to know where to call.
    const registry = new WorkspaceRegistry(registryDir);
    const ws = registry.selectOrCreate({ name: 'default', port });
    registry.registerProject(ws, projectDir);
    __resetDelegateTargets();

    stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    __resetDelegateTargets();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(registryDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  const identity = () => ['--project', path.basename(projectDir), '--workspace', 'default'];
  const args = (...argv: string[]) => parseArgs([...argv, ...identity()]);
  const printed = () => JSON.parse(stdout) as Record<string, unknown>;
  /** The path+query of the one operation request, with the project prefix stripped. */
  const called = () => {
    expect(seen).toHaveLength(1);
    return seen[0]!.url.replace(/^\/api\/projects\/[^/]+/, '');
  };

  describe('each command calls its operation, and prints what came back', () => {
    it('[ac:ac-komendy-discovery-c4s-catalog-c4s] catalog → overview; describe → types; list-tags → the CORE tag projection', async () => {
      reply = { types: {}, roots: [], tagCount: 0, claude4spec: '0.0.0' };
      await runCatalog(args('catalog'));
      expect(called()).toBe('/_meta/overview');
      expect(printed()).toEqual(reply);

      seen = [];
      stdout = '';
      reply = { types: [{ type: 'ac' }] };
      await runDescribe(args('describe', '--type', 'ac', '--view', 'detail'));
      expect(called()).toBe('/_meta/types?type=ac&view=detail');

      seen = [];
      stdout = '';
      reply = { items: [], total: 0, hasMore: false };
      await runListTags(args('list-tags', '--with-counts', '--min-count', '2'));
      // `/tags/list`, NOT `/tags` — the UI's route answers a different shape and
      // orders differently, and serving both from one path would break it.
      expect(called()).toBe('/tags/list?withCounts=true&minCount=2');
    });

    it('the entity operations carry every flag they accept', async () => {
      reply = { items: [], total: 0, hasMore: false };
      await runListEntities(
        args('list-entities', '--type', 'ac', '--tags', 'a,b', '--filter', 'and', '--view', 'detail', '--mode', 'items', '--limit', '5', '--offset', '10'),
      );
      expect(called()).toBe('/entities/ac/list?tags=a%2Cb&filter=and&view=detail&mode=items&limit=5&offset=10');

      seen = [];
      stdout = '';
      reply = { type: 'ac', view: 'detail', results: [] };
      await runGetEntities(args('get-entities', '--type', 'ac', '--slugs', 'beta,alpha', '--view', 'detail'));
      // Input ORDER is preserved on the wire — the core answers in the order the
      // caller named, and a transport that sorted would lose that.
      expect(called()).toBe('/entities/ac/get?slugs=beta%2Calpha&view=detail');

      seen = [];
      stdout = '';
      reply = { searchedFields: ['title'], items: [], total: 0, hasMore: false };
      await runSearchEntities(
        args('search-entities', '--type', 'ac', '--query', 'x', '--fields', 'title,body', '--mode', 'count'),
      );
      // `fields` and `mode` are on the wire: the route took neither before this
      // release, so `--mode count` would have paid for a full listing.
      expect(called()).toBe('/entities/ac/search?q=x&fields=title%2Cbody&mode=count');
      expect(printed().searchedFields).toEqual(['title']);
    });

    it('the page and section operations address their own routes', async () => {
      reply = { items: [], total: 0, hasMore: false };
      await runListPages(args('list-pages', '--root-id', 'pages', '--prefix', 'g/', '--sort', 'modified'));
      expect(called()).toBe('/pages/pages/list?prefix=g%2F&sort=modified');

      seen = [];
      stdout = '';
      reply = { content: '# Top' };
      await runGetPage(args('get-page', '--root-id', 'pages', '--path', 'budget.md'));
      // The path is a QUERY parameter: it contains slashes, and no page name can
      // shadow the operation's route.
      expect(called()).toBe('/pages/pages/get?path=budget.md');

      seen = [];
      stdout = '';
      reply = { items: [], total: 0, hasMore: false };
      await runSearchPages(args('search-pages', '--query', 'budget', '--root-id', 'pages', '--mode', 'pages'));
      // CROSS-ROOT: no root segment, `--root-id` only narrows.
      expect(called()).toBe('/pages/search?q=budget&rootId=pages&mode=pages');

      seen = [];
      stdout = '';
      reply = { items: [], total: 0, hasMore: false, is_known: true };
      await runListSections(args('list-sections', '--by', 'anchor', '--anchor', 'aaaaaa11'));
      expect(called()).toBe('/sections/list?by=anchor&anchor=aaaaaa11');

      seen = [];
      stdout = '';
      reply = { results: [{ anchor: 'aaaaaa11', body: 'text' }] };
      await runGetSections(args('get-sections', '--anchors', 'aaaaaa11,bbbbbb22', '--include-subtree'));
      expect(called()).toBe('/sections/get?anchors=aaaaaa11%2Cbbbbbb22&includeSubtree=true');
      expect(printed().results).toEqual(reply.results);
    });

    it('resolve-identity carries --types, which the route used to drop', async () => {
      reply = { candidates: [] };
      await runResolveIdentity(args('resolve-identity', '--query', 'alph', '--types', 'ac,dto', '--limit', '3'));
      expect(called()).toBe('/_meta/identities?q=alph&types=ac%2Cdto&limit=3');
    });

    it('check-consistency prints the report as received, envelope and all', async () => {
      reply = { summary: { total: 2 }, findings: [{ rule: 1 }] };
      await runCheckConsistency(args('check-consistency', '--severity', 'error', '--limit', '1'));
      expect(called()).toBe('/_meta/consistency?severity=error&limit=1');
      expect(printed()).toEqual(reply);
      // A report, not a collection: nothing here invents a pagination envelope.
      expect(printed()).not.toHaveProperty('hasMore');
    });

    it('an unknown anchor still errors inside its own item, and the call succeeds', async () => {
      // The batch is the reason the operation exists; one bad anchor must not
      // make the CLI throw away the good rows.
      reply = {
        results: [
          { anchor: 'aaaaaa11', body: 'text' },
          { anchor: 'zzzzzz99', code: 'SECTION_NOT_FOUND' },
        ],
      };
      await expect(
        runGetSections(args('get-sections', '--anchors', 'aaaaaa11,zzzzzz99')),
      ).resolves.toBeUndefined();
      expect((printed().results as unknown[])).toHaveLength(2);
    });
  });

  describe('the aliases and the projections', () => {
    it('inline_mention is get_entities with a fixed view, unwrapped to the one row', async () => {
      reply = { type: 'ac', view: 'inline_mention', results: [{ slug: 'a', entity: { title: 'A' } }] };
      await runInlineMention(args('inline_mention', '--type', 'ac', '--slug', 'a'));
      expect(called()).toBe('/entities/ac/get?slugs=a&view=inline_mention');
      expect(printed()).toEqual({ title: 'A' });
    });

    it('a missing entity becomes ENTITY_NOT_FOUND — the null row the list operation reports', async () => {
      reply = { type: 'ac', view: 'inline_mention', results: [{ slug: 'a', entity: null }] };
      await expect(runInlineMention(args('inline_mention', '--type', 'ac', '--slug', 'a'))).rejects.toMatchObject({
        code: 'ENTITY_NOT_FOUND',
      });
    });

    it('list-slugs sweeps and projects down to the slugs', async () => {
      reply = { items: [{ slug: 'a', data: {} }, { slug: 'b', data: {} }], total: 2, hasMore: false };
      await runListSlugs(args('list-slugs', '--type', 'ac'));
      expect(called()).toBe('/entities/ac/list?view=inline_mention&offset=0');
      expect(printed()).toEqual({ type: 'ac', slugs: ['a', 'b'], hasMore: false });
    });
  });

  /**
   * `element_list` is the TAG RENDERER, and it promised two things the raw
   * `get_entities` operation deliberately does not. Both were provided by the
   * deleted `getEntitiesAll`, both were lost when the command started calling
   * the route directly, and neither is visible in the response's shape — which
   * is why they are asserted against the requests that were made.
   */
  describe('element_list keeps what the raw operation does not promise', () => {
    const replyFor = (slugs: string[], truncate: string[] = []) => ({
      type: 'ac',
      view: 'element_list_item',
      results: slugs.map((slug) =>
        truncate.includes(slug)
          ? { slug, entity: null, truncated: true }
          : { slug, entity: { slug } },
      ),
    });

    const serveByRequest = (fn: (slugs: string[]) => unknown): void => {
      server.removeAllListeners('request');
      server.on('request', (req, res) => {
        const url = req.url ?? '';
        res.setHeader('content-type', 'application/json');
        if (url.endsWith('/config')) return res.end(JSON.stringify(CONFIG));
        seen.push({ method: req.method ?? 'GET', url });
        const raw = new URL(url, 'http://x').searchParams.get('slugs') ?? '';
        res.end(JSON.stringify(fn(raw.split(',').filter(Boolean))));
      });
    };

    it('chunks a list past the 50-slug cap instead of being refused', async () => {
      // `get_entities` throws INVALID_ARGUMENT past 50 — right for the raw
      // operation, wrong for a tag naming 51 acceptance criteria, which is an
      // ordinary page. The whole list must come back, in input order.
      const slugs = Array.from({ length: 51 }, (_, i) => `ac-${i}`);
      serveByRequest((chunk) => replyFor(chunk));
      await runElementList(args('element_list', '--type', 'ac', '--slugs', slugs.join(',')));
      expect(seen).toHaveLength(2);
      expect(new URL(seen[0]!.url, 'http://x').searchParams.get('slugs')!.split(',')).toHaveLength(50);
      expect(new URL(seen[1]!.url, 'http://x').searchParams.get('slugs')).toBe('ac-50');
      expect((printed().items as Array<{ slug: string }>).map((i) => i.slug)).toEqual(slugs);
      expect(printed().missing).toEqual([]);
    });

    it('re-fetches a budget-degraded row instead of reporting it as a missing slug', async () => {
      /**
       * Past its response budget the operation demotes a row to
       * `{ entity: null, truncated: true }` rather than dropping it. A renderer
       * that does not know the flag reads that as "no such entity" and shows an
       * EXISTING entity under `missing` — which a page author then acts on. The
       * retry is single-slug, because a single-slug call cannot come back
       * degraded, which is what makes it terminate.
       */
      let firstCall = true;
      serveByRequest((chunk) => {
        if (firstCall) {
          firstCall = false;
          return replyFor(chunk, ['b']);
        }
        return replyFor(chunk);
      });
      await runElementList(args('element_list', '--type', 'ac', '--slugs', 'a,b,c'));
      expect(seen).toHaveLength(2);
      expect(new URL(seen[1]!.url, 'http://x').searchParams.get('slugs')).toBe('b');
      expect((printed().items as Array<{ slug: string }>).map((i) => i.slug)).toEqual(['a', 'b', 'c']);
      expect(printed().missing).toEqual([]);
    });

    it('a genuinely absent slug is still reported as missing', async () => {
      // The retry must not turn "no such entity" into a row: a null WITHOUT
      // `truncated` is the real answer, and it is what `missing` is for.
      serveByRequest((chunk) => ({
        type: 'ac',
        view: 'element_list_item',
        results: chunk.map((slug) => ({ slug, entity: slug === 'gone' ? null : { slug } })),
      }));
      await runElementList(args('element_list', '--type', 'ac', '--slugs', 'a,gone'));
      expect(seen).toHaveLength(1);
      expect(printed().missing).toEqual(['gone']);
    });
  });

  /**
   * The sweeps are the one place the transport carries a LOOP, so the loop is
   * what gets asserted: it must not stop at the first page, and it must not spin
   * on a server that reports `hasMore` while returning nothing.
   */
  describe('the exhaustive sweeps page to the end', () => {
    it('tagged_list follows hasMore across pages and returns every row', async () => {
      const pages = [
        { items: [{ slug: 'a', data: 1 }], total: 3, hasMore: true },
        { items: [{ slug: 'b', data: 2 }], total: 3, hasMore: true },
        { items: [{ slug: 'c', data: 3 }], total: 3, hasMore: false },
      ];
      let n = 0;
      server.removeAllListeners('request');
      server.on('request', (req, res) => {
        const url = req.url ?? '';
        res.setHeader('content-type', 'application/json');
        if (url.endsWith('/config')) return res.end(JSON.stringify(CONFIG));
        seen.push({ method: req.method ?? 'GET', url });
        res.end(JSON.stringify(pages[Math.min(n++, pages.length - 1)]));
      });

      await runTaggedList(args('tagged_list', '--type', 'ac', '--tags', 'x'));
      expect(seen).toHaveLength(3);
      // The offset advances by what was actually returned, not by a page size
      // the transport assumed.
      expect(seen.map((s) => s.url.replace(/^.*\?/, ''))).toEqual([
        'tags=x&filter=or&view=tagged_list_item&offset=0',
        'tags=x&filter=or&view=tagged_list_item&offset=1',
        'tags=x&filter=or&view=tagged_list_item&offset=2',
      ]);
      expect(printed().items).toEqual([1, 2, 3]);
      // A sweep that ran to the end says so.
      expect(printed().hasMore).toBe(false);
    });

    it('a sweep the guard cuts short is reported as incomplete, not printed as the answer', async () => {
      /**
       * `delegateGetAll` documents `exhausted: false` as "the caller must report
       * this, not swallow it" — and `tagged_list`/`tagged_list_mixed`/`list-slugs`
       * all swallowed it. A tag list cut at the runaway guard and presented as
       * complete is what authorizes a rename or a delete against a set that was
       * never fully seen. Simulated here with a server that never stops saying
       * `hasMore`.
       */
      server.removeAllListeners('request');
      server.on('request', (req, res) => {
        const url = req.url ?? '';
        res.setHeader('content-type', 'application/json');
        if (url.endsWith('/config')) return res.end(JSON.stringify(CONFIG));
        seen.push({ method: req.method ?? 'GET', url });
        res.end(JSON.stringify({ items: [{ slug: 'x', data: 1 }], total: 99999, hasMore: true }));
      });
      await runTaggedList(args('tagged_list', '--type', 'ac', '--tags', 'x'));
      expect(printed().hasMore).toBe(true);
      expect(seen.length).toBeGreaterThan(1);
    });

    it('a page that claims hasMore while returning nothing ends the sweep instead of spinning', async () => {
      reply = { items: [], total: 99, hasMore: true };
      await runTaggedList(args('tagged_list', '--type', 'ac', '--tags', 'x'));
      expect(seen).toHaveLength(1);
      expect(printed().items).toEqual([]);
    });

    it('find-references reports a sweep that did NOT finish rather than claiming completeness', async () => {
      // `hasMore: true` forever with rows: the guard stops it, and the command
      // must say so. A command that answered `hasMore: false` here would be the
      // wrong answer that reads like a right one.
      reply = { references: [{ rootId: 'pages', pagePath: 'a.md' }], total: 1, hasMore: true };
      await runFindReferences(args('find-references', '--type', 'ac', '--slug', 'x'));
      expect(printed().hasMore).toBe(true);
      expect(seen.length).toBeGreaterThan(1);
    });

    it('[ac:m11-find-references-command] find-references carries --include-tag-matches and --pages onto the wire', async () => {
      reply = { references: [], total: 0, hasMore: false };
      await runFindReferences(
        args('find-references', '--type', 'ac', '--slug', 'x', '--include-tag-matches', '--pages', 'docs/guides'),
      );
      expect(called()).toBe('/references?type=ac&slug=x&includeTagMatches=true&pages=docs%2Fguides&offset=0');
    });
  });

  describe('the guards the transport owns — refused before any request', () => {
    it('page commands require --root-id and do not fall back to the built-in root', async () => {
      await expect(runListPages(args('list-pages'))).rejects.toMatchObject({ code: 'INVALID_ARGS' });
      await expect(runGetPage(args('get-page', '--path', 'budget.md'))).rejects.toMatchObject({
        code: 'INVALID_ARGS',
      });
      await expect(
        runListSections(args('list-sections', '--by', 'page', '--path', 'budget.md')),
      ).rejects.toMatchObject({ code: 'INVALID_ARGS' });
      expect(seen).toEqual([]);
    });

    /**
     * Ignoring the flag would be worse than refusing it: the caller would
     * believe the answer had been scoped to that root when it never was.
     */
    it('section commands refuse --root-id outright — an anchor is globally unique', async () => {
      await expect(
        runGetSections(args('get-sections', '--anchors', 'aaaaaa11', '--root-id', 'pages')),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(
        runListSections(args('list-sections', '--by', 'anchor', '--anchor', 'aaaaaa11', '--root-id', 'pages')),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect(seen).toEqual([]);
    });

    it('list-sections requires the --by discriminator, and there is no query mode', async () => {
      await expect(runListSections(args('list-sections', '--anchor', 'aaaaaa11'))).rejects.toMatchObject({
        code: 'INVALID_ARGS',
      });
      await expect(runListSections(args('list-sections', '--by', 'query', '--query', 'x'))).rejects.toMatchObject({
        code: 'INVALID_ARGS',
      });
    });

    it('search-pages takes --query XOR --regex', async () => {
      await expect(
        runSearchPages(args('search-pages', '--query', 'budget', '--regex', 'bud.*')),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(runSearchPages(args('search-pages'))).rejects.toMatchObject({ code: 'INVALID_ARGS' });
      expect(seen).toEqual([]);
    });

    it('search-entities requires --type: it is the one command that is not cross-type', async () => {
      await expect(runSearchEntities(args('search-entities', '--query', 'x'))).rejects.toMatchObject({
        code: 'INVALID_ARGS',
      });
    });

    /**
     * A flag that does nothing is worse than a flag that is refused: the caller
     * believes the answer was scoped, and every script built on that belief is
     * wrong wherever it runs. Same reasoning as the `--root-id` refusals above.
     */
    it('commands that do not paginate REFUSE --limit/--offset rather than ignoring them', async () => {
      await expect(
        runGetSections(args('get-sections', '--anchors', 'aaaaaa11', '--limit', '1')),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(
        runGetEntities(args('get-entities', '--type', 'ac', '--slugs', 'a,b', '--offset', '1')),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(runCheckConsistency(args('check-consistency', '--offset', '5'))).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      await expect(
        runResolveIdentity(args('resolve-identity', '--query', 'x', '--offset', '5')),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(
        runFindReferences(args('find-references', '--type', 'ac', '--slug', 'x', '--limit', '5')),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect(seen).toEqual([]);
    });
  });

  /**
   * Item 24 and the exit-code remap, at the level the CLI owns them: a command
   * that cannot reach a server says so with the code that maps to exit 8, and it
   * says it BEFORE trying the operation.
   */
  describe('no server', () => {
    it('[ac:ac-przed-tura-runagent-wykonuje-health-ch] answers SERVER_NOT_RUNNING from the health-check, not from the operation', async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      __resetDelegateTargets();
      await expect(runCatalog(args('catalog'))).rejects.toMatchObject({
        code: 'SERVER_NOT_RUNNING',
        hint: expect.stringContaining('npx @inharness-ai/claude4spec'),
      });
      // Nothing was attempted against the operation's route.
      expect(seen).toEqual([]);
      // Reopened so the shared afterEach close is a no-op rather than a hang.
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    });
  });
});
