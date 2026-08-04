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
import { clearExtensionReferenceTypes, registerExtensionReferenceType } from '../../shared/reference-extensions.js';
import type { ProjectPluginHost, BackendModule } from '../core/plugin-host/types.js';
import { createDiscoveryCore } from '../discovery/index.js';
import { RawEntityReader } from '../discovery/raw-entity-reader.js';
import { SerializationEngine } from '../core/plugin-host/serialization-engine.js';
import { sectionSerializer } from '../serialization/serializers/section.js';
import { builtinPagesRoot } from '../config.js';

/**
 * Regression for the rule-12 generalization (brief 0-1-128-to-0-1-129): a
 * `<diagram/>` tag has no `type` attribute (the tag name IS the type), so
 * before this change `check_consistency` silently skipped it entirely —
 * neither flagging a broken reference nor marking a referenced diagram as
 * used. Widening the main loop's `tagType` resolution to fall back to the
 * registered extension's `entityType` fixes both.
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
    serializer: {} as BackendModule['serializer'],
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
    getEntity: (type) => modules.get(type) ?? null,
    getAvailable: (type) => modules.get(type) ?? null,
    isActive: (type) => modules.has(type),
    partition: () => ({ active: ['diagram'], inactive: [], unknown: [] }),
    shadowReport: () => [],
    mountBackend: () => {},
    registerMcpServer: () => {},
    buildMcpServers: () => [],
    computeEntityCounts: () => ({}),
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

async function checkConsistency(client: Client): Promise<any> {
  const res = await client.callTool({ name: 'check_consistency', arguments: {} });
  expect(res.isError).toBeFalsy();
  const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
  return JSON.parse(text);
}

describe('check_consistency — rule 12 (extension tags with entityType)', () => {
  let cwd: string;
  let db: Database.Database;
  let pagesService: PagesService;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-reference-tools-test-'));
    db = createTestDb();
    pagesService = new PagesService(cwd, 'pages', 'pages');
    await pagesService.ensureRoot();
    clearExtensionReferenceTypes();
    registerExtensionReferenceType({ tag: 'diagram', attrOrder: ['slug', 'caption'], entityType: 'diagram' });
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
    clearExtensionReferenceTypes();
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
        serialization: new SerializationEngine(pluginHost, sectionSerializer),
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

  it('flags a broken <diagram/> reference (slug does not exist)', async () => {
    await pagesService.write('page.md', { body: '# Page\n\n<diagram slug="nonexistent" caption="x"/>\n' });
    const client = await connectClient(deps());

    const result = await checkConsistency(client);

    expect(result.brokenReferences).toContainEqual(
      expect.objectContaining({ type: 'diagram', slug: 'nonexistent', category: 'broken-reference' }),
    );
  });

  it('does not flag a valid <diagram/> reference, and marks the diagram as referenced', async () => {
    db.prepare(`INSERT INTO diagram (slug, format, source) VALUES ('flow', 'mermaid', 'graph TD; A-->B')`).run();
    await pagesService.write('page.md', { body: '# Page\n\n<diagram slug="flow" caption="x"/>\n' });
    const client = await connectClient(deps());

    const result = await checkConsistency(client);

    expect(result.brokenReferences).not.toContainEqual(
      expect.objectContaining({ type: 'diagram', slug: 'flow' }),
    );
    expect(result.unreferencedEntities).not.toContainEqual(
      expect.objectContaining({ type: 'diagram', slug: 'flow' }),
    );
  });

  it('an unreferenced diagram entity is reported as unreferenced', async () => {
    db.prepare(`INSERT INTO diagram (slug, format, source) VALUES ('orphan', 'mermaid', 'graph TD; A-->B')`).run();
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

    /** Index one section the way the indexer does — over the page body, 1-based. */
    function indexSection(anchor: string, page: string, heading: string, start: number, end: number): void {
      db.prepare(
        `INSERT INTO section_index
           (rootId, anchor, page_path, heading_path, heading_slug, heading_level, heading_text,
            content_hash, line_start, line_end, paragraph_count)
         VALUES ('pages', ?, ?, ?, ?, 1, ?, 'hash', ?, ?, 1)`,
      ).run(anchor, page, heading, heading.toLowerCase(), heading, start, end);
    }

    it('list_sections without `by` refuses AND names both variants', async () => {
      const client = await connectClient(deps());
      const { isError, body } = await call(client, 'list_sections', {});
      expect(isError).toBe(true);
      expect(body.code).toBe('INVALID_ARGUMENT');
      // A refusal that does not say what WOULD work sends the agent back to
      // guessing — which is what the fuzzy `query` mode used to absorb.
      expect(body.hint).toContain('by: "page"');
      expect(body.hint).toContain('by: "anchor"');
    });

    it('list_sections by page measures each section before it is fetched', async () => {
      await pagesService.write('page.md', { body: '# Alpha\n\nbody line\nanother line\n' });
      indexSection('aaaaaa11', 'page.md', 'Alpha', 1, 4);
      const client = await connectClient(deps());

      const { isError, body } = await call(client, 'list_sections', { by: 'page', rootId: 'pages', path: 'page.md' });

      expect(isError).toBe(false);
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({ rootId: 'pages', anchor: 'aaaaaa11', heading: 'Alpha' });
      expect(body.items[0].size).toBeGreaterThan(0);
      expect(body).toMatchObject({ total: 1, hasMore: false });
    });

    it('list_sections by page without a path refuses instead of answering "no sections"', async () => {
      const client = await connectClient(deps());
      const { isError, body } = await call(client, 'list_sections', { by: 'page', rootId: 'pages' });
      expect(isError).toBe(true);
      expect(body.code).toBe('INVALID_ARGUMENT');
      expect(body.hint).toContain('path');
    });

    it('list_sections by an unknown anchor reports is_known: false, not just an empty list', async () => {
      const client = await connectClient(deps());
      const { isError, body } = await call(client, 'list_sections', { by: 'anchor', anchor: 'zzzzzz99' });
      expect(isError).toBe(false);
      expect(body.items).toEqual([]);
      expect(body.is_known).toBe(false);
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
      await pagesService.write('page.md', { body: '# Alpha\n' });
      const client = await connectClient(deps());

      const { isError, body } = await call(client, 'get_page', { path: 'page.md' });

      expect(isError).toBe(true);
      expect(body.code).toBe('INVALID_ARGUMENT');
      expect(body.hint).toContain('pages');
    });

    it('get_page refuses a line range on a section-indexed root and points at the better window', async () => {
      await pagesService.write('page.md', { body: '# Alpha\n\nbody\n' });
      const client = await connectClient(deps());

      const { isError, body } = await call(client, 'get_page', {
        rootId: 'pages',
        path: 'page.md',
        range: { start: 1, end: 2 },
      });

      expect(isError).toBe(true);
      expect(body.code).toBe('INVALID_ARGUMENT');
      expect(body.hint).toContain('list_sections');
      expect(body.hint).toContain('get_sections');
    });

    it('get_page returns the page AS AUTHORED — an embed stays an embed', async () => {
      await pagesService.write('page.md', { body: '# Alpha\n\n<diagram slug="flow" caption="x"/>\n' });
      const client = await connectClient(deps());

      const { isError, body } = await call(client, 'get_page', { rootId: 'pages', path: 'page.md' });

      expect(isError).toBe(false);
      expect(body.content).toContain('<diagram slug="flow" caption="x"/>');
    });

    it('get_sections returns each body with its tag intact AND that tag as a parsed edge', async () => {
      await pagesService.write('page.md', {
        body: '# Alpha\n\n<diagram slug="flow" caption="x"/>\n',
      });
      // The heading is line 1 of the body; the section runs to the end.
      indexSection('bbbbbb22', 'page.md', 'Alpha', 1, 4);
      const client = await connectClient(deps());

      const { isError, body } = await call(client, 'get_sections', { anchors: ['bbbbbb22'] });

      expect(isError).toBe(false);
      expect(body.results).toHaveLength(1);
      expect(body.results[0].body).toContain('<diagram slug="flow"');
      expect(body.results[0].edges).toBeDefined();
    });

    /**
     * The transport has to carry the per-item error THROUGH, not collapse the
     * call. `fail()` maps a thrown `DiscoveryError` onto `isError: true`, so a
     * batch that half-failed could easily have come back as a whole-call
     * failure — which is precisely the behaviour 0.2.5 removed.
     */
    it('get_sections reports an unknown anchor per item, not as a failed call', async () => {
      await pagesService.write('page.md', { body: '# Alpha\n\nbody\n' });
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
      await pagesService.write('page.md', { body: '# Alpha\n\nthe handler lives at GET /v1/widgets\n' });
      const client = await connectClient(deps());

      const { isError, body } = await call(client, 'search_pages', { query: '/v1/widgets' });

      expect(isError).toBe(false);
      expect(body.total).toBeGreaterThan(0);
    });

    it('search_pages mode "count" answers the size without the rows', async () => {
      await pagesService.write('page.md', { body: '# Alpha\n\nwidget widget widget\n' });
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
});
