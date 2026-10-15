import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CapturedMcpServer } from '../plugin-runtime/index.js';
import { createC4sReaderServer } from './c4s-reader.js';
import { GET_PAGE_OUTLINE_RETURN } from './tool-contract-text.js';
import { getPage } from '../discovery/ops/pages.js';
import { PageSource } from '../discovery/page-source.js';
import { RootSet } from '../discovery/roots.js';
import type { DiscoveryCore } from '../discovery/types.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type Database from 'better-sqlite3';
import type { Root } from '../../shared/types.js';
import { DiscoveryError } from '../discovery/errors.js';
import { expectToolMatchesRecord } from '../../../tests/helpers/read-tool-records.js';

/**
 * 2.1.8 — the contract of the `c4s-reader` page tools, as the tool list
 * declares it: name, parameter set, and the sentences of the description that
 * changed with the window (only page roots are addressable, every one of them
 * has a section index, `get_page` has no line window).
 *
 * The listing needs no project: a degraded start still lists every tool.
 */

type ListedTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];

async function listTools(captured: CapturedMcpServer): Promise<ListedTool[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await captured.server.connect(serverTransport);
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

function readerServer(): CapturedMcpServer {
  return createC4sReaderServer({ reader: null, discovery: null, db: null, projectDir: null, packageVersion: 'test' });
}

function params(tool: ListedTool): string[] {
  return Object.keys(tool.inputSchema.properties ?? {}).sort();
}

function find(tools: ListedTool[], name: string): ListedTool {
  const tool = tools.find((t) => t.name === name);
  expect(tool, `tool ${name}`).toBeDefined();
  return tool!;
}

describe('c4s-reader — the page tools as declared (2.1.8)', () => {
  let tools: ListedTool[];

  beforeEach(async () => {
    tools = await listTools(readerServer());
  });

  it('[entity:c4s-reader-overview] overview takes no parameters and lists page roots as { id, name, dir, builtin, pageCount }', () => {
    const tool = find(tools, 'overview');
    expect(params(tool)).toEqual([]);
    expect(tool.description).toContain('`{ id, name, dir, builtin, pageCount }`');
    expect(tool.description).toContain('only roots of kind `pages` are addressable');
    expect(tool.description).not.toMatch(/sectionIndexed|referenceValidated/);
  });

  it('[entity:c4s-reader-get-page-outline] get_page_outline takes the page key alone, both parts required', () => {
    const tool = find(tools, 'get_page_outline');
    expect(params(tool)).toEqual(['path', 'rootId']);
    expect(tool.inputSchema.required ?? []).toEqual(expect.arrayContaining(['rootId', 'path']));
    // The refusal is for a root that is unknown or not a page root — no
    // "root without a section index" case is advertised any more.
    expect(tool.description).toContain('not a page root');
    expect(tool.description).not.toMatch(/without (a|one) section index|section-indexed roots/i);
    expect(tool.description).toContain(GET_PAGE_OUTLINE_RETURN);
  });

  it('[entity:c4s-reader-get-sections] get_sections takes anchors and includeSubtree, and has only the unknown-anchor item error', () => {
    const tool = find(tools, 'get_sections');
    expect(params(tool)).toEqual(['anchors', 'includeSubtree']);
    expect(tool.inputSchema.required ?? []).toContain('anchors');
    expect(tool.description).toContain('SECTION_NOT_FOUND');
    expect(tool.description).toContain('in its own slot rather than failing the batch');
    expect(tool.description).not.toMatch(/no section index|root without/i);
  });

  it('[entity:c4s-reader-get-page] get_page takes rootId and path — no range', () => {
    const tool = find(tools, 'get_page');
    expect(params(tool)).toEqual(['path', 'rootId']);
    expect(params(tool)).not.toContain('range');
    expect(tool.description).not.toContain('`range`');
    expect(tool.description).toContain('There is no line window');
    expect(tool.description).toContain('does not name a page root');
  });

  it('[entity:c4s-reader-search-pages] search_pages takes query|regex, the three valves, the mode ladder and paging', () => {
    const tool = find(tools, 'search_pages');
    expect(params(tool)).toEqual(
      ['anchors', 'context', 'limit', 'mode', 'offset', 'pathExclude', 'pathInclude', 'query', 'regex', 'rootId'].sort(),
    );
    expect(tool.inputSchema.required ?? []).toEqual([]);
    expect((tool.inputSchema.properties!.mode as { enum?: string[] }).enum).toEqual(['count', 'map', 'hits']);
    // An anchorless hit means a match outside every section — never "a root without an index".
    expect(tool.description).toContain('a `kind: "page"` hit falls outside every section');
    expect(tool.description).not.toMatch(/root without (a|an) (section )?index/i);
  });
});

/**
 * 2.1.14 — the input of `get_page` is a LOOSE object: a key outside `rootId` and
 * `path` is not stripped by the SDK on the way in, so a stale `range` reaches the
 * core, which refuses it. The core here is the real page read over a real file;
 * only the parts `get_page` never touches (reader, db) are absent.
 */
describe('c4s-reader — get_page forwards a stale range to the core (2.1.14)', () => {
  let projectDir: string;
  let client: Client;

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-reader-get-page-'));
    fs.mkdirSync(path.join(projectDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'pages', 'a.md'), '<!-- anchor: aaaa0001 -->\n# A\n\none\ntwo\n');
    const root: Root = { id: 'pages', name: 'Pages', dir: 'pages', builtin: true };
    const pages = new PageSource(projectDir, [root]);
    const roots = new RootSet([root]);
    const discovery = {
      getPage: (input: Parameters<DiscoveryCore['getPage']>[0]) => getPage(pages, roots, input),
    } as unknown as DiscoveryCore;
    const captured = createC4sReaderServer({
      reader: {} as RawEntityReader,
      discovery,
      db: {} as Database.Database,
      projectDir,
      packageVersion: 'test',
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await captured.server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  async function call(args: Record<string, unknown>) {
    const res = await client.callTool({ name: 'get_page', arguments: args });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
    return { isError: res.isError === true, body: JSON.parse(text) as Record<string, any> };
  }

  it('[entity:c4s-reader-get-page] [ac:ac-get-page-wywolane-z-parametrem-range] get_page with `range` ends in INVALID_ARGUMENT, not in the whole page', async () => {
    // Without `range` the same call answers with the page…
    const plain = await call({ rootId: 'pages', path: 'a.md' });
    expect(plain.isError).toBe(false);
    expect(plain.body.results).toHaveLength(1);
    expect(plain.body.hash).toMatch(/^[0-9a-f]{64}$/);

    // …with it — in the old object form or as a CLI-style string — it is refused.
    for (const range of [{ start: 1, end: 2 }, '1:20']) {
      const { isError, body } = await call({ rootId: 'pages', path: 'a.md', range });
      expect(isError).toBe(true);
      expect(body.code).toBe('INVALID_ARGUMENT');
      expect(body).not.toHaveProperty('results');
      expect(body).not.toHaveProperty('hash');
    }
  });

  it('[entity:c4s-reader-get-page] [ac:ac-message-odmowy-get-page-z-parametrem] the refusal message points to get_page_outline, then to get_sections', async () => {
    const { isError, body } = await call({ rootId: 'pages', path: 'a.md', range: { start: 1, end: 2 } });
    expect(isError).toBe(true);
    const message = String(body.error);
    expect(message).toContain('no line window');
    expect(message.indexOf('get_page_outline')).toBeGreaterThan(-1);
    expect(message.indexOf('get_sections')).toBeGreaterThan(message.indexOf('get_page_outline'));
    // The hint names the same two calls, on this very page, in the same order.
    expect(body.hint).toContain('get_page_outline({ rootId: "pages", path: "a.md" })');
    expect(String(body.hint).indexOf('get_sections')).toBeGreaterThan(String(body.hint).indexOf('get_page_outline'));
  });

  it('[entity:c4s-reader-get-page] a call without rootId is refused with the list of page roots, never resolved to a default root', async () => {
    const { isError, body } = await call({ path: 'a.md' });
    expect(isError).toBe(true);
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(body.hint).toContain('pages');
  });
});

/**
 * 2.1.26 — `c4s-reader · get_field_content` (record
 * `c4s-reader-get-field-content`): the external read server's own tool for the
 * generic core operation `get_field_content`, its `mcp` rendering. The adapter
 * passes the core's result (`DiscoveryCore.getFieldContent`) through unchanged.
 */
describe('[entity:c4s-reader-get-field-content] c4s-reader — get_field_content', () => {
  it('[entity:c4s-reader-get-field-content] is listed with the record\'s description and three required params, and declares no hints', async () => {
    const tool = find(await listTools(readerServer()), 'get_field_content');
    expect(tool.description).toBe(
      'The content of ONE content-bearing field of one entity, addressed by (type, slug, field). A content-bearing field is carried by NO generic read — get_entities answers with `has<Field>`, `<field>Bytes` and this operation\'s name — so this is the only way to read one. `describe_types` lists each type\'s `contentFields` with the operation that issues them. A field that is not content-bearing is INVALID_ARGUMENT with the covered fields attached; an unknown slug is ENTITY_NOT_FOUND.',
    );
    expect(params(tool)).toEqual(['field', 'slug', 'type']);
    expect([...(tool.inputSchema.required ?? [])].sort()).toEqual(['field', 'slug', 'type']);
    const props = tool.inputSchema.properties as Record<string, { type?: string; description?: string }>;
    expect(props.type).toMatchObject({ type: 'string', description: 'Entity type' });
    expect(props.slug).toMatchObject({ type: 'string', description: 'Entity slug' });
    expect(props.field).toMatchObject({ type: 'string', description: 'A content-bearing field of that type' });
    // All four hints of the record are empty: nothing is declared.
    const hints = (tool.annotations ?? {}) as Record<string, unknown>;
    for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
      expect(hints[hint], hint).toBeUndefined();
    }
  });

  it('[entity:c4s-reader-get-field-content] passes the core\'s { type, slug, field, content, bytes } through unchanged', async () => {
    const seen: unknown[] = [];
    const answer = { type: 'diagram', slug: 'flow', field: 'source', content: 'flowchart TD; A-->B', bytes: 19 };
    const discovery = {
      getFieldContent: (input: unknown) => {
        seen.push(input);
        return answer;
      },
    } as unknown as DiscoveryCore;
    const captured = createC4sReaderServer({
      reader: {} as RawEntityReader,
      discovery,
      db: {} as Database.Database,
      projectDir: '/tmp/unused',
      packageVersion: 'test',
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await captured.server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const res = await client.callTool({
        name: 'get_field_content',
        arguments: { type: 'diagram', slug: 'flow', field: 'source' },
      });
      expect(res.isError).toBeFalsy();
      const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
      expect(JSON.parse(text)).toEqual(answer);
      expect(seen).toEqual([{ type: 'diagram', slug: 'flow', field: 'source' }]);
    } finally {
      await client.close();
    }
  });
});

/**
 * 2.1.26 — the `c4s-reader` read tools as their re-rendered `mcp-tool` records
 * declare them (M39 renderings in the `mcp` channel). Each tool: the record's
 * name, description, parameters and (empty) hints; and the adapter behaviour its
 * `logic` states — without a loaded project `PROJECT_NOT_FOUND`; the core's result
 * passed through unchanged; a core error re-framed with its code, message and
 * hint; any other exception `INTERNAL`.
 */
describe('c4s-reader — the read tools as their 2.1.26 records declare them', () => {
  type Core = Partial<Record<keyof DiscoveryCore, (input: unknown) => unknown>>;

  function serverWith(discovery: Core | null): CapturedMcpServer {
    return createC4sReaderServer({
      reader: discovery ? ({} as RawEntityReader) : null,
      discovery: discovery as DiscoveryCore | null,
      db: discovery ? ({} as Database.Database) : null,
      projectDir: discovery ? '/tmp/unused' : null,
      packageVersion: 'test',
    });
  }

  const declaredTool = (name: string) => serverWith(null).tools.find((t) => t.name === name);

  async function invoke(discovery: Core | null, name: string, args: Record<string, unknown>) {
    const tool = serverWith(discovery).tools.find((t) => t.name === name)!;
    const res = (await tool.handler(args, {})) as { content: Array<{ text: string }>; isError?: boolean };
    return { isError: res.isError === true, body: JSON.parse(res.content[0]!.text) as Record<string, unknown> };
  }

  /** What every one of these tools' `logic` states about the adapter, checked on one tool. */
  async function expectPassThroughAdapter(
    name: string,
    method: keyof DiscoveryCore,
    args: Record<string, unknown>,
    forwarded: unknown,
  ): Promise<void> {
    const none = await invoke(null, name, args);
    expect(none.isError).toBe(true);
    expect(none.body.code).toBe('PROJECT_NOT_FOUND');

    const seen: unknown[] = [];
    const answer = { from: 'core', nested: { rows: [{ a: 1 }, { b: 2 }] } };
    const ok = await invoke({ [method]: (input: unknown) => (seen.push(input), answer) }, name, args);
    expect(ok.isError).toBe(false);
    expect(ok.body).toEqual(answer);
    expect(seen).toEqual([forwarded]);

    const refusal = new DiscoveryError('INVALID_ARGUMENT', 'refused by the core', 'the call that would have worked');
    const refused = await invoke({ [method]: () => { throw refusal; } }, name, args);
    expect(refused.isError).toBe(true);
    expect(refused.body).toEqual({ error: 'refused by the core', code: 'INVALID_ARGUMENT', hint: 'the call that would have worked' });

    const crashed = await invoke({ [method]: () => { throw new Error('boom'); } }, name, args);
    expect(crashed.isError).toBe(true);
    expect(crashed.body).toMatchObject({ code: 'INTERNAL', error: 'boom' });
  }

  it('[entity:c4s-reader-overview] overview: the record\'s contract; DiscoveryCore.overview passed through, PROJECT_NOT_FOUND without a project, core errors re-framed, others INTERNAL', async () => {
    expectToolMatchesRecord(declaredTool('overview'), 'c4s-reader-overview');
    await expectPassThroughAdapter('overview', 'overview', {}, undefined);
  });

  it('[entity:c4s-reader-describe-types] describe_types: the record\'s contract; `types` forwarded (omitted = every active type), the core answer unchanged', async () => {
    expectToolMatchesRecord(declaredTool('describe_types'), 'c4s-reader-describe-types');
    await expectPassThroughAdapter('describe_types', 'describeTypes', { types: ['dto', 'endpoint'] }, { types: ['dto', 'endpoint'] });
    const seen: unknown[] = [];
    await invoke({ describeTypes: (i) => (seen.push(i), { types: [] }) }, 'describe_types', {});
    expect(seen).toEqual([{ types: undefined }]);
  });

  it('[entity:c4s-reader-list-pages] list_pages: the record\'s contract (rootId required, integer paging); rootId, prefix, sort and the window forwarded to DiscoveryCore.listPages', async () => {
    expectToolMatchesRecord(declaredTool('list_pages'), 'c4s-reader-list-pages');
    const args = { rootId: 'pages', prefix: 'modules/', sort: 'modified', limit: 10, offset: 5 };
    await expectPassThroughAdapter('list_pages', 'listPages', args, args);
  });

  it('[entity:c4s-reader-get-page-outline] get_page_outline: the record\'s contract; the page key forwarded to DiscoveryCore.getPageOutline, the tree unchanged', async () => {
    expectToolMatchesRecord(declaredTool('get_page_outline'), 'c4s-reader-get-page-outline');
    const args = { rootId: 'pages', path: 'modules/m39.md' };
    await expectPassThroughAdapter('get_page_outline', 'getPageOutline', args, args);
  });

  it('[entity:c4s-reader-get-sections] get_sections: the record\'s contract; anchors forwarded, `includeSubtree` true only when it is true', async () => {
    expectToolMatchesRecord(declaredTool('get_sections'), 'c4s-reader-get-sections');
    await expectPassThroughAdapter(
      'get_sections',
      'getSections',
      { anchors: ['aaaa0001', 'bbbb0002'] },
      { anchors: ['aaaa0001', 'bbbb0002'], includeSubtree: false },
    );
    const seen: unknown[] = [];
    const core: Core = { getSections: (i) => (seen.push(i), { results: [] }) };
    await invoke(core, 'get_sections', { anchors: ['aaaa0001'], includeSubtree: true });
    await invoke(core, 'get_sections', { anchors: ['aaaa0001'], includeSubtree: 'true' });
    expect(seen).toEqual([
      { anchors: ['aaaa0001'], includeSubtree: true },
      { anchors: ['aaaa0001'], includeSubtree: false },
    ]);
  });

  it('[entity:c4s-reader-get-page] get_page: the record\'s contract (no line window); the page key forwarded to DiscoveryCore.getPage, the envelope unchanged', async () => {
    expectToolMatchesRecord(declaredTool('get_page'), 'c4s-reader-get-page');
    const args = { rootId: 'pages', path: 'a.md' };
    await expectPassThroughAdapter('get_page', 'getPage', args, args);
  });

  it('[entity:c4s-reader-list-entities] list_entities: the record\'s contract (type, tags, tagFilter, sort, dir, mode, integer paging); all forwarded to DiscoveryCore.listEntities', async () => {
    expectToolMatchesRecord(declaredTool('list_entities'), 'c4s-reader-list-entities');
    const args = { type: 'dto', tags: ['m39'], tagFilter: 'or', sort: 'title', dir: 'desc', mode: 'count', limit: 5, offset: 0 };
    await expectPassThroughAdapter('list_entities', 'listEntities', args, args);
  });

  it('[entity:c4s-reader-get-entities] get_entities: the record\'s contract; type, slugs and select forwarded, the core answer (truncated/message included) unchanged', async () => {
    expectToolMatchesRecord(declaredTool('get_entities'), 'c4s-reader-get-entities');
    const args = { type: 'dto', slugs: ['dto-field', 'dto-unknown'], select: ['name'] };
    await expectPassThroughAdapter('get_entities', 'getEntities', args, args);
  });

  it('[entity:c4s-reader-list-tags] list_tags: the record\'s contract; `withCounts` true only when it is true, minCount, coOccurringWith and the window forwarded', async () => {
    expectToolMatchesRecord(declaredTool('list_tags'), 'c4s-reader-list-tags');
    const args = { withCounts: true, minCount: 2, coOccurringWith: 'm39', limit: 10, offset: 0 };
    await expectPassThroughAdapter('list_tags', 'listTags', args, args);
    const seen: unknown[] = [];
    await invoke({ listTags: (i) => (seen.push(i), { items: [] }) }, 'list_tags', { withCounts: 'yes' });
    expect(seen).toEqual([{ withCounts: false }]);
  });

  it('[entity:c4s-reader-find-references] find_references: the record\'s contract (target optional in the schema); the target union forwarded, a missing target left for the core to refuse', async () => {
    expectToolMatchesRecord(declaredTool('find_references'), 'c4s-reader-find-references');
    await expectPassThroughAdapter(
      'find_references',
      'findReferences',
      { target: 'entity', type: 'dto', slug: 'user-dto', includeTagMatches: true, limit: 10, offset: 0 },
      { target: 'entity', type: 'dto', slug: 'user-dto', includeTagMatches: true, limit: 10, offset: 0 },
    );
    const seen: unknown[] = [];
    await invoke({ findReferences: (i) => (seen.push(i), { references: [], total: 0, hasMore: false }) }, 'find_references', {});
    expect(seen).toEqual([{ target: undefined, includeTagMatches: false }]);
  });

  it('[entity:c4s-reader-check-consistency] check_consistency: the record\'s contract (severity enum, rule string | number, integer limit); filters forwarded to DiscoveryCore.checkConsistency', async () => {
    expectToolMatchesRecord(declaredTool('check_consistency'), 'c4s-reader-check-consistency');
    const args = { severity: 'error', rule: 8, limit: 3 };
    await expectPassThroughAdapter('check_consistency', 'checkConsistency', args, args);
  });

  it('[entity:c4s-reader-resolve-identity] resolve_identity: the record\'s contract; query, types and limit forwarded, the scored candidates unchanged', async () => {
    expectToolMatchesRecord(declaredTool('resolve_identity'), 'c4s-reader-resolve-identity');
    const args = { query: 'user', types: ['dto', 'endpoint'], limit: 3 };
    await expectPassThroughAdapter('resolve_identity', 'resolveIdentity', args, args);
  });

  it('[entity:c4s-reader-search-entities] search_entities: the record\'s contract (type required, integer paging, no filters); type, the one given input, fields, mode and the window forwarded to DiscoveryCore.searchEntities, the result unchanged', async () => {
    const declared = declaredTool('search_entities');
    expectToolMatchesRecord(declared, 'c4s-reader-search-entities');
    expect(Object.keys(declared!.inputSchema as object)).not.toContain('filters');
    const args = { type: 'ac', regex: 'kaucj\\w*', fields: ['description'], mode: 'hits', limit: 5, offset: 10 };
    await expectPassThroughAdapter('search_entities', 'searchEntities', args, args);
    // Only the input that was GIVEN reaches the core, so its exactly-one-of check sees one.
    const seen: Array<Record<string, unknown>> = [];
    await invoke({ searchEntities: (i) => (seen.push(i as Record<string, unknown>), { mode: 'map', items: [] }) }, 'search_entities', { type: 'ac', query: 'kaucja' });
    expect(Object.keys(seen[0]!).filter((k) => seen[0]![k] !== undefined).sort()).toEqual(['query', 'type']);
    expect('regex' in seen[0]!).toBe(false);
  });

  it('[entity:c4s-reader-search-pages] search_pages: the record\'s contract (the shared description, three valves, integer context and paging); every input forwarded to DiscoveryCore.searchPages, the result unchanged', async () => {
    expectToolMatchesRecord(declaredTool('search_pages'), 'c4s-reader-search-pages');
    const args = {
      regex: '/v1/widgets',
      rootId: 'pages',
      mode: 'hits',
      pathInclude: '^modules/',
      pathExclude: 'drift',
      anchors: ['aaaa0001'],
      context: 2,
      limit: 20,
      offset: 0,
    };
    await expectPassThroughAdapter('search_pages', 'searchPages', args, args);
  });
});
