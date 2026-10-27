import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileWatchRuntime, type WatchScope } from '../fs/watcher.js';
import { RecordStore } from '../fs/record-store.js';
import { markdownAdapter, type MarkdownRecord } from '../fs/record-adapters.js';
import { boundWriter } from '../fs/sources.js';
import { currentOperationId, MultiFileOperationError } from '../fs/multi-file-operation.js';
import { runMigrations } from '../db/migrate.js';
import { FileSerializer } from './file-serializer.js';
import { FileVersionService } from './file-version.js';
import { FileVersionCapture } from './file-version-capture.js';
import { MarkdownFileStore } from './markdown-file-store.js';
import { PagesService } from './pages.js';
import { SectionsService } from './sections.js';
import { ReferencesService } from './references.js';
import { TagsService } from './tags.js';
import { PagesLinkIndexerService } from './pages-link-indexer.js';
import { movePage } from './page-write.js';
import { tagsRouter } from '../routes/tags.js';
import { createReferenceToolsServer } from '../mcp/reference-tools.js';
import type { EntityStore } from './entity-store.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

/**
 * 2.1.57 — the five multi-file operations on the shared rules of M42
 * `gg7sxih6`: entity slug propagation (M19 / M29), anchor propagation (M06),
 * tag slug rename (M18) and the page move with link rewriting (M14). Each is
 * driven through the record primitive and M17's real `capture` phase, so the
 * `file_version` rows are the observable: one `operation_id` on every row of
 * the operation, and — when a write fails halfway — the files already written
 * put back, under that same id, with the operation answering an error.
 */

const SCOPE: WatchScope = 'context:multi-file-consumers';
const SOURCE = 'pages:pages';
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

interface Row {
  path: string;
  op: string;
  operation_id: string | null;
  content: string;
}

function harness() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-multi-file-consumers-'));
  const dir = path.join(cwd, 'pages');
  fs.mkdirSync(dir);
  const db = new Database(':memory:');
  runMigrations(db);
  const runtime = new FileWatchRuntime({ fsEvents: false });
  runtime.mountSource({ source: SOURCE, dir, scope: SCOPE });
  cleanups.push(() => fs.rmSync(cwd, { recursive: true, force: true }));
  cleanups.push(() => {
    db.close();
  });
  cleanups.push(() => runtime.close());

  const serializer = new FileSerializer(new MarkdownFileStore({ cwd, dir: 'pages', rootId: 'pages' }));
  const versions = new FileVersionService(db, serializer);
  const capture = new FileVersionCapture(versions, new Map([['pages', serializer]]), () => undefined);
  runtime.subscribe(SOURCE, capture, { id: 'm17-capture', phase: 'capture', scope: SCOPE });

  const registrar = runtime.scoped(SCOPE);
  const pages = new PagesService(cwd, 'pages', 'pages');
  const records = new RecordStore<MarkdownRecord>({ registrar, source: SOURCE, dir, adapter: markdownAdapter });
  pages.records = records;

  const seed = (rel: string, body: string) => fs.writeFileSync(path.join(dir, rel), body, 'utf-8');
  const read = (rel: string) => fs.readFileSync(path.join(dir, rel), 'utf-8');
  const rows = () =>
    db
      .prepare(
        `SELECT path, op, operation_id, json_extract(data, '$.content') AS content FROM file_version ORDER BY id`,
      )
      .all() as Row[];
  /** The N-th write through the primitive fails, as a full disk would; restores are not writes. */
  const failNthWrite = (n: number) => {
    const original = records.write.bind(records);
    let calls = 0;
    vi.spyOn(records, 'write').mockImplementation(async (...args: Parameters<typeof records.write>) => {
      calls += 1;
      if (calls === n) throw new Error('disk full');
      return await original(...args);
    });
  };
  const watcher = boundWriter(registrar, SOURCE);
  return { db, pages, records, versions, watcher, seed, read, rows, failNthWrite };
}

