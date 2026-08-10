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

  it('create_page answers with the page identity and its anchors, never its content', async () => {
    const res = await createPage(target, { path: 'made.md', content: '# A\n\nlots of text\n' }, 'agent');
    expect(Object.keys(res).sort()).toEqual(['anchors', 'hash', 'path', 'rootId']);
    expect(res.rootId).toBe('pages');
    expect(res.path).toBe('made.md');
    expect(JSON.stringify(res)).not.toContain('lots of text');
  });

  it('update_page answers with the delta, and echoes neither body nor frontmatter', async () => {
    const res = await updatePage(
      target,
      { path: 'u.md', body: '# A\n\nSECRET CONTENT\n', frontmatter: { order: 1 } },
      'user',
    );
    expect(Object.keys(res).sort()).toEqual(['changedAnchors', 'hash', 'version']);
    // `path` is gone too: the caller named it in the request a moment ago.
    expect(res).not.toHaveProperty('path');
    expect(JSON.stringify(res)).not.toContain('SECRET CONTENT');
    expect(JSON.stringify(res)).not.toContain('order');
  });

  it('reports version 0 rather than failing when there is no capture to read', async () => {
    // The hand-rolled rigs have no db, and in production a capture failure is
    // warned and swallowed. A write must not fail because its bookkeeping did.
    const res = await updatePage(target, { path: 'v.md', body: 'x' }, 'user');
    expect(res.version).toBe(0);
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

  it('[ac:ac-crud-stron-dziala-przez-ui-i-wbudowane-n] the hash get_page returns is the one update_page accepts', async () => {
    /**
     * The guard is only real if the read side can produce its input, and it
     * could not: `GetPageResult` was `{rootId, path, content}` with no hash, so
     * an agent — the caller item 28 funnels ALL page writes through — had no way
     * to obtain one and every agent write was last-write-wins over whatever a
     * human had just saved in the editor.
     *
     * Asserted end-to-end through the real core rather than by comparing two
     * digest calls, because the failure would be a hash of the WRONG bytes
     * (the body without frontmatter, or a truncated window) — which a
     * same-function comparison cannot see.
     */
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-hash-rt-'));
    const db = createTestDb();
    try {
      const pagesSvc = new PagesService(dir, 'pages', 'pages');
      await pagesSvc.ensureRoot();
      const t = { pages: pagesSvc, writer: null };
      await updatePage(t, { path: 'h.md', body: '# Hello', frontmatter: { order: 1 } }, 'user');

      const core = createDiscoveryCore({
        reader: new RawEntityReader(db, host),
        db,
        host,
        serialization: new SerializationEngine(host, sectionSerializer),
        roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true, ...DEFAULT_PAGES_ROOT_PROPS }],
        projectDir: dir,
        packageVersion: 'test',
      });
      const read = await core.getPage({ rootId: 'pages', path: 'h.md' });
      expect(read.hash).toHaveLength(64);

      // Accepted — so the round-trip an agent must perform actually closes.
      await expect(
        updatePage(t, { path: 'h.md', body: '# Hello again', expectedHash: read.hash }, 'agent'),
      ).resolves.toBeTruthy();
      // …and the SAME hash is now stale, which is the other half of the contract.
      const err = await updatePage(t, { path: 'h.md', body: 'x', expectedHash: read.hash }, 'agent').catch(
        (e) => e,
      );
      expect(err.code).toBe('PAGE_CONFLICT');
    } finally {
      db.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('an ABSENT page is not a conflict — update_page doubles as create', async () => {
    // The editor saves a brand-new page through this path with a hash it got
    // from nowhere; there is no earlier state for it to be stale against.
    // The write is ACCEPTED — asserted on the hash rather than on a path, which
    // the answer no longer carries: a write reports what changed, not the page.
    const written = await updatePage(
      target,
      { path: 'new.md', body: 'x', expectedHash: 'a'.repeat(64) },
      'user',
    );
    expect(written.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await pages.exists('new.md')).toBe(true);
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
    expect(await deletePage(target, { path: 'gone.md' }, 'agent')).toEqual({ ok: true, deleted: true });
    expect(target.writer.calls).toEqual([
      { op: 'markOrigin', relPath: 'gone.md', actor: 'agent' },
      { op: 'flush:unlink', relPath: 'gone.md' },
    ]);
    expect(await pages.exists('gone.md')).toBe(false);
  });

  it('deleting an ALREADY-DELETED page succeeds — the catalog calls this operation idempotent', async () => {
    /**
     * Without the existence check this reached `fs.unlink`, threw a raw ENOENT
     * and came back 500 INTERNAL — a server-fault status for the one case where
     * retrying can never help, and the case a client hits precisely BY
     * retrying after a timeout. `idempotent: true` in the catalog row has to be
     * a fact about the code, not a hope.
     */
    await createPage(target, { path: 'twice.md', content: 'x' }, 'user');
    await deletePage(target, { path: 'twice.md' }, 'user');
    target.writer.calls.length = 0;

    expect(await deletePage(target, { path: 'twice.md' }, 'user')).toEqual({ ok: true, deleted: false });
    // …and it does not label a write that never happened: a `markOrigin` with no
    // write behind it leaves the watcher expecting an event that never arrives.
    expect(target.writer.calls).toEqual([]);
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

  it('answers with what changed, and never with the section or the page', async () => {
    /**
     * The whole point of the echo-free rule, at its sharpest: an agent that
     * rewrote one paragraph used to get the entire page back — text it had in
     * context a moment earlier, returned at its own expense.
     */
    await index('doc.md', page);
    const anchor = anchorOf('Alpha');
    const res = await updateSection(deps(), { anchor, content: 'REWRITTEN\n' }, 'agent');

    expect(Object.keys(res).sort()).toEqual(['affectedAnchors', 'anchor', 'hash', 'version']);
    expect(res).not.toHaveProperty('body');
    expect(res).not.toHaveProperty('frontmatter');
    // `rootId` and `pagePath` are gone too: the caller addressed the section by
    // anchor and already knows where it sent the edit.
    expect(res).not.toHaveProperty('rootId');
    expect(res).not.toHaveProperty('pagePath');
    expect(JSON.stringify(res)).not.toContain('REWRITTEN');
    expect(JSON.stringify(res)).not.toContain('BETA BODY');
  });

  it('reports the siblings an edit disturbed, without repeating the edited anchor', async () => {
    await index('doc.md', page);
    const alpha = anchorOf('Alpha');
    // Editing Alpha's body leaves Beta's own text untouched, so nothing else
    // moved: an anchor list is a delta, not "every anchor on the page".
    const quiet = await updateSection(deps(), { anchor: alpha, content: 'REWRITTEN\n' }, 'agent');
    expect(quiet.affectedAnchors).toEqual([]);
    expect(quiet.anchor).toBe(alpha);

    // An edit that swallows a nested section DOES change the anchor set, and a
    // disappearing anchor is the change a caller is least able to infer: every
    // `<section_ref/>` pointing at it has just been orphaned.
    // Distinct heading text: `anchorOf` looks a section up by heading across the
    // whole index, so reusing "Alpha" here would address the OTHER page's.
    await index('nested.md', ['# Root', '', '## Outer', '', 'A', '', '### Inner', '', 'I', ''].join('\n'));
    const outer = anchorOf('Outer');
    const inner = anchorOf('Inner');
    const shrunk = await updateSection(deps(), { anchor: outer, content: 'JUST A\n' }, 'agent');
    expect(shrunk.affectedAnchors).toContain(inner);
    expect(shrunk.affectedAnchors).not.toContain(outer);
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

  it('edits the right section when the INDEX is behind the file and no hash was given', async () => {
    /**
     * The corruption case, and the reason the range is recomputed from the bytes
     * rather than trusted from the row.
     *
     * `section_index` is watcher-maintained, so it always trails the file by
     * however long a reaction takes; a `git checkout`, a hand edit or an
     * in-flight editor save moves every boundary below it. Two lines are
     * prepended here WITHOUT re-indexing, which shifts both sections down by two
     * while leaving the stale range comfortably in bounds — so a bounds check
     * passes and the splice lands two lines high, eating the tail of what
     * precedes it and the heading of what follows.
     *
     * `expectedHash` would catch it, and is optional in all three channels by
     * deliberate decision, so it cannot be the thing this rests on. No hash is
     * passed here on purpose.
     */
    await index('doc.md', page);
    const alpha = anchorOf('Alpha');
    const before = db.prepare('SELECT line_start, line_end FROM section_index WHERE anchor = ?').get(alpha) as {
      line_start: number;
      line_end: number;
    };

    const shifted = ['PREAMBLE', '', (await pages.read('doc.md')).body].join('\n');
    await pages.write('doc.md', { body: shifted });
    // The row still describes the pre-shift file — that is the whole premise.
    const after = db.prepare('SELECT line_start, line_end FROM section_index WHERE anchor = ?').get(alpha) as {
      line_start: number;
      line_end: number;
    };
    expect(after).toEqual(before);

    await updateSection(deps(), { anchor: alpha, content: 'REWRITTEN' }, 'agent');

    const body = (await pages.read('doc.md')).body;
    expect(body).toContain('REWRITTEN');
    expect(body).not.toContain('ALPHA BODY');
    // Everything the stale range would have swallowed is still there.
    expect(body).toContain('PREAMBLE');
    expect(body).toContain('# Top');
    expect(body).toContain('## Alpha');
    expect(body).toContain('## Beta');
    expect(body).toContain('BETA BODY');
  });

  it('refuses PAGE_CONFLICT when the anchor is gone from the file entirely', async () => {
    // The other direction of staleness: the row survives, its anchor does not.
    // Nothing in the file identifies the section any more, so there is no
    // defensible place to splice.
    await index('doc.md', page);
    const alpha = anchorOf('Alpha');
    await pages.write('doc.md', { body: '# Top\n\nrewritten by hand, anchors dropped\n' });
    const err = await updateSection(deps(), { anchor: alpha, content: 'x' }, 'agent').catch((e) => e);
    expect(err.code).toBe('PAGE_CONFLICT');
    expect((await pages.read('doc.md')).body).toContain('rewritten by hand');
  });

  it('a section indexed on a DELETED page is SECTION_NOT_FOUND, not a 500', async () => {
    /**
     * `assertUnchanged` reads an unreadable file as "no conflict" — correct for
     * `update_page`, which doubles as create — and this operation then read the
     * page unconditionally. A caller that passed `expectedHash`, i.e. did
     * everything right, sailed past the guard into a raw ENOENT, which is not a
     * `DomainError` and so rendered as 500 INTERNAL: the server reporting its own
     * fault for a request that can never succeed, to a client whose 5xx branch
     * says retry.
     */
    await index('doc.md', page);
    const alpha = anchorOf('Alpha');
    const hash = await (async () => {
      const { createHash } = await import('node:crypto');
      return createHash('sha256')
        .update(await fs.readFile(path.join(cwd, 'pages', 'doc.md'), 'utf-8'), 'utf-8')
        .digest('hex');
    })();
    await fs.rm(path.join(cwd, 'pages', 'doc.md'));

    for (const input of [{ anchor: alpha, content: 'x' }, { anchor: alpha, content: 'x', expectedHash: hash }]) {
      const err = await updateSection(deps(), input, 'agent').catch((e) => e);
      expect(err.code).toBe('SECTION_NOT_FOUND');
      expect(err.hint).toContain('list_sections');
    }
  });
});
