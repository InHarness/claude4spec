import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FileWatchRuntime, type WatchScope } from '../fs/watcher.js';
import { RecordStore } from '../fs/record-store.js';
import { markdownAdapter, type MarkdownRecord } from '../fs/record-adapters.js';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { createPageToolsServer } from './page-tools.js';
import { CATALOG } from '../operations/catalog.js';
import { registerCoreOperations } from '../operations/core-operations.js';
import { PagesService } from '../services/pages.js';
import { SectionsService } from '../services/sections.js';
import type { SelfWriteMarker, WriteActor } from '../fs/sources.js';
import type { McpToolDeclaration } from '../../shared/plugin-host/mcp.js';
import { expectToolMatchesWriteRecord } from '../../../tests/helpers/write-tool-records.js';
import { SectionIndexerService } from '../services/section-indexer.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

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

/** One scope for this rig — the primitive keys its re-entrancy check on it. */
const RIG_SCOPE: WatchScope = 'context:page-tools-rig';

/** Calls a declared tool's handler directly — past the transport's schema check, onto the operation's own. */
async function invoke(tools: readonly McpToolDeclaration[], name: string, args: Record<string, unknown>) {
  const res = (await tools.find((t) => t.name === name)!.handler(args, {})) as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  return { isError: res.isError === true, body: JSON.parse(res.content[0]!.text) as Record<string, any> };
}

/** The plugin host the section indexer asks about embedded entities — this rig has none. */
const NO_ENTITIES = {
  listEntities: () => [],
  listAvailable: () => [],
  getEntity: () => null,
  getAvailable: () => null,
  isActive: () => false,
  entityExists: () => false,
  getEntityService: () => null,
} as unknown as ProjectPluginHost;

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf-8').digest('hex');

