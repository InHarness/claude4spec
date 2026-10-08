import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../tests/helpers/fixture-module.js';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { createReferenceToolsServer, type ReferenceToolsDeps } from './reference-tools.js';
import { PagesService } from '../services/pages.js';
import type { ProjectPluginHost, BackendModule } from '../core/plugin-host/types.js';
import { createDiscoveryCore } from '../discovery/index.js';
import { RawEntityReader } from '../discovery/raw-entity-reader.js';
import { SerializationEngine } from '../core/plugin-host/serialization-engine.js';
import { builtinPagesRoot } from '../config.js';
import { createC4sReaderServer } from './c4s-reader.js';
import { GET_PAGE_OUTLINE_RETURN } from './tool-contract-text.js';
import { KIND_DECLARATIONS } from '../../shared/root-kinds.js';

/**
 * Rule 12 — broken-reference detection for a HIDDEN entity type.
 *
 * History worth keeping: this began (0-1-128-to-0-1-129) as a fix for
 * `<diagram/>`, a tag with no `type` attribute whose NAME was the type, which
 * `check_consistency` skipped entirely — neither flagging a broken reference nor
 * marking a referenced diagram as used. The fix was to fall back to the
 * registered extension's `entityType`.
 *
 * 0.2.15 removed the cause instead: there is no tag whose name is a type any
 * more, so the fallback went with it and `tag.attrs.type` is the sole source.
 * These cases stay, rewritten onto `<single_element type="diagram" …/>`, because
 * the property under test never was about the tag's spelling — it is that a
 * hidden type gets the same reference checking as a visible one.
 */

function diagramModule(): BackendModule {
  return {
    type: 'diagram',
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: 'Diagram',
    labelPlural: 'Diagrams',
    displayOrder: 70,
    pathPrefix: '/diagrams',
    systemPrompt: {
      roleNoun: 'Diagrams',
    },
  };
}

function fakeHost(): ProjectPluginHost {
  const modules = new Map<string, BackendModule>([['diagram', diagramModule()]]);
  return {
    listAvailable: () => Array.from(modules.values()),
    listEntities: () => Array.from(modules.values()),
    listSettings: () => [],
    listCommands: () => [],
    listSubagents: () => [],
    getEntity: (type) => modules.get(type) ?? null,
    getAvailable: (type) => modules.get(type) ?? null,
    isActive: (type) => modules.has(type),
    partition: () => ({ active: ['diagram'], inactive: [], unknown: [] }),
    shadowReport: () => [],
    mountBackend: () => {},
    registerMcpServer: () => {},
    buildMcpServers: () => [],
    entityExists: () => false,
    registerEntityService: () => {},
    getEntityService: () => null,
    snapshot: () => ({}) as never,
    restore: () => ({}) as never,
    diff: () => ({}) as never,
    clearMcpFactories: () => {},
  };
}