/** Every row is stamped, and with one and the same id. */
function expectOneOperation(rows: Row[]): string {
  expect(rows.length).toBeGreaterThan(0);
  const ids = new Set(rows.map((r) => r.operation_id));
  expect(ids.size).toBe(1);
  const [id] = [...ids];
  expect(id).toEqual(expect.any(String));
  return id!;
}

/**
 * A failed operation: exactly one file had been written (the first), it was
 * written back to its original bytes under the operation's id, and nothing
 * else was touched.
 */
function expectRolledBack(rows: Row[], originals: Record<string, string>, read: (rel: string) => string) {
  expectOneOperation(rows);
  expect(rows).toHaveLength(2);
  const [forward, undo] = rows;
  expect(undo!.path).toBe(forward!.path);
  expect(undo!.content).toBe(originals[forward!.path]);
  for (const [rel, body] of Object.entries(originals)) expect(read(rel)).toBe(body);
}

describe('M06 — anchor propagation as one multi-file operation', () => {
  function rig() {
    const h = harness();
    const sections = new SectionsService(h.db);
    sections.setWriteDeps(new Map([['pages', { pages: h.pages, watcher: h.watcher }]]));
    const originals = {
      'one.md': '# One\n\nsee <section_ref anchor="oldanch1"/>\n',
      'two.md': '# Two\n\nand @a.md#oldanch1\n',
    };
    for (const [rel, body] of Object.entries(originals)) h.seed(rel, body);
    return { ...h, sections, originals };
  }

  it('[section:h556wl8s] every rewritten file\'s version row carries one operation_id', async () => {
    const { sections, rows, read } = rig();

    const { changed } = await sections.propagateAnchorChange('oldanch1', 'newanch1');

    expect(changed.sort()).toEqual(['pages:one.md', 'pages:two.md']);
    expect(rows().map((r) => r.path).sort()).toEqual(['one.md', 'two.md']);
    expectOneOperation(rows());
    expect(read('two.md')).toContain('@a.md#newanch1');
  });

  it('[section:h556wl8s] a write failing halfway puts the file already rewritten back, under the same id, and the propagation fails', async () => {
    const { sections, rows, read, originals, failNthWrite } = rig();
    failNthWrite(2);

    const err = await sections.propagateAnchorChange('oldanch1', 'newanch1').then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(MultiFileOperationError);
    expect((err as MultiFileOperationError).unrestored).toEqual([]);
    expectRolledBack(rows(), originals, read);
  });
});

describe('M19 / M29 — entity slug propagation as one multi-file operation', () => {
  function rig() {
    const h = harness();
    const references = new ReferencesService(new Map([['pages', h.pages]]), new Map([['pages', h.watcher]]));
    // The entity-file phase (M29): the generated listener rewrites other entity files.
    const listenerRuns: Array<string | undefined> = [];
    references.setPluginHost({
      listRenameListeners: () => [() => void listenerRuns.push(currentOperationId())],
    } as unknown as ProjectPluginHost);
    const originals = {
      'one.md': '# One\n\nuses <inline_mention type="dto" slug="user-dto"/>\n',
      'two.md': '# Two\n\n<element_list type="dto" slugs="user-dto,other-dto"/>\n',
    };
    for (const [rel, body] of Object.entries(originals)) h.seed(rel, body);
    return { ...h, references, listenerRuns, originals };
  }

  it('[section:8n46mdrz] every page the rename rewrites gets a version row with one operation_id', async () => {
    const { references, rows, read } = rig();

    const { changed } = await references.propagateSlugChange('dto', 'user-dto', 'account-dto');

    expect(changed.sort()).toEqual(['one.md', 'two.md']);
    expectOneOperation(rows());
    expect(read('one.md')).toContain('slug="account-dto"');
    expect(read('two.md')).toContain('slugs="account-dto,other-dto"');
  });

  it('[section:8n46mdrz] a page write failing halfway puts the page already rewritten back, under the same id, and the propagation fails', async () => {
    const { references, rows, read, originals, failNthWrite } = rig();
    failNthWrite(2);

    await expect(references.propagateSlugChange('dto', 'user-dto', 'account-dto')).rejects.toBeInstanceOf(
      MultiFileOperationError,
    );

    expectRolledBack(rows(), originals, read);
  });

  it('[section:m29ren001] the entity-file phase runs inside the same operation as the pages, and not at all once a page write failed', async () => {
    const ok = rig();
    await ok.references.propagateSlugChange('dto', 'user-dto', 'account-dto');
    const pageId = expectOneOperation(ok.rows());
    expect(ok.listenerRuns).toEqual([pageId]);

    const failing = rig();
    failing.failNthWrite(2);
    await expect(failing.references.propagateSlugChange('dto', 'user-dto', 'account-dto')).rejects.toBeInstanceOf(
      MultiFileOperationError,
    );
    expect(failing.listenerRuns).toEqual([]);
  });
});

