import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CapturedMcpServer } from '../plugin-runtime/index.js';
import { createC4sReaderServer } from './c4s-reader.js';
import { GET_PAGE_OUTLINE_RETURN } from './tool-contract-text.js';

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
    expect(tool.description).toContain('search_pages / get_page_outline');
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
    expect(tool.description).toContain('only when the match falls outside every section');
    expect(tool.description).not.toMatch(/root without (a|an) (section )?index/i);
  });
});
