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

  /**
   * 0.2.37 — the differential mode over the MCP adapter.
   *
   * The engine has its own tests and the core has its own; what only this
   * adapter can get wrong is whether it forwards the new fields at all. A tool
   * whose schema accepts `textEdits` and whose handler drops them looks like a
   * success and writes nothing.
   */
  describe('update_page — the differential mode', () => {
    async function seed(body: string) {
      const created = await call('create_page', { rootId: 'pages', path: 'a.md', content: body });
      return created.body.hash as string;
    }

    it('forwards textEdits and answers with the replacement count', async () => {
      const hash = await seed('# A\n\nalpha beta\n');
      const res = await call('update_page', {
        rootId: 'pages',
        path: 'a.md',
        textEdits: [{ find: 'alpha', replaceWith: 'ALPHA' }],
        expectedHash: hash,
      });
      expect(res.isError).toBe(false);
      expect(res.body.replacements).toBe(1);
      expect((await pages.read('a.md')).body).toContain('ALPHA beta');
    });

    it('keeps the refusal actionable — FIND_NOT_FOUND survives the envelope with its details', async () => {
      const hash = await seed('# A\n\n  alpha   beta\n');
      const res = await call('update_page', {
        rootId: 'pages',
        path: 'a.md',
        textEdits: [{ find: 'alpha beta', replaceWith: 'X' }],
        expectedHash: hash,
      });
      expect(res.isError).toBe(true);
      expect(res.body.code).toBe('FIND_NOT_FOUND');
      expect(res.body.details[0].matchesAfterWhitespaceNormalization).toBe(1);
    });

    it('refuses body and textEdits in the same call', async () => {
      const hash = await seed('# A\n\nalpha\n');
      const res = await call('update_page', {
        rootId: 'pages',
        path: 'a.md',
        body: '# A\n',
        textEdits: [{ find: 'alpha', replaceWith: 'X' }],
        expectedHash: hash,
      });
      expect(res.isError).toBe(true);
      expect(res.body.code).toBe('INVALID_ARGUMENT');
    });

    it('still accepts the literal mode it always had', async () => {
      const hash = await seed('# A\n\nalpha\n');
      const res = await call('update_page', { rootId: 'pages', path: 'a.md', body: '# A2', expectedHash: hash });
      expect(res.isError).toBe(false);
      expect(res.body.replacements).toBeUndefined();
    });
  });

  it('carries the four operations of the page write path, and nothing else', async () => {
    // A fifth tool here would be a capability the catalog has no row for, which
    // the profile gate would then wave through on the strength of this being a
    // host-owned server.
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'create_page',
      'delete_page',
      'update_page',
      'update_sections',
    ]);
  });

  it('stamps its writes as `agent` — the axis on which this channel differs from REST', async () => {
    const created = await call('create_page', { rootId: 'pages', path: 'a.md', content: '# A' });
    await call('update_page', { rootId: 'pages', path: 'a.md', body: '# A2', expectedHash: created.body.hash });
    await call('delete_page', { rootId: 'pages', path: 'a.md' });
    expect(origins).toEqual([
      { relPath: 'a.md', actor: 'agent' },
      { relPath: 'a.md', actor: 'agent' },
      { relPath: 'a.md', actor: 'agent' },
    ]);
  });

  it('an unknown root lists the ones that exist rather than answering "not found"', async () => {
    const res = await call('update_page', {
      rootId: 'typo',
      path: 'a.md',
      body: 'x',
      expectedHash: 'a'.repeat(64),
    });
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

  it('update_sections on an unindexed anchor is SECTION_NOT_FOUND, not a crash', async () => {
    const res = await call('update_sections', {
      expectedHash: 'a'.repeat(64),
      edits: [{ anchor: 'deadbeef', action: 'replace', content: 'x' }],
    });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('SECTION_NOT_FOUND');
    expect(res.body.hint).toContain('get_page_outline');
  });

  it('update_page without expectedHash is INVALID_ARGUMENT — the guard is not optional', async () => {
    /**
     * 0.2.15. The schema marks the field required, so a compliant client is
     * refused by the transport before the handler runs; this asserts the
     * OPERATION refuses it too, which is what covers the channels that do not
     * validate against a zod shape.
     */
    await call('create_page', { rootId: 'pages', path: 'guard.md', content: 'x' });
    const res = await call('update_page', { rootId: 'pages', path: 'guard.md', body: 'y', expectedHash: '' });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('INVALID_ARGUMENT');
    expect(await fs.readFile(path.join(pages.root, 'guard.md'), 'utf-8')).toBe('x');
  });
});