describe('page-tools', () => {
  let cwd: string;
  let db: Database.Database;
  let pages: PagesService;
  let client: Client;
  let origins: Array<{ relPath: string; actor: WriteActor }>;
  let runtime: FileWatchRuntime;
  /** The tools as the server declared them — raw zod shapes, annotations, handlers. */
  let declared: readonly McpToolDeclaration[];
  let target: { pages: PagesService; writer: SelfWriteMarker };

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-page-tools-'));
    db = createTestDb();
    pages = new PagesService(cwd, 'pages', 'pages');
    await pages.ensureRoot();
    /**
     * 0.2.77 — a real M42 primitive, because spec content now has exactly ONE
     * writer: the `markOrigin` → write → `flush` fallback this rig used to run
     * on is gone from production, so a rig without a record store would be
     * exercising a path that no longer exists. `fsEvents: false` — this file is
     * about the MCP envelope, not about the file provider.
     */
    runtime = new FileWatchRuntime({ fsEvents: false });
    runtime.mountSource({ source: 'pages:pages', dir: pages.root, scope: RIG_SCOPE });
    pages.records = new RecordStore<MarkdownRecord>({
      registrar: runtime.scoped(RIG_SCOPE),
      source: 'pages:pages',
      dir: pages.root,
      adapter: markdownAdapter,
    });
    origins = [];
    target = { pages, writer: recordingWriter(origins) };
    const instance = createPageToolsServer({
      sections: new SectionsService(db),
      resolveRoot: (rootId) => (rootId === 'pages' ? target : undefined),
      rootIds: () => ['pages', 'guides'],
    });
    declared = instance.tools;
    const { server } = instance;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await runtime.close();
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
      // The ack is metadata only: the page is re-read with get_page, never echoed.
      expect(Object.keys(res.body).sort()).toEqual(['changedAnchors', 'hash', 'replacements', 'version']);
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
      expect(Object.keys(res.body).sort()).toEqual(['changedAnchors', 'hash', 'version']);
    });
  });

  /**
   * 0.2.78 — `move_page` over the MCP adapter.
   *
   * The sequence itself belongs to `page-write.test.ts` and the primitive; what
   * only this adapter can get wrong is whether it forwards `from`/`to` at all,
   * and whether the refusals survive the envelope. A handler that accepted the
   * schema and dropped a field would answer a clean success having moved nothing.
   */
  describe('move_page', () => {
    async function seed(rel: string, body: string) {
      const created = await call('create_page', { rootId: 'pages', path: rel, content: body });
      return created.body.hash as string;
    }

    it('moves the page and answers the new path with the hash unchanged', async () => {
      const hash = await seed('a.md', '# A\n\nbody\n');
      const res = await call('move_page', { rootId: 'pages', from: 'a.md', to: 'guides/b.md', expectedHash: hash });
      expect(res.isError).toBe(false);
      expect(res.body.path).toBe('guides/b.md');
      // Unchanged because the content is never re-serialized — the adapter does
      // not run at all on this path.
      expect(res.body.hash).toBe(hash);
      expect(await pages.exists('a.md')).toBe(false);
      expect(await pages.exists('guides/b.md')).toBe(true);
    });

    it('keeps PAGE_CONFLICT recoverable — the envelope carries the current hash', async () => {
      // The one thing the envelope must not lose: without `currentHash` the
      // documented recovery (re-read, re-apply, pass it back) has no input.
      await seed('a.md', '# A\n');
      const res = await call('move_page', {
        rootId: 'pages',
        from: 'a.md',
        to: 'b.md',
        expectedHash: 'f'.repeat(64),
      });
      expect(res.isError).toBe(true);
      expect(res.body.code).toBe('PAGE_CONFLICT');
      expect(res.body.currentHash).toHaveLength(64);
    });

    it('refuses an occupied destination as PAGE_EXISTS', async () => {
      const hash = await seed('a.md', '# A\n');
      await seed('b.md', '# B\n');
      const res = await call('move_page', { rootId: 'pages', from: 'a.md', to: 'b.md', expectedHash: hash });
      expect(res.isError).toBe(true);
      expect(res.body.code).toBe('PAGE_EXISTS');
    });

    it('names the roots that exist when the rootId is unknown', async () => {
      const res = await call('move_page', {
        rootId: 'nope',
        from: 'a.md',
        to: 'b.md',
        expectedHash: 'f'.repeat(64),
      });
      expect(res.isError).toBe(true);
      expect(res.body.code).toBe('ROOT_NOT_FOUND');
      expect(res.body.hint).toContain('guides');
    });
  });

  it('carries the five operations of the page write path, and nothing else', async () => {
    // A SIXTH tool here would be a capability the catalog has no row for, which
    // the profile gate would then wave through on the strength of this being a
    // host-owned server. The list grows only alongside a `CATALOG.register` —
    // that pairing is the whole reason this assertion is exhaustive rather than
    // a `toContain`.
    //
    // 0.2.78 adds `move_page`. It is the one operation here that never touches
    // content, and it is still a write: it changes a page's identity, which is
    // `(rootId, path)`.
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'create_page',
      'delete_page',
      'move_page',
      'update_page',
      'update_sections',
    ]);
  });

  it('stamps its writes as `agent` — the axis on which this channel differs from REST', async () => {
    /**
     * 0.2.77 — read off the CHAIN, not off `markOrigin`.
     *
     * The claim is unchanged and is the point of this file: every write through
     * this channel is attributed to `agent`, where REST attributes to `user`.
     * What changed is where the label lives. It used to be a hint parked beside
     * the path for a later file event to collect; it is now an argument of the
     * in-band chain, which `capture` reads through `peekActor`. Probing the
     * chain asserts the property the version log actually depends on.
     */
    const seen: Array<{ relPath: string; actor: WriteActor | undefined }> = [];
    const probe = (relPath: string) =>
      void seen.push({ relPath, actor: runtime.peekActor(RIG_SCOPE, 'pages:pages', relPath) });
    runtime.scoped(RIG_SCOPE).subscribe(
      'pages:pages',
      { onChange: (_s, _src, relPath) => probe(relPath), onUnlink: (_s, _src, relPath) => probe(relPath) },
      { id: 'actor-probe', phase: 'capture' },
    );
    const created = await call('create_page', { rootId: 'pages', path: 'a.md', content: '# A' });
    await call('update_page', { rootId: 'pages', path: 'a.md', body: '# A2', expectedHash: created.body.hash });
    await call('delete_page', { rootId: 'pages', path: 'a.md' });
    expect(seen).toEqual([
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

  it('[entity:page-tools-update-page] update_page is on page-tools with its 2.1.26 record\'s description, parameter set (`body` + `frontmatter` literal, `textEdits` differential) and hints, an always-on anchor guard, and a literal write that creates or replaces', async () => {
    // The record, verbatim: name, description, every parameter, and the four hints
    // (readOnly 0, destructive 1, idempotent 0, openWorld 0) as the only annotations.
    expectToolMatchesWriteRecord(declared.find((t) => t.name === 'update_page'), 'page-tools-update-page');
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'update_page')!;
    expect(tool).toBeDefined();
    const props = tool.inputSchema.properties!;
    // 2.1.14 — the literal mode's field is `body` (+ optional `frontmatter`); the old `content` is gone.
    expect(Object.keys(props).sort()).toEqual(
      ['body', 'dropAnchors', 'expectedHash', 'frontmatter', 'path', 'rootId', 'textEdits'].sort(),
    );
    expect(props).not.toHaveProperty('content');
    expect((props.body as { type?: string }).type).toBe('string');
    expect((props.frontmatter as { type?: string }).type).toBe('object');
    expect((props.textEdits as { type?: string }).type).toBe('array');
    expect((props.dropAnchors as { type?: string }).type).toBe('array');
    expect(tool.inputSchema.required ?? []).toEqual(expect.arrayContaining(['rootId', 'path', 'expectedHash']));
    for (const optional of ['body', 'frontmatter', 'textEdits', 'dropAnchors']) {
      expect(tool.inputSchema.required ?? []).not.toContain(optional);
    }
    expect((props.body as { description?: string }).description).toContain('a page that does not exist yet is created');
    expect((props.frontmatter as { description?: string }).description).toContain("replaces the page's frontmatter wholesale");
    expect((props.textEdits as { description?: string }).description).toContain('Mutually exclusive with `body`');
    expect(tool.description).toContain('A literal write creates a missing page (create-or-replace)');
    // The entity's hints: readOnly 0, destructive 1, idempotent 0, openWorld 0.
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    // 2.1.8 — no root-dependent exemption from the guard is advertised any more.
    expect(tool.description).toContain('ANCHOR LOSS, IN BOTH MODES');
    expect(tool.description).not.toMatch(/guard does not run/i);
    expect((props.dropAnchors as { description?: string }).description).toContain('runs on every page root');

    // logic — the literal mode is create-or-replace: a page missing from a known root is CREATED, never NOT_FOUND.
    const created = await call('update_page', {
      rootId: 'pages',
      path: 'fresh/new.md',
      body: '# New\n\nfirst\n',
      frontmatter: { title: 'New', order: 1 },
      expectedHash: 'a'.repeat(64),
    });
    expect(created.isError).toBe(false);
    expect(Object.keys(created.body).sort()).toEqual(['changedAnchors', 'hash', 'version']);
    const createdOnDisk = await fs.readFile(path.join(pages.root, 'fresh/new.md'), 'utf-8');
    expect(createdOnDisk).toContain('first');
    expect(created.body.hash).toBe(createHash('sha256').update(createdOnDisk, 'utf-8').digest('hex'));

    // …and replaces: `frontmatter` replaces the old one WHOLESALE — `order` does not survive a write that omits it.
    const replaced = await call('update_page', {
      rootId: 'pages',
      path: 'fresh/new.md',
      body: '# New\n\nsecond\n',
      frontmatter: { title: 'Renamed' },
      expectedHash: created.body.hash,
    });
    expect(replaced.isError).toBe(false);
    const read = await pages.read('fresh/new.md');
    expect(read.frontmatter).toEqual({ title: 'Renamed' });
    expect(read.body).toContain('second');
    expect(read.body).not.toContain('first');

    // The removed `content` name describes nothing any more: INVALID_ARGUMENT, and no page is created.
    const legacy = await call('update_page', {
      rootId: 'pages',
      path: 'legacy.md',
      content: '# Legacy\n',
      expectedHash: 'a'.repeat(64),
    });
    expect(legacy.isError).toBe(true);
    expect(legacy.body.code).toBe('INVALID_ARGUMENT');
    expect(await pages.exists('legacy.md')).toBe(false);
  });

  it('[entity:katalog-operacji-m02#update_page] the row: project, direct in internal/mcp/rest and cli n/a, file+db+ui-notify, `(rootId, relPath)`, `body` (+ `frontmatter`) or `textEdits` disjointly, mandatory expectedHash guard, the rules it can show (echo-free, destructive-declared, replacements-returned, diff-field-names) and its error codes; a literal write to a page missing from a known root creates it — no NOT_FOUND', async () => {
    registerCoreOperations();
    const op = CATALOG.require('update_page');
    // nazwa — `update_page` — zapis strony (utwórz albo zastąp)
    expect(op.summary).toMatch(/create or replace/i);
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    for (const channel of ['internal', 'mcp', 'rest'] as const) {
      expect(op.channels[channel].kind, channel).toBe('direct');
    }
    // 2.1.43 — no `c4s` command writes a page.
    expect(op.channels.cli).toEqual({
      kind: 'na',
      reason: 'Komendy nie zaprojektowano: rejestr komend `c4s` nie ma kontrybucji zapisu stron.',
    });
    expect([...op.sideEffects].sort()).toEqual(['db', 'file', 'ui-notify']);
    // opis treści — `obydwa`: `body` (z opcjonalnym `frontmatter`) albo `textEdits`, rozłącznie.
    expect(op.contentInput).toBe('literal+diff');
    // adresowanie — `(rootId, relPath)`; guard — `wymagany`.
    expect(Object.keys(op.inputSchema).sort()).toEqual(
      ['body', 'dropAnchors', 'expectedHash', 'frontmatter', 'path', 'rootId', 'textEdits'].sort(),
    );
    expect(op.inputSchema).not.toHaveProperty('content');
    const isOptional = (key: string): boolean =>
      (op.inputSchema[key] as unknown as { isOptional(): boolean }).isOptional();
    for (const required of ['rootId', 'path', 'expectedHash']) expect(isOptional(required), required).toBe(false);
    for (const optional of ['body', 'frontmatter', 'textEdits', 'dropAnchors']) expect(isOptional(optional), optional).toBe(true);
    // kody błędów — the ones this operation raises.
    expect(op.errorCodes).toEqual(
      expect.arrayContaining(['PAGE_CONFLICT', 'INVALID_ARGUMENT', 'FIND_NOT_FOUND', 'MATCH_COUNT_MISMATCH', 'ANCHOR_LOSS']),
    );
    // ASSUMPTION:dev-0101 — an unknown root is ROOT_NOT_FOUND on every channel, where the row says NOT_FOUND.
    expect(op.errorCodes).toContain('ROOT_NOT_FOUND');
    // ASSUMPTION:m02u-dev-0001 — ROOT_NOT_WRITABLE has no producer anywhere in the page write path, so it is not declared.
    expect(op.errorCodes).not.toContain('ROOT_NOT_WRITABLE');

    // The MCP rendering: same addressing, same field names (`diff-field-names`), `destructive-declared`.
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'update_page')!;
    expect(tool.inputSchema.required ?? []).toEqual(expect.arrayContaining(['rootId', 'path', 'expectedHash']));
    const editProps = (tool.inputSchema.properties!.textEdits as { items: { properties: Record<string, unknown> } }).items
      .properties;
    expect(Object.keys(editProps).sort()).toEqual(['expectedMatches', 'find', 'replaceWith']);
    expect(tool.annotations?.destructiveHint).toBe(true);

    // Behaviour. A literal write to a page missing from a known root is CREATED — no NOT_FOUND.
    const created = await call('update_page', {
      rootId: 'pages',
      path: 'row.md',
      body: '# Row\n\nalpha beta\n',
      expectedHash: 'a'.repeat(64),
    });
    expect(created.isError).toBe(false);
    expect(await pages.exists('row.md')).toBe(true);
    // `echo-free`: the answer is metadata only, no page.
    expect(Object.keys(created.body).sort()).toEqual(['changedAnchors', 'hash', 'version']);

    // `replacements-returned`: the differential mode reports how many substitutions landed.
    const diff = await call('update_page', {
      rootId: 'pages',
      path: 'row.md',
      textEdits: [{ find: 'a', replaceWith: 'A', expectedMatches: 'all' }],
      expectedHash: created.body.hash,
    });
    expect(diff.isError).toBe(false);
    expect(diff.body.replacements).toBe(3);

    // `body` and `textEdits` together, or neither → INVALID_ARGUMENT; a stale hash → PAGE_CONFLICT.
    const both = await call('update_page', {
      rootId: 'pages',
      path: 'row.md',
      body: 'x',
      textEdits: [{ find: 'A', replaceWith: 'a', expectedMatches: 'all' }],
      expectedHash: diff.body.hash,
    });
    expect(both.body.code).toBe('INVALID_ARGUMENT');
    const neither = await call('update_page', { rootId: 'pages', path: 'row.md', expectedHash: diff.body.hash });
    expect(neither.body.code).toBe('INVALID_ARGUMENT');
    const stale = await call('update_page', { rootId: 'pages', path: 'row.md', body: 'y', expectedHash: created.body.hash });
    expect(stale.body.code).toBe('PAGE_CONFLICT');
  });

  it('0.2.100 — update_sections declares the sixth action and a heading field, update_page declares neither', async () => {
    const { tools } = await client.listTools();

    const edits = (tools.find((t) => t.name === 'update_sections')!.inputSchema.properties!.edits as any)
      .items.properties;
    expect(edits.action.enum).toEqual(['replace', 'append', 'insert_after', 'delete', 'edit', 'rename']);
    expect(edits.heading.type).toBe('string');

    /**
     * `update_page` gets a steering SENTENCE and no schema at all — a heading
     * rewrite is now somebody else's operation, and giving this one a parameter
     * for it would be the second home the release exists to remove.
     */
    const updatePage = tools.find((t) => t.name === 'update_page')!;
    expect(Object.keys(updatePage.inputSchema.properties!)).not.toContain('heading');
    expect(updatePage.description).toContain('prefer `update_sections` (its `rename` keeps the anchor)');
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
  /**
   * 2.1.26 — `page-tools · delete_page` as its record states it: no `expectedHash`
   * parameter (the concurrency guard does not run in this channel), no hints, and
   * a missing page is a SUCCESS with `deleted: false`.
   */
  it('[entity:page-tools-delete-page] delete_page: the record\'s description and (rootId, path) alone, no hints; unknown root ROOT_NOT_FOUND, empty path VALIDATION, a missing page { ok: true, deleted: false }, no concurrency guard', async () => {
    expectToolMatchesWriteRecord(declared.find((t) => t.name === 'delete_page'), 'page-tools-delete-page');
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'delete_page')!;
    expect(Object.keys(tool.inputSchema.properties ?? {}).sort()).toEqual(['path', 'rootId']);
    expect(tool.inputSchema.properties).not.toHaveProperty('expectedHash');

    const unknownRoot = await call('delete_page', { rootId: 'nope', path: 'a.md' });
    expect(unknownRoot.isError).toBe(true);
    expect(unknownRoot.body.code).toBe('ROOT_NOT_FOUND');
    const emptyPath = await invoke(declared, 'delete_page', { rootId: 'pages', path: '' });
    expect(emptyPath.isError).toBe(true);
    expect(emptyPath.body.code).toBe('VALIDATION');

    // No page at the address: success, nothing deleted — not a refusal.
    const missing = await call('delete_page', { rootId: 'pages', path: 'never.md' });
    expect(missing.isError).toBe(false);
    expect(missing.body).toEqual({ ok: true, deleted: false });

    // The tool hands the service no `expectedHash`: a stale one sent anyway guards nothing.
    await call('create_page', { rootId: 'pages', path: 'doomed.md', content: '# Doomed\n' });
    const deleted = await invoke(declared, 'delete_page', { rootId: 'pages', path: 'doomed.md', expectedHash: 'f'.repeat(64) });
    expect(deleted.isError).toBe(false);
    expect(deleted.body).toEqual({ ok: true, deleted: true });
    expect(await pages.exists('doomed.md')).toBe(false);
    // The content of the deleted page does not come back.
    expect(JSON.stringify(deleted.body)).not.toContain('Doomed');
  });

  /**
   * 2.1.26 — `page-tools · move_page`: the answer reports `citationSync`, and a
   * propagation that fails after the move does not undo it.
   */
  it('[entity:page-tools-move-page] move_page: the record\'s description and parameters, no hints; answers { rootId, path, hash, version, citationSync } with the hash unchanged; a failed citation sync lands in citationSync.error without undoing the move; its refusals carry their codes', async () => {
    expectToolMatchesWriteRecord(declared.find((t) => t.name === 'move_page'), 'page-tools-move-page');

    const created = await call('create_page', { rootId: 'pages', path: 'a.md', content: '# A\n' });
    const moved = await call('move_page', { rootId: 'pages', from: 'a.md', to: 'guides/a.md', expectedHash: created.body.hash });
    expect(moved.isError).toBe(false);
    expect(Object.keys(moved.body).sort()).toEqual(['citationSync', 'hash', 'path', 'rootId', 'version']);
    expect(moved.body).toMatchObject({ rootId: 'pages', path: 'guides/a.md', hash: created.body.hash });
    expect(typeof moved.body.version).toBe('number');
    // This rig wires no link indexer: nothing to rewrite, no error.
    expect(moved.body.citationSync).toEqual({ rewritten: [] });

    // With a propagation: the rewritten pages are reported…
    const rewriting = createPageToolsServer({
      sections: new SectionsService(db),
      resolveRoot: (rootId) => (rootId === 'pages' ? target : undefined),
      rootIds: () => ['pages'],
      propagateRename: async () => ['index.md', 'modules/m02-pages.md'],
    }).tools;
    const synced = await invoke(rewriting, 'move_page', { rootId: 'pages', from: 'guides/a.md', to: 'b.md', expectedHash: created.body.hash });
    expect(synced.isError).toBe(false);
    expect(synced.body.citationSync).toEqual({ rewritten: ['index.md', 'modules/m02-pages.md'] });

    // …and one that breaks after the move answers WITH the move, the error in citationSync.
    const failing = createPageToolsServer({
      sections: new SectionsService(db),
      resolveRoot: (rootId) => (rootId === 'pages' ? target : undefined),
      rootIds: () => ['pages'],
      propagateRename: async () => {
        throw new Error('link projection is stale');
      },
    }).tools;
    const broken = await invoke(failing, 'move_page', { rootId: 'pages', from: 'b.md', to: 'c.md', expectedHash: created.body.hash });
    expect(broken.isError).toBe(false);
    expect(broken.body.path).toBe('c.md');
    expect(broken.body.citationSync).toEqual({ rewritten: [], error: 'link projection is stale' });
    expect(await pages.exists('c.md')).toBe(true);
    expect(await pages.exists('b.md')).toBe(false);

    // Refusals, each with its code and neither file touched.
    const hash = created.body.hash as string;
    const codeOf = async (args: Record<string, unknown>) => (await invoke(declared, 'move_page', args)).body.code;
    expect(await codeOf({ rootId: 'nope', from: 'c.md', to: 'd.md', expectedHash: hash })).toBe('ROOT_NOT_FOUND');
    expect(await codeOf({ rootId: 'pages', from: '', to: 'd.md', expectedHash: hash })).toBe('INVALID_ARGUMENT');
    expect(await codeOf({ rootId: 'pages', from: 'c.md', to: '', expectedHash: hash })).toBe('INVALID_ARGUMENT');
    expect(await codeOf({ rootId: 'pages', from: 'c.md', to: 'd.md' })).toBe('INVALID_ARGUMENT');
    expect(await codeOf({ rootId: 'pages', from: 'c.md', to: 'd.md', expectedHash: 'f'.repeat(64) })).toBe('PAGE_CONFLICT');
    expect(await codeOf({ rootId: 'pages', from: 'gone.md', to: 'd.md', expectedHash: hash })).toBe('NOT_FOUND');
    expect(await codeOf({ rootId: 'pages', from: 'c.md', to: '../outside.md', expectedHash: hash })).toBe('INVALID_ARGUMENT');
    await call('create_page', { rootId: 'pages', path: 'taken.md', content: '# T\n' });
    expect(await codeOf({ rootId: 'pages', from: 'c.md', to: 'taken.md', expectedHash: hash })).toBe('PAGE_EXISTS');
    expect(await pages.exists('c.md')).toBe(true);
    expect(await fs.readFile(path.join(pages.root, 'taken.md'), 'utf-8')).toBe('# T\n');

    // A root with no record store cannot move a file at all.
    const storeless = { pages: new PagesService(cwd, 'pages', 'pages'), writer: recordingWriter([]) };
    const noStore = createPageToolsServer({
      sections: new SectionsService(db),
      resolveRoot: () => storeless,
      rootIds: () => ['pages'],
    }).tools;
    expect((await invoke(noStore, 'move_page', { rootId: 'pages', from: 'c.md', to: 'd.md', expectedHash: hash })).body.code).toBe(
      'NOT_IMPLEMENTED',
    );
  });

  /**
   * 2.1.26 — `page-tools · update_sections` over a real section index: the
   * record's description, parameters and (empty) hints, the refusals its `logic`
   * lists in order, and the answer's shape.
   */
  it('[entity:page-tools-update-sections] update_sections: the record\'s description and parameters, no hints; validation before the read (INVALID_ARGUMENT / VALIDATION), anchors resolved by section_index (SECTION_NOT_FOUND, two pages INVALID_ARGUMENT, unmounted root ROOT_NOT_FOUND, INDEX_STALE), the page hash guard, and one result row per element', async () => {
    expectToolMatchesWriteRecord(declared.find((t) => t.name === 'update_sections'), 'page-tools-update-sections');

    const ghost = new PagesService(cwd, 'ghost', 'ghost');
    await ghost.ensureRoot();
    const indexer = new SectionIndexerService(
      db,
      new Map([
        ['pages', { pages }],
        ['ghost', { pages: ghost }],
      ]),
      { broadcast: () => {} } as never,
      NO_ENTITIES,
    );
    const docA = '<!-- anchor: aaaa0001 -->\n## One\n\nalpha\n\n<!-- anchor: aaaa0002 -->\n## Two\n\nbeta\n';
    const a = await call('create_page', { rootId: 'pages', path: 'a.md', content: docA });
    await call('create_page', { rootId: 'pages', path: 'b.md', content: '<!-- anchor: bbbb0001 -->\n## Other\n\ngamma\n' });
    await fs.writeFile(path.join(ghost.root, 'g.md'), '<!-- anchor: cccc0001 -->\n## Ghost\n\nboo\n', 'utf-8');
    for (const [root, rel] of [['pages', 'a.md'], ['pages', 'b.md'], ['ghost', 'g.md']] as const) {
      await indexer.indexPage(root, rel);
    }
    const hash = a.body.hash as string;
    const codeOf = async (args: Record<string, unknown>) => (await invoke(declared, 'update_sections', args)).body.code;

    // Validation before anything is read.
    expect(await codeOf({ expectedHash: hash, edits: [] })).toBe('INVALID_ARGUMENT');
    expect(await codeOf({ expectedHash: hash, edits: [{ anchor: 'aaaa0001', action: 'move' }] })).toBe('INVALID_ARGUMENT');
    expect(await codeOf({ expectedHash: hash, edits: [{ action: 'replace', content: 'x' }] })).toBe('VALIDATION');
    expect(await codeOf({ expectedHash: hash, edits: [{ anchor: 'aaaa0001', action: 'replace' }] })).toBe('VALIDATION');
    // A field outside its action — `delete` takes none at all.
    expect(await codeOf({ expectedHash: hash, edits: [{ anchor: 'aaaa0001', action: 'delete', content: 'x' }] })).toBe('INVALID_ARGUMENT');
    expect(await codeOf({ expectedHash: hash, edits: [{ anchor: 'aaaa0001', action: 'replace', content: 'x', heading: 'H' }] })).toBe(
      'INVALID_ARGUMENT',
    );

    // Anchors are resolved through section_index, which also names the page and its root.
    expect(await codeOf({ expectedHash: hash, edits: [{ anchor: 'zzzz9999', action: 'delete' }] })).toBe('SECTION_NOT_FOUND');
    expect(
      await codeOf({
        expectedHash: hash,
        edits: [
          { anchor: 'aaaa0001', action: 'delete' },
          { anchor: 'bbbb0001', action: 'delete' },
        ],
      }),
    ).toBe('INVALID_ARGUMENT');
    expect(await codeOf({ expectedHash: hash, edits: [{ anchor: 'cccc0001', action: 'delete' }] })).toBe('ROOT_NOT_FOUND');

    // The page hash guards the whole batch.
    expect(await codeOf({ expectedHash: '', edits: [{ anchor: 'aaaa0001', action: 'replace', content: 'x' }] })).toBe(
      'INVALID_ARGUMENT',
    );
    const stale = await invoke(declared, 'update_sections', {
      expectedHash: 'f'.repeat(64),
      edits: [{ anchor: 'aaaa0001', action: 'replace', content: 'x' }],
    });
    expect(stale.body.code).toBe('PAGE_CONFLICT');
    expect(stale.body.currentHash).toBe(hash);

    // One anchor, two actions, one batch: a row per element in input order.
    const ok = await call('update_sections', {
      expectedHash: hash,
      edits: [
        { anchor: 'aaaa0001', action: 'rename', heading: 'First' },
        { anchor: 'aaaa0001', action: 'replace', content: 'ALPHA' },
      ],
    });
    expect(ok.isError).toBe(false);
    expect(Object.keys(ok.body).sort()).toEqual(['hash', 'path', 'results', 'version']);
    expect(ok.body.path).toBe('a.md');
    const onDisk = await fs.readFile(path.join(pages.root, 'a.md'), 'utf-8');
    expect(ok.body.hash).toBe(sha256(onDisk));
    // The heading line rewritten under its kept anchor, the own body replaced, the next section intact.
    expect(onDisk).toContain('<!-- anchor: aaaa0001 -->\n## First\n');
    expect(onDisk).toContain('ALPHA');
    expect(onDisk).not.toContain('alpha');
    expect(onDisk).toContain('<!-- anchor: aaaa0002 -->\n## Two\n\nbeta');
    expect(ok.body.results.map((r: { anchor: string; action: string }) => `${r.anchor}:${r.action}`)).toEqual([
      'aaaa0001:rename',
      'aaaa0001:replace',
    ]);
    expect(ok.body.results[0]).toMatchObject({ previousHeading: 'One', droppedAnchors: [], addedAnchors: [] });
    expect(ok.body.results[1]).not.toHaveProperty('previousHeading');
    for (const row of ok.body.results) expect(row).not.toHaveProperty('replacements');

    // An indexed anchor missing from the file is INDEX_STALE, not a write in the wrong place.
    const underneath = '<!-- anchor: aaaa0001 -->\n## First\n\nALPHA\n';
    await fs.writeFile(path.join(pages.root, 'a.md'), underneath, 'utf-8');
    expect(
      await codeOf({ expectedHash: sha256(underneath), edits: [{ anchor: 'aaaa0002', action: 'replace', content: 'x' }] }),
    ).toBe('INDEX_STALE');
  });
});