async function connectClient(deps: ReferenceToolsDeps): Promise<Client> {
  const { server } = createReferenceToolsServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

async function checkConsistency(client: Client, args: Record<string, unknown> = {}): Promise<any> {
  const res = await client.callTool({ name: 'check_consistency', arguments: args });
  expect(res.isError).toBeFalsy();
  const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
  return JSON.parse(text);
}

describe('check_consistency — rule 12 (hidden entity types)', () => {
  let cwd: string;
  let db: Database.Database;
  let pagesService: PagesService;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-reference-tools-test-'));
    db = createTestDb();
    pagesService = new PagesService(cwd, 'pages', 'pages');
    await pagesService.ensureRoot();
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  function deps(): ReferenceToolsDeps {
    const pluginHost = fakeHost();
    return {
      pluginHost,
      // M39: the read tools are adapters over the discovery core, so the test
      // builds a real one — the rules under test now live there.
      discovery: createDiscoveryCore({
        reader: new RawEntityReader(db, pluginHost),
        db,
        host: pluginHost,
        serialization: new SerializationEngine(pluginHost),
        roots: [builtinPagesRoot()],
        projectDir: cwd,
        packageVersion: 'test',
      }),
      tagsService: { getEntityTagSlugs: () => [], list: () => [] } as unknown as ReferenceToolsDeps['tagsService'],
      referencesService: {} as ReferenceToolsDeps['referencesService'],
      ws: { broadcast: () => {} } as unknown as ReferenceToolsDeps['ws'],
      entityStore: {} as ReferenceToolsDeps['entityStore'],
    };
  }

  it('flags a broken diagram reference (slug does not exist)', async () => {
    await pagesService.write('page.md', {
      body: '# Page\n\n<single_element type="diagram" slug="nonexistent" caption="x"/>\n',
    });
    const client = await connectClient(deps());

    const result = await checkConsistency(client);

    expect(result.brokenReferences).toContainEqual(
      expect.objectContaining({ type: 'diagram', slug: 'nonexistent', reason: 'missing' }),
    );
  });

  it('does not flag a valid diagram reference, and marks the diagram as referenced', async () => {
    db.prepare(`INSERT INTO diagram (slug, title, format, source) VALUES ('flow', 'flow', 'mermaid', 'graph TD; A-->B')`).run();
    await pagesService.write('page.md', {
      body: '# Page\n\n<single_element type="diagram" slug="flow" caption="x"/>\n',
    });
    const client = await connectClient(deps());

    const result = await checkConsistency(client);

    expect(result.brokenReferences).not.toContainEqual(
      expect.objectContaining({ type: 'diagram', slug: 'flow' }),
    );
    expect(result.unreferencedEntities).not.toContainEqual(
      expect.objectContaining({ type: 'diagram', slug: 'flow' }),
    );
  });

  /**
   * 0.2.15 — the priority defect of the M39 budget item.
   *
   * `limit` is a PER-BUCKET cap and `summary` counts the whole project BEFORE
   * any filter, so a cut report and a clean one looked identical unless the
   * caller thought to compare the counter against each array's length. Most did
   * not: a short report reads as a healthy project.
   */
  it('sets truncated when `limit` actually cut a bucket, and leaves it false when it did not', async () => {
    for (const slug of ['ghost-a', 'ghost-b', 'ghost-c']) {
      await pagesService.write(`${slug}.md`, {
        body: `# Page\n\n<single_element type="diagram" slug="${slug}" caption="x"/>\n`,
      });
    }
    const client = await connectClient(deps());

    const cut = await checkConsistency(client, { limit: 1 });
    expect(cut.brokenReferences).toHaveLength(1);
    expect(cut.truncated).toBe(true);
    // `summary` keeps counting the project, not the slice — which is exactly why
    // the flag has to exist rather than be inferred from it.
    expect(cut.summary.errors).toBeGreaterThanOrEqual(3);

    const whole = await checkConsistency(client);
    expect(whole.brokenReferences).toHaveLength(3);
    expect(whole.truncated).toBe(false);

    // A limit no bucket reaches is not a cut.
    const roomy = await checkConsistency(client, { limit: 50 });
    expect(roomy.truncated).toBe(false);
  });

  // 0.2.92 — the backtick in `caption` used to pair with a later prose backtick,
  // and everything in between — this tagged_list included — was read as code.
  it('[ac:m19-rule3-backtick-tagged-list] a tagged_list in a paragraph with backticks still marks its entities referenced', async () => {
    db.prepare(`INSERT INTO diagram (slug, title, format, source) VALUES ('flow', 'flow', 'mermaid', 'graph TD; A-->B')`).run();
    db.prepare(`INSERT INTO diagram (slug, title, format, source) VALUES ('keys', 'keys', 'mermaid', 'graph TD; A-->B')`).run();
    db.prepare(`INSERT INTO tag (slug, name) VALUES ('auth', 'Auth')`).run();
    db.prepare(`INSERT INTO entity_tag (entity_type, entity_slug, tag_slug) VALUES ('diagram', 'flow', 'auth')`).run();
    // `flow` is surfaced ONLY by the tagged_list, which stands between the
    // caption's lone backtick and the prose `auth` span.
    await pagesService.write('page.md', {
      body:
        '# Page\n\nSee <single_element type="diagram" slug="keys" caption="press ` then enter"/> and ' +
        '<tagged_list type="diagram" tags="auth"/> with the `auth` tag.\n',
    });
    const client = await connectClient(deps());

    const result = await checkConsistency(client);

    expect(result.unreferencedEntities).not.toContainEqual(
      expect.objectContaining({ type: 'diagram', slug: 'flow' }),
    );
    expect(result.unreferencedEntities).not.toContainEqual(
      expect.objectContaining({ type: 'diagram', slug: 'keys' }),
    );
  });

  it('[ac:m19-caption-backtick-pair-resolved] check_consistency sees a tag whose caption carries a backtick pair', async () => {
    await pagesService.write('page.md', {
      body: '# Page\n\n<single_element type="diagram" slug="ghost" caption="run `make` first"/>\n',
    });
    const client = await connectClient(deps());

    const result = await checkConsistency(client);

    expect(result.brokenReferences).toContainEqual(
      expect.objectContaining({ type: 'diagram', slug: 'ghost', reason: 'missing' }),
    );
  });

  it('an unreferenced diagram entity is reported as unreferenced', async () => {
    db.prepare(`INSERT INTO diagram (slug, title, format, source) VALUES ('orphan', 'orphan', 'mermaid', 'graph TD; A-->B')`).run();
    const client = await connectClient(deps());

    const result = await checkConsistency(client);

    expect(result.unreferencedEntities).toContainEqual(
      expect.objectContaining({ type: 'diagram', slug: 'orphan' }),
    );
  });

  /**
   * 0.2.3 — the read half of this server became the in-process transport over
   * the discovery core, which changed four tool contracts and added four tools.
   *
   * What each of these guards is a failure that only appears in an agent's
   * SESSION: a refusal with no way forward, an empty list that could mean either
   * "nothing here" or "you named something that does not exist", a truncated
   * page with no `hasMore` to admit it. None of them show up in a type.
   */
  describe('the core\'s contracts reach the tools', () => {
    async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
      const res = await client.callTool({ name, arguments: args });
      const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
      return { isError: res.isError === true, body: JSON.parse(text) as Record<string, any> };
    }

    /**
     * Index one section the way the indexer does — over the page body, 1-based.
     *
     * `body` is left empty on purpose: these cases are about the index rows
     * reaching the tools, and `get_sections` reads its content out of the file
     * (by anchor, through the section parser) regardless of what the column holds. Passing real text here would suggest
     * the tool reads it, which is exactly the question 0.2.46 leaves open.
     */
    function indexSection(anchor: string, page: string, heading: string, start: number, end: number): void {
      db.prepare(
        `INSERT INTO section_index
           (rootId, anchor, page_path, parent_anchor, heading_level, heading_text,
            content_hash, body, line_start, line_end, paragraph_count)
         VALUES ('pages', ?, ?, NULL, 1, ?, 'hash', '', ?, ?, 1)`,
      ).run(anchor, page, heading, start, end);
    }

    it('get_page_outline returns a tree and measures each section before it is fetched', async () => {
      await pagesService.write('page.md', { body: '<!-- anchor: aaaaaa11 -->\n# Alpha\n\nbody line\nanother line\n' });
      indexSection('aaaaaa11', 'page.md', 'Alpha', 1, 4);
      const client = await connectClient(deps());

      const { isError, body } = await call(client, 'get_page_outline', { rootId: 'pages', path: 'page.md' });

      expect(isError).toBe(false);
      expect(body).toMatchObject({ rootId: 'pages', path: 'page.md' });
      expect(body.hash).toEqual(expect.any(String));
      expect(body.sections).toHaveLength(1);
      expect(body.sections[0]).toMatchObject({ anchor: 'aaaaaa11', heading: 'Alpha', level: 1 });
      expect(body.sections[0].size).toBeGreaterThan(0);
      // A leaf omits `children`, and the envelope carries no paging shape at all.
      expect(body.sections[0]).not.toHaveProperty('children');
      for (const key of ['total', 'hasMore', 'limit', 'offset', 'is_known']) {
        expect(body).not.toHaveProperty(key);
      }
    });

    it('get_page_outline stays a skeleton — materializing content did not widen it', async () => {
      // 0.2.46 regression, carried forward. `section_index` stores each section's
      // body; what keeps the column out of the answer is the explicit projection in
      // `toRawSection`, so this checks KEYS — a value check would pass just as
      // happily against a row that carried an empty `body` through.
      await pagesService.write('page.md', { body: '<!-- anchor: aaaaaa11 -->\n# Alpha\n\nbody line\nanother line\n' });
      db.prepare(
        `INSERT INTO section_index
           (rootId, anchor, page_path, parent_anchor, heading_level, heading_text,
            content_hash, body, line_start, line_end, paragraph_count)
         VALUES ('pages', 'aaaaaa11', 'page.md', NULL, 1, 'Alpha', 'hash',
                 'BODY THAT MUST NOT BE LISTED', 1, 4, 1)`,
      ).run();
      const client = await connectClient(deps());

      const { isError, body } = await call(client, 'get_page_outline', { rootId: 'pages', path: 'page.md' });

      expect(isError).toBe(false);
      expect(Object.keys(body.sections[0])).toEqual(
        expect.not.arrayContaining(['body', 'content', 'contentSnippet', 'content_snippet']),
      );
      expect(JSON.stringify(body)).not.toContain('BODY THAT MUST NOT BE LISTED');
      // Still a measurement: the size is there, the content it measures is not.
      expect(body.sections[0].size).toBeGreaterThan(0);
    });

    it('get_page_outline without a path refuses instead of answering "no sections"', async () => {
      const client = await connectClient(deps());
      const { isError, body } = await call(client, 'get_page_outline', { rootId: 'pages', path: '' });
      expect(isError).toBe(true);
      expect(body.code).toBe('INVALID_ARGUMENT');
      expect(body.hint).toContain('path');
    });

    /**
     * 0.2.59 — the refusal is the WHOLE envelope, not an item.
     *
     * Its ancestor answered `is_known: false` for an anchor it did not know, and that
     * was the documented way to validate an anchor before citing it. This operation
     * is single-target, so it has no per-item slot to put a failure in and refuses
     * outright. Anchor validation moved to `check_consistency` (in bulk) and to
     * `get_sections` (per item).
     */
    it('get_page_outline refuses an unknown page rather than answering an empty tree', async () => {
      const client = await connectClient(deps());
      const { isError, body } = await call(client, 'get_page_outline', { rootId: 'pages', path: 'nope.md' });
      expect(isError).toBe(true);
      expect(body.code).toBe('PAGE_NOT_FOUND');
    });

    it('find_references without `target` refuses AND names the variants', async () => {
      const client = await connectClient(deps());
      const { isError, body } = await call(client, 'find_references', { type: 'diagram', slug: 'flow' });
      expect(isError).toBe(true);
      expect(body.code).toBe('INVALID_ARGUMENT');
      expect(body.hint).toContain('target');
    });

    /**
     * The old handler validated the type before sweeping. Routing to the core
     * dropped that, and the sweep matches types literally against page XML — so
     * `database_table` (snake, the exact trap the chat prompt warns about) came
     * back as a confident, successful "nothing references this", which is the
     * answer that authorizes a rename or a delete.
     */
    it('find_references on an unknown entity type refuses rather than reporting no consumers', async () => {
      const client = await connectClient(deps());
      const { isError, body } = await call(client, 'find_references', {
        target: 'entity',
        type: 'diagrams',
        slug: 'flow',
      });
      expect(isError).toBe(true);
      expect(body.code).toBe('INVALID_TYPE');
      expect(body.hint).toContain('diagram');
    });

    it('find_references on a target with no references is a SUCCESS with total 0', async () => {
      const client = await connectClient(deps());
      const { isError, body } = await call(client, 'find_references', {
        target: 'entity',
        type: 'diagram',
        slug: 'never-referenced',
      });
      expect(isError).toBe(false);
      expect(body).toMatchObject({ references: [], total: 0, hasMore: false });
    });

    /**
     * The path is compared as SPELLED in the link, so this covers the spellings
     * that are already root-relative. `@pages/target.md` — the form the chat
     * prompt teaches — and a `../` relative link are NOT matched, because the
     * operation compares the raw candidate rather than resolving it the way
     * `PagesLinkIndexerService` does. That gap is filed as a patch on the brief
     * rather than fixed here: it is the core's, not this transport's, and fixing
     * it changes which links the editor calls broken.
     */
    it('find_references target "page" answers who links a page, by its full key', async () => {
      await pagesService.write('target.md', { body: '# Target\n' });
      await pagesService.write('source.md', { body: '# Source\n\nsee @target.md and [again](target.md)\n' });
      const client = await connectClient(deps());

      const { isError, body } = await call(client, 'find_references', {
        target: 'page',
        rootId: 'pages',
        path: 'target.md',
      });

      expect(isError).toBe(false);
      expect(body.references).toContainEqual(
        expect.objectContaining({ rootId: 'pages', pagePath: 'source.md', tagType: 'page_link' }),
      );
      expect(body.total).toBeGreaterThan(0);
    });

    it('find_references target "page" without a path refuses with the shape of the key', async () => {
      const client = await connectClient(deps());
      const { isError, body } = await call(client, 'find_references', { target: 'page', rootId: 'pages' });
      expect(isError).toBe(true);
      expect(body.code).toBe('INVALID_ARGUMENT');
      expect(body.hint).toContain('rootId');
      expect(body.hint).toContain('path');
    });

    it('get_page without rootId refuses and lists the roots — no silent built-in default', async () => {
      await pagesService.write('page.md', { body: '<!-- anchor: aaaaaa11 -->\n# Alpha\n' });
      const client = await connectClient(deps());

      const { isError, body } = await call(client, 'get_page', { path: 'page.md' });

      expect(isError).toBe(true);
      expect(body.code).toBe('INVALID_ARGUMENT');
      expect(body.hint).toContain('pages');
    });

    it('get_page refuses a system root id exactly like an unknown one — only page roots are addressable', async () => {
      await pagesService.write('page.md', { body: '<!-- anchor: aaaaaa11 -->\n# Alpha\n\nbody\n' });
      const client = await connectClient(deps());

      const plans = await call(client, 'get_page', { rootId: 'plans', path: 'page.md' });
      const nope = await call(client, 'get_page', { rootId: 'nope', path: 'page.md' });

      expect(plans.isError).toBe(true);
      expect(plans.body.code).toBe('INVALID_ARGUMENT');
      expect(plans.body.code).toBe(nope.body.code);
      expect(plans.body.error).toContain("unknown rootId 'plans' (page roots in this project: pages)");
      expect(plans.body.hint).toBe(nope.body.hint);
    });

    it('get_page returns the page as sections keyed by anchor — an embed stays an embed in the body', async () => {
      await pagesService.write('page.md', {
        body: '<!-- anchor: aaaaaa11 -->\n# Alpha\n\n<single_element type="diagram" slug="flow" caption="x"/>\n',
      });
      const client = await connectClient(deps());

      const { isError, body } = await call(client, 'get_page', { rootId: 'pages', path: 'page.md' });

      expect(isError).toBe(false);
      expect(body).not.toHaveProperty('content');
      expect(body.results).toEqual([
        {
          anchor: 'aaaaaa11',
          heading_text: 'Alpha',
          heading_level: 1,
          body: '\n<single_element type="diagram" slug="flow" caption="x"/>\n',
        },
      ]);
      expect(body.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('get_page REFUSES a stale `range` — the SDK must not strip it before the core sees it', async () => {
      await pagesService.write('page.md', { body: '<!-- anchor: aaaaaa11 -->\n# Alpha\n\none\ntwo\n' });
      const client = await connectClient(deps());

      const { isError, body } = await call(client, 'get_page', {
        rootId: 'pages',
        path: 'page.md',
        range: { start: 1, end: 2 },
      });

      expect(isError).toBe(true);
      expect(body.code).toBe('INVALID_ARGUMENT');
      expect(body.error).toContain('no line window');
      expect(body.hint).toContain('get_page_outline');
    });

    it('get_sections returns each body with its tag intact, and no edges beside it', async () => {
      await pagesService.write('page.md', {
        body: '<!-- anchor: bbbbbb22 -->\n# Alpha\n\n<single_element type="diagram" slug="flow" caption="x"/>\n',
      });
      // The section is read off the file by its anchor; the row places it.
      indexSection('bbbbbb22', 'page.md', 'Alpha', 1, 4);
      const client = await connectClient(deps());

      const { isError, body } = await call(client, 'get_sections', { anchors: ['bbbbbb22'] });

      expect(isError).toBe(false);
      expect(body.results).toHaveLength(1);
      expect(body.results[0].body).toContain('<single_element type="diagram" slug="flow"');
      // 0.2.16 — the tag IS the edge, and it is right there in the body. A
      // parsed copy beside it would be the same fact twice, charged twice to
      // the response budget. Edges arrive only where the body does not.
      expect(body.results[0].truncated).toBeUndefined();
      expect(body.results[0].edges).toBeUndefined();
    });

    /**
     * The transport has to carry the per-item error THROUGH, not collapse the
     * call. `fail()` maps a thrown `DiscoveryError` onto `isError: true`, so a
     * batch that half-failed could easily have come back as a whole-call
     * failure — which is precisely the behaviour 0.2.5 removed.
     */
    it('get_sections reports an unknown anchor per item, not as a failed call', async () => {
      await pagesService.write('page.md', { body: '<!-- anchor: bbbbbb22 -->\n# Alpha\n\nbody\n' });
      indexSection('bbbbbb22', 'page.md', 'Alpha', 1, 4);
      const client = await connectClient(deps());

      const { isError, body } = await call(client, 'get_sections', {
        anchors: ['nosuchan', 'bbbbbb22'],
      });

      expect(isError).toBe(false);
      expect(body.results[0]).toMatchObject({ anchor: 'nosuchan', code: 'SECTION_NOT_FOUND' });
      expect(body.results[1].body).toContain('body');
    });

    it('search_pages finds prose the entity graph cannot: a bare path in running text', async () => {
      await pagesService.write('page.md', { body: '<!-- anchor: aaaaaa11 -->\n# Alpha\n\nthe handler lives at GET /v1/widgets\n' });
      const client = await connectClient(deps());

      const { isError, body } = await call(client, 'search_pages', { query: '/v1/widgets' });

      expect(isError).toBe(false);
      expect(body.total).toBeGreaterThan(0);
    });

    it('search_pages mode "count" answers the size without the rows', async () => {
      await pagesService.write('page.md', { body: '<!-- anchor: aaaaaa11 -->\n# Alpha\n\nwidget widget widget\n' });
      const client = await connectClient(deps());

      const { isError, body } = await call(client, 'search_pages', { query: 'widget', mode: 'count' });

      expect(isError).toBe(false);
      expect(body).toMatchObject({ mode: 'count' });
      expect(body.items).toBeUndefined();
    });

    it('list_pages lists one root, paginated, with a measurement per page', async () => {
      await pagesService.write('a.md', { body: '# A\n' });
      await pagesService.write('b.md', { body: '# B\n' });
      const client = await connectClient(deps());

      const { isError, body } = await call(client, 'list_pages', { rootId: 'pages' });

      expect(isError).toBe(false);
      expect(body.items.map((i: { path: string }) => i.path)).toEqual(['a.md', 'b.md']);
      expect(body.items[0].size).toBeGreaterThan(0);
      expect(body).toMatchObject({ total: 2, hasMore: false });
    });

    it('list_pages on an unknown root refuses with the roots that exist', async () => {
      const client = await connectClient(deps());
      const { isError, body } = await call(client, 'list_pages', { rootId: 'nope' });
      expect(isError).toBe(true);
      expect(body.hint).toContain('pages');
    });

    it('list_tags keeps counts OFF by default and returns them when asked', async () => {
      db.prepare(`INSERT INTO tag (slug, name) VALUES ('auth', 'Auth')`).run();
      const client = await connectClient(deps());

      const off = await call(client, 'list_tags', {});
      expect(off.isError).toBe(false);
      expect(off.body.items).toHaveLength(1);
      expect(off.body.items[0].counts).toBeUndefined();
      expect(off.body).toMatchObject({ total: 1, hasMore: false });

      const on = await call(client, 'list_tags', { withCounts: true });
      expect(on.body.items[0].counts).toBeDefined();
    });

    /**
     * 0.2.7 — counts are over the ACTIVE types, which they always claimed to be.
     *
     * The claim used to be self-enforcing for the wrong reason: a full rebuild
     * emptied `entity_tag` outright, so a deactivated type had no rows left to
     * miscount. Now that its assignments survive the rebuild, the predicate has
     * to be real — otherwise `list_tags` reports entities under a type whose
     * table the same rebuild just emptied, and disagrees with `GET /api/tags`
     * (which has always filtered) about the same project.
     */
    it('list_tags counts only the ACTIVE types, not every row in entity_tag', async () => {
      db.prepare(`INSERT INTO tag (slug, name) VALUES ('auth', 'Auth')`).run();
      const assign = db.prepare(
        `INSERT INTO entity_tag (entity_type, entity_slug, tag_slug) VALUES (?, ?, 'auth')`,
      );
      assign.run('diagram', 'd1'); // active in this host
      assign.run('endpoint', 'e1'); // NOT mounted here
      const client = await connectClient(deps());

      const { body } = await call(client, 'list_tags', { withCounts: true });
      expect(body.items[0].counts).toEqual({ diagram: 1 });

      // Same predicate on the co-occurrence join: a second tag sharing only the
      // inactive entity co-occurs zero times, so it drops out entirely.
      db.prepare(`INSERT INTO tag (slug, name) VALUES ('legacy', 'Legacy')`).run();
      db.prepare(
        `INSERT INTO entity_tag (entity_type, entity_slug, tag_slug) VALUES ('endpoint', 'e1', 'legacy')`,
      ).run();
      const co = await call(client, 'list_tags', { coOccurringWith: 'auth' });
      expect(co.body.items).toEqual([]);
    });
  });

  /**
   * 2.1.8 — the page tools as this server DECLARES them: name, parameter set and
   * the description sentences the window changed (only page roots are
   * addressable, each with a section index; `get_page` has no line window).
   */
  describe('the page tools as declared (2.1.8)', () => {
    type ListedTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];
    const params = (tool: ListedTool) => Object.keys(tool.inputSchema.properties ?? {}).sort();
    async function declared(name: string): Promise<ListedTool> {
      const { tools } = await (await connectClient(deps())).listTools();
      const tool = tools.find((t) => t.name === name);
      expect(tool, `tool ${name}`).toBeDefined();
      return tool!;
    }

    it('[entity:reference-tools-get-page-outline] get_page_outline takes the page key alone, both parts required', async () => {
      const tool = await declared('get_page_outline');
      expect(params(tool)).toEqual(['path', 'rootId']);
      expect(tool.inputSchema.required ?? []).toEqual(expect.arrayContaining(['rootId', 'path']));
      expect(tool.description).toContain('not a page root');
      expect(tool.description).not.toMatch(/by line range|without (a|one) section index/i);
    });

    it('[entity:reference-tools-get-page] get_page takes rootId and path — no range', async () => {
      const tool = await declared('get_page');
      expect(params(tool)).toEqual(['path', 'rootId']);
      expect(tool.description).not.toContain('`range`');
      expect(tool.description).toContain('There is no line window');
      expect(tool.description).toContain('a system root such as `plans` is refused like an unknown one');
    });

    it('[entity:reference-tools-get-sections] get_sections takes anchors and includeSubtree, with only the unknown-anchor item error', async () => {
      const tool = await declared('get_sections');
      expect(params(tool)).toEqual(['anchors', 'includeSubtree']);
      expect(tool.inputSchema.required ?? []).toContain('anchors');
      expect(tool.description).toContain('SECTION_NOT_FOUND');
      expect(tool.description).not.toMatch(/no section index|root without/i);
    });

    it('[entity:reference-tools-list-pages] list_pages takes rootId (required), prefix, sort and paging', async () => {
      const tool = await declared('list_pages');
      expect(params(tool)).toEqual(['limit', 'offset', 'prefix', 'rootId', 'sort']);
      expect(tool.inputSchema.required ?? []).toEqual(['rootId']);
      expect((tool.inputSchema.properties!.sort as { enum?: string[] }).enum).toEqual(['path', 'modified']);
      expect(tool.description).toContain('The root list holds page roots only');
    });

    it('[entity:reference-tools-search-pages] search_pages takes query|regex, the three valves, the mode ladder and paging', async () => {
      const tool = await declared('search_pages');
      expect(params(tool)).toEqual(
        ['anchors', 'context', 'limit', 'mode', 'offset', 'pathExclude', 'pathInclude', 'query', 'regex', 'rootId'].sort(),
      );
      expect(tool.inputSchema.required ?? []).toEqual([]);
      expect((tool.inputSchema.properties!.mode as { enum?: string[] }).enum).toEqual(['count', 'map', 'hits']);
      expect(tool.description).toContain('only when the match falls outside every section');
      expect(tool.description).not.toMatch(/root without (a|an) (section )?index/i);
    });

    /**
     * Both `mcp-tool` records rendering `get_page_outline` declare one return: the
     * envelope `hash`, `children` omitted on a leaf, and none of `heading_path`,
     * `content_hash`, `total`, `hasMore`, `limit`, `offset`. The parity is
     * structural — both servers paste one contract string — and is checked on the
     * two declarations side by side, without calling either tool.
     */
    it('[ac:ac-obie-encje-mcp-tool-renderujace-get-p] reference-tools and c4s-reader declare the same get_page_outline return', async () => {
      const reference = await declared('get_page_outline');
      const { server } = createC4sReaderServer({
        reader: null,
        discovery: null,
        db: null,
        projectDir: null,
        packageVersion: 'test',
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const readerClient = new Client({ name: 'test-client', version: '0.0.0' });
      await server.connect(serverTransport);
      await readerClient.connect(clientTransport);
      const reader = (await readerClient.listTools()).tools.find((t) => t.name === 'get_page_outline')!;

      // The same contract sentence, pasted by both.
      expect(reader.description).toContain(GET_PAGE_OUTLINE_RETURN);
      expect(reference.description).toContain(GET_PAGE_OUTLINE_RETURN);
      expect(params(reader)).toEqual(params(reference));

      // What that sentence declares: hash on the envelope, `children` omitted on a leaf…
      expect(GET_PAGE_OUTLINE_RETURN).toContain(
        'The response is `{ rootId, path, hash, frontmatter?, preamble?, sections[], truncated?, message? }`',
      );
      expect(GET_PAGE_OUTLINE_RETURN).toContain('`hash` is on the ENVELOPE, never on a node');
      expect(GET_PAGE_OUTLINE_RETURN).toContain('a leaf OMITS the key rather than sending `[]`');
      // …and none of the fields of a paginated listing or of a hashed node.
      expect(GET_PAGE_OUTLINE_RETURN).toContain('A node carries NO `content_hash`');
      expect(GET_PAGE_OUTLINE_RETURN).toContain('NO `heading_path`');
      expect(GET_PAGE_OUTLINE_RETURN).toContain('The envelope carries no `total`, `hasMore`, `limit` or `offset`');
      for (const tool of [reader, reference]) {
        for (const key of ['limit', 'offset']) expect(params(tool)).not.toContain(key);
      }
    });
  });

  /**
   * 2.1.9 — the two M19 tools as declared, and the address of a hit/row in a
   * root whose kind does not inject section anchors. Today every reference root
   * is of kind `pages`, which selects `m06-anchor-injection`; the anchorless case
   * is reached by taking that reaction off the kind for the duration of a case —
   * the gate reads the kind's choice, so that is exactly what it must follow.
   */
  describe('the M19 tools as declared (2.1.9)', () => {
    type ListedTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];
    const params = (tool: ListedTool) => Object.keys(tool.inputSchema.properties ?? {}).sort();
    async function declared(name: string): Promise<ListedTool> {
      const { tools } = await (await connectClient(deps())).listTools();
      const tool = tools.find((t) => t.name === name);
      expect(tool, `tool ${name}`).toBeDefined();
      return tool!;
    }
    async function call(name: string, args: Record<string, unknown> = {}) {
      const client = await connectClient(deps());
      const res = await client.callTool({ name, arguments: args });
      const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
      return { isError: res.isError === true, body: JSON.parse(text) as Record<string, any> };
    }
    function indexSection(anchor: string, page: string, heading: string, start: number, end: number): void {
      db.prepare(
        `INSERT INTO section_index
           (rootId, anchor, page_path, parent_anchor, heading_level, heading_text,
            content_hash, body, line_start, line_end, paragraph_count)
         VALUES ('pages', ?, ?, NULL, 1, ?, 'hash', '', ?, ?, 1)`,
      ).run(anchor, page, heading, start, end);
    }
    async function withoutAnchorInjection<T>(fn: () => Promise<T>): Promise<T> {
      const previous = KIND_DECLARATIONS.pages.reactions;
      KIND_DECLARATIONS.pages.reactions = previous.filter((r) => r !== 'm06-anchor-injection');
      try {
        return await fn();
      } finally {
        KIND_DECLARATIONS.pages.reactions = previous;
      }
    }

    it('[entity:reference-tools-find-references] find_references takes the target union and paging; a hit is { rootId, pagePath, anchor?, tagType, line } with total/hasMore, and loses only the anchor in a root without anchors', async () => {
      const tool = await declared('find_references');
      expect(tool.name).toBe('find_references');
      expect(params(tool)).toEqual(
        ['anchor', 'includeTagMatches', 'limit', 'offset', 'path', 'rootId', 'slug', 'target', 'type'].sort(),
      );
      expect((tool.inputSchema.properties!.target as { enum?: string[] }).enum).toEqual(['entity', 'section', 'page']);
      expect(tool.description).toContain('addressed by `rootId`, `pagePath` and `line`');

      await pagesService.write('page.md', {
        body: '<!-- anchor: aaaaaa11 -->\n# Alpha\n\n<single_element type="diagram" slug="d1"/>\n',
      });
      indexSection('aaaaaa11', 'page.md', 'Alpha', 1, 4);
      const args = { target: 'entity', type: 'diagram', slug: 'd1' };

      const anchored = await call('find_references', args);
      expect(anchored.isError).toBe(false);
      expect(anchored.body).toMatchObject({ total: 1, hasMore: false });
      expect(anchored.body.references).toEqual([
        expect.objectContaining({ rootId: 'pages', pagePath: 'page.md', anchor: 'aaaaaa11', tagType: 'single_element', line: 4 }),
      ]);

      // The same root, its kind no longer injecting anchors: same hit, same
      // line, no `anchor` key at all — the address is (rootId, pagePath, line).
      const bare = await withoutAnchorInjection(() => call('find_references', args));
      expect(bare.isError).toBe(false);
      expect(bare.body).toMatchObject({ total: 1, hasMore: false });
      const [hit] = bare.body.references as Array<Record<string, unknown>>;
      expect(hit).toMatchObject({ rootId: 'pages', pagePath: 'page.md', tagType: 'single_element', line: 4 });
      expect(hit).not.toHaveProperty('anchor');
    });

    it('[entity:reference-tools-check-consistency] check_consistency takes severity/rule/limit; a page-pointing row carries rootId and pagePath, summary the full counters', async () => {
      const tool = await declared('check_consistency');
      expect(tool.name).toBe('check_consistency');
      expect(params(tool)).toEqual(['limit', 'rule', 'severity']);
      expect((tool.inputSchema.properties!.severity as { enum?: string[] }).enum).toEqual(['error', 'warning']);
      expect(tool.description).toContain('carries the page key `rootId` + `pagePath`');

      await pagesService.write('page.md', {
        body: '# Page\n\n<single_element type="diagram" slug="gone"/>\n\n```\nnever closed\n',
      });
      const { isError, body } = await call('check_consistency', {});
      expect(isError).toBe(false);
      expect(body.summary).toEqual({ total: expect.any(Number), errors: expect.any(Number), warnings: expect.any(Number) });
      expect(body.brokenReferences).toEqual([
        expect.objectContaining({ rootId: 'pages', pagePath: 'page.md', tagType: 'single_element', slug: 'gone', reason: 'missing' }),
      ]);
      expect(body.unclosedCodeBlocks).toEqual([{ rootId: 'pages', pagePath: 'page.md', line: 5 }]);
      expect(body.unanchoredHeadings).toEqual([
        expect.objectContaining({ rootId: 'pages', pagePath: 'page.md', line: 1, heading: 'Page' }),
      ]);

      // In a root whose kind does not inject anchors the rows keep the same key
      // and carry no anchor; rule 7 (a finding only where anchors are minted) is silent.
      const bare = await withoutAnchorInjection(() => call('check_consistency', {}));
      expect(bare.isError).toBe(false);
      for (const row of bare.body.brokenReferences as Array<Record<string, unknown>>) {
        expect(row).toMatchObject({ rootId: 'pages', pagePath: 'page.md', line: expect.any(Number) });
        expect(row).not.toHaveProperty('anchor');
      }
      expect(bare.body.unanchoredHeadings).toEqual([]);
    });
  });
});
