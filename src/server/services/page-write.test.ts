import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { PagesService } from './pages.js';
import { SectionsService } from './sections.js';
import { SectionIndexerService } from './section-indexer.js';
import { createPage, deletePage, updatePage, updateSection, type PageWriteTarget } from './page-write.js';
import type { SelfWriteMarker, WriteActor } from '../fs/sources.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import type { WatchSubscriber } from '../fs/watcher.js';
import { createDiscoveryCore } from '../discovery/index.js';
import type { DiscoveryCore } from '../discovery/types.js';
import { RawEntityReader } from '../discovery/raw-entity-reader.js';
import { SerializationEngine } from '../core/plugin-host/serialization-engine.js';
import { sectionSerializer } from '../serialization/serializers/section.js';
import { DEFAULT_PAGES_ROOT_PROPS } from '../../shared/types.js';

/**
 * 0.2.13 item 28 — the page write path as ONE primitive, shared by REST and by
 * `page-tools`.
 *
 * What is asserted here is mostly not "the bytes changed" — `PagesService`
 * already did that before this file existed. It is the part that used to live
 * inside three Express handlers and would have been silently absent from the
 * second channel: the write token, the actor, and the conflict guard.
 */

const host = {
  listEntities: () => [],
  listAvailable: () => [],
  getEntity: () => null,
  getAvailable: () => null,
  isActive: () => false,
  entityExists: () => false,
  getEntityService: () => null,
} as unknown as ProjectPluginHost;

/** Records what the write token was told, which is the half a built-in Write skips. */
function recordingWriter(): SelfWriteMarker & { calls: Array<{ op: string; relPath: string; actor?: WriteActor }> } {
  const calls: Array<{ op: string; relPath: string; actor?: WriteActor }> = [];
  return {
    calls,
    markOrigin: (relPath, actor) => calls.push({ op: 'markOrigin', relPath, actor }),
    flush: async (relPath, event) => {
      calls.push({ op: `flush:${event ?? 'change'}`, relPath });
    },
    suppress: (relPath) => calls.push({ op: 'suppress', relPath }),
  };
}

