import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { createPageToolsServer } from './page-tools.js';
import { PagesService } from '../services/pages.js';
import { SectionsService } from '../services/sections.js';
import type { SelfWriteMarker, WriteActor } from '../fs/sources.js';

/**
 * 0.2.13 item 28 — `page-tools`, the write path that had to exist before the
 * built-in one could be closed.
 *
 * The tools are adapters over `services/page-write.ts`, which has its own tests;
 * what is asserted here is what only the ADAPTER can get wrong — the actor it
 * stamps, the recovery information it keeps in the error envelope, and the fact
 * that four operations and no more are on this server.
 */

function recordingWriter(calls: Array<{ relPath: string; actor: WriteActor }>): SelfWriteMarker {
  return {
    markOrigin: (relPath, actor) => calls.push({ relPath, actor }),
    flush: async () => {},
    suppress: () => {},
  };
}

describe('page-tools', () => {
  let cwd: string;
  let db: Database.Database;
  let pages: PagesService;
  let client: Client;
  let origins: Array<{ relPath: string; actor: WriteActor }>;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-page-tools-'));
    db = createTestDb();
    pages = new PagesService(cwd, 'pages', 'pages');
    await pages.ensureRoot();
    origins = [];
    const target = { pages, writer: recordingWriter(origins) };
    const { server } = createPageToolsServer({
      sections: new SectionsService(db),
      resolveRoot: (rootId) => (rootId === 'pages' ? target : undefined),
      rootIds: () => ['pages', 'guides'],
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  async function call(name: string, args: Record<string, unknown>) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
    return { isError: res.isError === true, body: JSON.parse(text) as Record<string, any> };
  }

  it('carries the four operations of the page write path, and nothing else', async () => {
    // A fifth tool here would be a capability the catalog has no row for, which
    // the profile gate would then wave through on the strength of this being a
    // host-owned server.
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'create_page',
      'delete_page',
      'update_page',
      'update_section',
    ]);
  });

  it('stamps its writes as `agent` — the axis on which this channel differs from REST', async () => {
    await call('create_page', { rootId: 'pages', path: 'a.md', content: '# A' });
    await call('update_page', { rootId: 'pages', path: 'a.md', body: '# A2' });
    await call('delete_page', { rootId: 'pages', path: 'a.md' });
    expect(origins).toEqual([
      { relPath: 'a.md', actor: 'agent' },
      { relPath: 'a.md', actor: 'agent' },
      { relPath: 'a.md', actor: 'agent' },
    ]);
  });

  it('an unknown root lists the ones that exist rather than answering "not found"', async () => {
    const res = await call('update_page', { rootId: 'typo', path: 'a.md', body: 'x' });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('ROOT_NOT_FOUND');
    expect(res.body.hint).toContain('pages');
    expect(res.body.hint).toContain('guides');
  });

  it('a conflict keeps `currentHash` in the envelope — without it the refusal is a dead end', async () => {
    /**
     * The remedy for PAGE_CONFLICT is "re-read, re-apply, pass this hash back".
     * A generic `err.message` mapping drops the hash and leaves the agent with a
     * refusal it cannot act on, which is the failure mode the catalog's error
     * contract exists to prevent.
     */
    const created = await call('create_page', { rootId: 'pages', path: 'c.md', content: 'one' });
    await fs.writeFile(path.join(pages.root, 'c.md'), 'moved underneath', 'utf-8');
    const res = await call('update_page', {
      rootId: 'pages',
      path: 'c.md',
      body: 'two',
      expectedHash: created.body.hash,
    });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('PAGE_CONFLICT');
    expect(res.body.currentHash).toHaveLength(64);
    expect(res.body.currentHash).not.toBe(created.body.hash);
  });

  it('create_page refuses an existing page and says which call would have worked', async () => {
    await call('create_page', { rootId: 'pages', path: 'dup.md', content: 'original' });
    const res = await call('create_page', { rootId: 'pages', path: 'dup.md', content: 'clobber' });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('PAGE_EXISTS');
    expect(res.body.hint).toContain('update_page');
    expect(await fs.readFile(path.join(pages.root, 'dup.md'), 'utf-8')).toBe('original');
  });

  it('update_section on an unindexed anchor is SECTION_NOT_FOUND, not a crash', async () => {
    const res = await call('update_section', { anchor: 'deadbeef', content: 'x' });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('SECTION_NOT_FOUND');
    expect(res.body.hint).toContain('list_sections');
  });
});