describe('M18 — tag slug rename as one multi-file operation', () => {
  function rig(opts: { failTagsJson?: boolean } = {}) {
    const h = harness();
    // As the project db handle runs: entity_tag.tag_slug follows the rename by FK cascade.
    h.db.pragma('foreign_keys = ON');
    const references = new ReferencesService(new Map([['pages', h.pages]]), new Map([['pages', h.watcher]]));
    const tags = new TagsService(h.db);
    // The JSON half (tags.json, the entity files' tags[]): which file, under which operation.
    const jsonWrites: Array<[string, string | undefined]> = [];
    tags.setEntityStore({
      persistTags: () => {
        // As a full disk would refuse `tags.json`, after the row's UPDATE has run.
        if (opts.failTagsJson) throw new Error('tags.json write failed');
        jsonWrites.push(['tags.json', currentOperationId()]);
      },
      persist: (type: string, slug: string) => void jsonWrites.push([`${type}/${slug}`, currentOperationId()]),
    } as unknown as EntityStore);
    h.db.prepare(`INSERT INTO tag (slug, name) VALUES ('billing', 'Billing')`).run();
    h.db.prepare(`INSERT INTO entity_tag (entity_type, entity_slug, tag_slug) VALUES ('endpoint', 'get-invoice', 'billing')`).run();
    const originals = {
      'one.md': '# One\n\n<tagged_list type="endpoint" tags="billing,auth"/>\n',
      'two.md': '# Two\n\n<tagged_list_mixed tags="billing"/>\n',
    };
    for (const [rel, body] of Object.entries(originals)) h.seed(rel, body);
    const tagSlugs = () => (h.db.prepare(`SELECT slug FROM tag ORDER BY slug`).all() as Array<{ slug: string }>).map((r) => r.slug);
    const assignedTagSlugs = () =>
      (h.db.prepare(`SELECT tag_slug FROM entity_tag ORDER BY tag_slug`).all() as Array<{ tag_slug: string }>).map((r) => r.tag_slug);
    return { ...h, references, tags, jsonWrites, originals, tagSlugs, assignedTagSlugs };
  }

  it('[section:91vuvf2u] a rename rewrites the pages, tags.json and the entity files in one operation; the pages\' version rows carry its id', async () => {
    const { references, tags, rows, read, jsonWrites, tagSlugs } = rig();

    const updated = await references.updateTag(tags, 'billing', { name: 'Invoicing' });

    expect(updated.slug).toBe('invoicing');
    expect(tagSlugs()).toEqual(['invoicing']);
    expect(read('one.md')).toContain('tags="invoicing,auth"');
    expect(read('two.md')).toContain('tags="invoicing"');
    const id = expectOneOperation(rows());
    expect(rows().map((r) => r.path).sort()).toEqual(['one.md', 'two.md']);
    expect(jsonWrites).toEqual([
      ['tags.json', id],
      ['endpoint/get-invoice', id],
    ]);
  });

  it('[section:m18acc00] tag slug rename: when a file write fails, the files already written return to their content from before the operation, every version of it carries one operation id, and an error is returned', async () => {
    const { references, tags, rows, read, originals, tagSlugs, failNthWrite } = rig();
    failNthWrite(2);

    await expect(references.updateTag(tags, 'billing', { name: 'Invoicing' })).rejects.toBeInstanceOf(
      MultiFileOperationError,
    );

    expectRolledBack(rows(), originals, read);
    // The registry and the entity files were never reached: nothing of the rename is left.
    expect(tagSlugs()).toEqual(['billing']);
  });

  it('[section:m18acc00] tag slug rename: a failure writing tags.json puts every page already rewritten back, under the operation\'s id, and leaves the tag index and entity_tag on the old slug', async () => {
    const { references, tags, rows, read, originals, tagSlugs, assignedTagSlugs, jsonWrites } = rig({ failTagsJson: true });

    await expect(references.updateTag(tags, 'billing', { name: 'Invoicing' })).rejects.toBeInstanceOf(
      MultiFileOperationError,
    );

    for (const [rel, body] of Object.entries(originals)) expect(read(rel)).toBe(body);
    expectOneOperation(rows());
    // Two forward rewrites and two restores, all of one operation.
    expect(rows()).toHaveLength(4);
    // The real `TagsService.update` ran its UPDATE (and the FK cascade) before
    // `persistTags` threw: both are rolled back with it, so the index agrees with
    // the restored pages, and no entity file was re-persisted.
    expect(tagSlugs()).toEqual(['billing']);
    expect(assignedTagSlugs()).toEqual(['billing']);
    expect(jsonWrites).toEqual([]);
  });

  /** A writer taking `invoicing` between the pre-check and the update, inside the operation. */
  function raceForTheSlug(r: ReturnType<typeof rig>) {
    const precheck = r.tags.slugAfterUpdate.bind(r.tags);
    vi.spyOn(r.tags, 'slugAfterUpdate').mockImplementation((slug, input) => {
      const target = precheck(slug, input);
      r.db.prepare(`INSERT INTO tag (slug, name) VALUES ('invoicing', 'Invoicing')`).run();
      return target;
    });
  }

  it('[section:m18acc00] a SLUG_CONFLICT raised inside the operation (a concurrent writer took the slug) rolls the pages back and reaches REST as 409 SLUG_CONFLICT', async () => {
    const r = rig();
    raceForTheSlug(r);
    const app = express();
    app.use(express.json());
    app.use('/api/tags', tagsRouter(r.tags, r.references, {} as never, { broadcast: () => {} } as never));

    const res = await request(app).patch('/api/tags/billing').send({ name: 'Invoicing' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLUG_CONFLICT');
    // The refusal came from inside the operation: the pages were rewritten, then put back.
    expect(r.rows()).toHaveLength(4);
    expectOneOperation(r.rows());
    for (const [rel, body] of Object.entries(r.originals)) expect(r.read(rel)).toBe(body);
    expect(r.tagSlugs()).toEqual(['billing', 'invoicing']);
  });

  it('[section:m18acc00] the same in-operation SLUG_CONFLICT reaches MCP update_tag with its own code, not INTERNAL', async () => {
    const r = rig();
    raceForTheSlug(r);
    const server = createReferenceToolsServer({
      pluginHost: {} as never,
      tagsService: r.tags,
      referencesService: r.references,
      discovery: {} as never,
      ws: { broadcast: () => {} } as never,
      entityStore: {} as never,
    });
    const tool = server.tools.find((t) => t.name === 'update_tag')!;

    const res = (await tool.handler({ slug: 'billing', data: { name: 'Invoicing' } }, {})) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };

    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text).code).toBe('SLUG_CONFLICT');
    expect(r.rows()).toHaveLength(4);
    for (const [rel, body] of Object.entries(r.originals)) expect(r.read(rel)).toBe(body);
  });

  it('[section:91vuvf2u] a refused rename (taken slug) answers its own code before any page is touched', async () => {
    const { db, references, tags, rows, read, originals, jsonWrites } = rig();
    db.prepare(`INSERT INTO tag (slug, name) VALUES ('invoicing', 'Invoicing')`).run();

    await expect(references.updateTag(tags, 'billing', { name: 'Invoicing' })).rejects.toMatchObject({
      code: 'SLUG_CONFLICT',
    });

    expect(rows()).toEqual([]);
    expect(jsonWrites).toEqual([]);
    for (const [rel, body] of Object.entries(originals)) expect(read(rel)).toBe(body);
  });
});