describe('the page write primitive', () => {
  let cwd: string;
  let pages: PagesService;
  let target: PageWriteTarget & { writer: ReturnType<typeof recordingWriter> };

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-page-write-'));
    pages = new PagesService(cwd, 'pages', 'pages');
    await pages.ensureRoot();
    target = { pages, writer: recordingWriter() };
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('labels the write with the ACTOR the channel supplies, then drives its reactions', async () => {
    /**
     * `WriteActor` has been `'user' | 'agent'` since M40 and only `'user'` was
     * ever passed, because REST was the only writer. This is the assertion that
     * makes the second value real — and `flush` before the return is what makes
     * the write read-after-write consistent, so a caller told "done" can
     * immediately read the re-indexed page.
     */
    await createPage(target, { path: 'a.md', content: '# A' }, 'agent');
    expect(target.writer.calls).toEqual([
      { op: 'markOrigin', relPath: 'a.md', actor: 'agent' },
      { op: 'flush:change', relPath: 'a.md' },
    ]);
  });

  it('answers with the hash of what LANDED, not of what was sent', async () => {
    // `write` serializes frontmatter through gray-matter, so the bytes on disk
    // are not the bytes handed in. A caller hashing its own input would fail its
    // very next `expectedHash`, which is the sort of bug that only shows up
    // under concurrency.
    const written = await updatePage(target, { path: 'fm.md', body: '# Hi', frontmatter: { order: 2 } }, 'user');
    const onDisk = await fs.readFile(path.join(pages.root, 'fm.md'), 'utf-8');
    expect(onDisk).toContain('order: 2');
    const { createHash } = await import('node:crypto');
    expect(written.hash).toBe(createHash('sha256').update(onDisk, 'utf-8').digest('hex'));
    // …and that hash is accepted as `expectedHash` on the next write.
    await expect(
      updatePage(target, { path: 'fm.md', body: '# Hi again', expectedHash: written.hash }, 'user'),
    ).resolves.toBeTruthy();
  });

  it('refuses PAGE_CONFLICT when the file moved under the caller, and hands back the current hash', async () => {
    const first = await updatePage(target, { path: 'c.md', body: 'one' }, 'user');
    await fs.writeFile(path.join(pages.root, 'c.md'), 'someone else', 'utf-8');
    const err = await updatePage(target, { path: 'c.md', body: 'two', expectedHash: first.hash }, 'user').catch(
      (e) => e,
    );
    expect(err.code).toBe('PAGE_CONFLICT');
    // The remedy travels with the refusal: re-read, re-apply, pass this back.
    expect(err.currentHash).toHaveLength(64);
    expect(await fs.readFile(path.join(pages.root, 'c.md'), 'utf-8')).toBe('someone else');
  });

  it('an ABSENT page is not a conflict — update_page doubles as create', async () => {
    // The editor saves a brand-new page through this path with a hash it got
    // from nowhere; there is no earlier state for it to be stale against.
    await expect(
      updatePage(target, { path: 'new.md', body: 'x', expectedHash: 'a'.repeat(64) }, 'user'),
    ).resolves.toMatchObject({ path: 'new.md' });
  });

  it('create_page refuses an existing page instead of overwriting it', async () => {
    await createPage(target, { path: 'dup.md', content: 'original' }, 'user');
    const err = await createPage(target, { path: 'dup.md', content: 'clobber' }, 'user').catch((e) => e);
    expect(err.code).toBe('PAGE_EXISTS');
    expect(err.hint).toContain('update_page');
    expect(await fs.readFile(path.join(pages.root, 'dup.md'), 'utf-8')).toBe('original');
  });

  it('a delete flushes an `unlink`, and does NOT suppress', async () => {
    /**
     * A suppress token issued on a delete has no event of its own to be consumed
     * by if the file is re-created immediately — it would swallow the re-create
     * and leave no version row at all. The tombstone is authored by `capture`
     * off the flush instead.
     */
    await createPage(target, { path: 'gone.md', content: 'x' }, 'user');
    target.writer.calls.length = 0;
    await deletePage(target, { path: 'gone.md' }, 'agent');
    expect(target.writer.calls).toEqual([
      { op: 'markOrigin', relPath: 'gone.md', actor: 'agent' },
      { op: 'flush:unlink', relPath: 'gone.md' },
    ]);
    expect(await pages.exists('gone.md')).toBe(false);
  });
});