describe('M14 — a page move with link rewriting as one multi-file operation', () => {
  async function rig() {
    const h = harness();
    const links = new PagesLinkIndexerService(new Map([['pages', h.pages]]), { broadcast: () => {} } as never);
    h.seed('a.md', '# A\n');
    const originals = {
      'one.md': '# One\n\npoints at @a.md here\n',
      'two.md': '# Two\n\nand [also](a.md)\n',
    };
    for (const [rel, body] of Object.entries(originals)) h.seed(rel, body);
    await links.indexAll();
    const move = () =>
      movePage(
        { pages: h.pages, writer: null, versions: h.versions },
        'pages',
        { from: 'a.md', to: 'b.md', expectedHash: h.records.hashOf('a.md')! },
        'user',
        (rootId, from, to, actor) => links.renameSync(rootId, from, to, actor),
      );
    return { ...h, originals, move };
  }

  it('[section:sjdtpuoo] the move and every citation it rewrites write version rows with one operation_id', async () => {
    const { move, rows, read } = await rig();

    const res = await move();

    expect(res.citationSync.rewritten.sort()).toEqual(['one.md', 'two.md']);
    expect(read('one.md')).toContain('@b.md');
    expect(read('two.md')).toContain('[also](b.md)');
    const paths = rows().map((r) => r.path);
    expect(paths).toEqual(expect.arrayContaining(['b.md', 'one.md', 'two.md']));
    expectOneOperation(rows());
  });

  it('[section:sjdtpuoo] a rewrite failing halfway puts the citation already rewritten back under the same id; the move itself stands and the failure is reported', async () => {
    const { move, rows, read, records, originals, failNthWrite } = await rig();
    failNthWrite(2);

    const res = await move();

    expect(res.path).toBe('b.md');
    expect(read('b.md')).toBe('# A\n');
    expect(fs.existsSync(path.join(records.dir, 'a.md'))).toBe(false);
    expect(res.citationSync).toEqual({ rewritten: [], error: 'disk full' });
    for (const [rel, body] of Object.entries(originals)) expect(read(rel)).toBe(body);
    const all = rows();
    expectOneOperation(all);
    // The rewritten citation: its forward row, then its restore with the original bytes.
    const citationRows = all.filter((r) => r.path === 'one.md' || r.path === 'two.md');
    expect(citationRows).toHaveLength(2);
    expect(citationRows[1]!.path).toBe(citationRows[0]!.path);
    expect(citationRows[1]!.content).toBe(originals[citationRows[0]!.path as keyof typeof originals]);
  });

  it('[section:sjdtpuoo] a citation changed by someone else before the rollback stays rewritten, and citationSync reports it in `rewritten` and in the error', async () => {
    const { move, read, records, originals } = await rig();
    const original = records.write.bind(records);
    let calls = 0;
    let touched: string | undefined;
    vi.spyOn(records, 'write').mockImplementation(async (...args: Parameters<typeof records.write>) => {
      calls += 1;
      if (calls === 2) {
        // The first citation is already rewritten; another writer edits it now,
        // so the rollback's restore meets a hash it did not leave.
        touched = (Object.keys(originals) as Array<keyof typeof originals>).find((rel) => read(rel) !== originals[rel]);
        fs.writeFileSync(path.join(records.dir, touched!), `${read(touched!)}\nedited meanwhile\n`, 'utf-8');
        throw new Error('disk full');
      }
      return await original(...args);
    });

    const res = await move();

    expect(touched).toBeDefined();
    const other = Object.keys(originals).find((rel) => rel !== touched)!;
    expect(res.path).toBe('b.md');
    // On disk: the edited citation still points at the new path; the other one was never rewritten.
    expect(read(touched!)).toContain('edited meanwhile');
    expect(read(touched!)).toMatch(/b\.md/);
    expect(read(other)).toBe(originals[other as keyof typeof originals]);
    expect(res.citationSync.rewritten).toEqual([touched]);
    expect(res.citationSync.error).toContain('disk full');
    expect(res.citationSync.error).toContain(touched!);
  });
});