describe('update_section over a real section index', () => {
  let cwd: string;
  let db: Database.Database;
  let pages: PagesService;
  let sections: SectionsService;
  let indexer: SectionIndexerService | undefined;
  let injection: WatchSubscriber | undefined;
  let target: PageWriteTarget;
  let core: DiscoveryCore;

  beforeEach(async () => {
    indexer = undefined;
    // Reset with the indexer, not just alongside it: the subscriber closes over
    // the PagesService of the temp dir that made it, so a leftover one writes
    // its anchors into the PREVIOUS test's (already deleted) directory and this
    // test's file silently never gets any.
    injection = undefined;
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-section-write-'));
    db = createTestDb();
    pages = new PagesService(cwd, 'pages', 'pages');
    await pages.ensureRoot();
    sections = new SectionsService(db);
    target = { pages, writer: null };
    core = createDiscoveryCore({
      reader: new RawEntityReader(db, host),
      db,
      host,
      serialization: new SerializationEngine(host, sectionSerializer),
      roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true, ...DEFAULT_PAGES_ROOT_PROPS }],
      projectDir: cwd,
      packageVersion: 'test',
    });
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  const deps = () => ({ sections, resolveRoot: (id: string) => (id === 'pages' ? target : undefined) });

  async function index(relPath: string, content: string): Promise<void> {
    await pages.write(relPath, { body: content });
    indexer ??= new SectionIndexerService(db, new Map([['pages', { pages }]]), { broadcast: () => {} } as never, host);
    injection ??= indexer.anchorInjectionSubscriber(() => {});
    await indexer.indexPage('pages', relPath);
    await injection!.onChange('context:test', 'pages:pages', relPath, 'external');
    // Re-index so the row's line numbers describe the file WITH its injected
    // anchor comments — which is the state every later call sees.
    await indexer.indexPage('pages', relPath);
  }

  function anchorOf(heading: string): string {
    const row = db.prepare('SELECT anchor FROM section_index WHERE heading_text = ?').get(heading) as
      | { anchor: string }
      | undefined;
    if (!row) throw new Error(`no indexed section titled ${heading}`);
    return row.anchor;
  }

  const page = ['# Top', '', '## Alpha', '', 'ALPHA BODY', '', '## Beta', '', 'BETA BODY', ''].join('\n');

  it('replaces one section body and leaves its siblings byte-identical', async () => {
    await index('doc.md', page);
    await updateSection(deps(), { anchor: anchorOf('Alpha'), content: 'REWRITTEN\n' }, 'agent');
    const body = (await pages.read('doc.md')).body;
    expect(body).toContain('REWRITTEN');
    expect(body).not.toContain('ALPHA BODY');
    expect(body).toContain('BETA BODY');
  });

  it('keeps the heading AND the anchor comment, so the same section is addressable twice', async () => {
    /**
     * The heading is the section's identity — `headingSlug`, `headingPath` and
     * anchor-rename propagation all hang off it — and the anchor comment is what
     * `<section_ref/>` points at. If either were inside the replaced range, a
     * single edit would silently re-key the section and orphan every reference
     * to it. So the second call below is the real assertion: it can only work if
     * the first one preserved both.
     */
    await index('doc.md', page);
    const anchor = anchorOf('Alpha');
    await updateSection(deps(), { anchor, content: 'ONE' }, 'agent');
    const afterFirst = (await pages.read('doc.md')).body;
    expect(afterFirst).toContain('## Alpha');
    expect(afterFirst).toContain(`<!-- anchor: ${anchor} -->`);

    await updateSection(deps(), { anchor, content: 'TWO' }, 'agent');
    const afterSecond = (await pages.read('doc.md')).body;
    expect(afterSecond).toContain('TWO');
    expect(afterSecond).not.toContain('ONE');
    expect(afterSecond).toContain('## Alpha');
  });

  it('round-trips the section body verbatim — writing back what was read is a no-op', async () => {
    /**
     * The strongest form of "these two operations agree about what a section
     * is": take the body the READ side produced and hand it straight back to
     * the write side. The page must come out byte-identical.
     *
     * It only holds because both use `sectionLines.slice(1)` — heading
     * excluded, surrounding blank lines included. Any off-by-one in the splice
     * range shows up here as a duplicated or swallowed line, which is exactly
     * how the first draft of this splice was caught.
     */
    await index('doc.md', page);
    const anchor = anchorOf('Alpha');
    const read = (await core.getSections({ anchors: [anchor] })).results[0] as { body?: string };
    expect(read.body).toContain('ALPHA BODY');
    // The read side excludes the heading — the property the write side mirrors.
    expect(read.body).not.toContain('## Alpha');

    const before = (await pages.read('doc.md')).body;
    await updateSection(deps(), { anchor, content: read.body! }, 'agent');
    expect((await pages.read('doc.md')).body).toBe(before);
  });

  it('an unknown anchor is SECTION_NOT_FOUND, with the call that would have worked', async () => {
    await index('doc.md', page);
    const err = await updateSection(deps(), { anchor: 'deadbeef', content: 'x' }, 'agent').catch((e) => e);
    expect(err.code).toBe('SECTION_NOT_FOUND');
    expect(err.hint).toContain('list_sections');
  });

  it('honours expectedHash against the PAGE, because a section has no version of its own', async () => {
    await index('doc.md', page);
    const err = await updateSection(
      deps(),
      { anchor: anchorOf('Alpha'), content: 'x', expectedHash: 'b'.repeat(64) },
      'agent',
    ).catch((e) => e);
    expect(err.code).toBe('PAGE_CONFLICT');
    expect((await pages.read('doc.md')).body).toContain('ALPHA BODY');
  });
});
