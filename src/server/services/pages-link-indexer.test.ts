import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PagesLinkIndexerService, rewritePageCitations } from './pages-link-indexer.js';
import { PagesService } from './pages.js';
import { PROJECTION_IDS, ProjectionStatusRegistry } from './projection-status.js';
import { FileWatchRuntime, type WatchScope } from '../fs/watcher.js';
import { RecordStore } from '../fs/record-store.js';
import { markdownAdapter, type MarkdownRecord } from '../fs/record-adapters.js';

/**
 * M14 rename-sync (0.2.77) — the propagation, and the guard that stops it.
 *
 * The move primitive hands over BOTH paths explicitly, so nothing here infers a
 * rename from a pair of file events. That inference remains only for moves made
 * from outside the application.
 */
const RIG_SCOPE: WatchScope = 'context:link-rig';

describe('rewritePageCitations — the three spellings of one edge', () => {
  it('rewrites @mentions, backticked paths and markdown links together', () => {
    const src = 'see @a.md, `a.md`, [x](a.md) and @a.md#1a2b3c4d';
    expect(rewritePageCitations(src, 'a.md', 'b.md')).toBe(
      'see @b.md, `b.md`, [x](b.md) and @b.md#1a2b3c4d',
    );
  });

  it('preserves the section anchor — a move changes where a page lives, not which section was cited', () => {
    expect(rewritePageCitations('[y](a.md#deadbeef)', 'a.md', 'b.md')).toBe('[y](b.md#deadbeef)');
  });

  it('leaves near-misses alone', () => {
    // A rewrite that also caught `ab.md` would silently repoint citations of a
    // page nobody moved.
    const src = '@a.markdown and @ab.md and prefix-a.md';
    expect(rewritePageCitations(src, 'a.md', 'b.md')).toBe(src);
  });
});

describe('rename-sync', () => {
  let cwd: string;
  let pages: PagesService;
  let runtime: FileWatchRuntime;
  let indexer: PagesLinkIndexerService;
  let status: ProjectionStatusRegistry;

  beforeEach(async () => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-rename-sync-'));
    pages = new PagesService(cwd, 'pages', 'pages');
    await pages.ensureRoot();
    runtime = new FileWatchRuntime({ fsEvents: false });
    runtime.mountSource({ source: 'pages:pages', dir: pages.root, scope: RIG_SCOPE });
    pages.records = new RecordStore<MarkdownRecord>({
      registrar: runtime.scoped(RIG_SCOPE),
      source: 'pages:pages',
      dir: pages.root,
      adapter: markdownAdapter,
    });
    status = new ProjectionStatusRegistry();
    indexer = new PagesLinkIndexerService(new Map([['pages', pages]]), { broadcast: () => {} } as never, status);
  });

  afterEach(async () => {
    await runtime.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  function write(rel: string, body: string): void {
    fs.writeFileSync(path.join(pages.root, rel), body, 'utf-8');
  }

  it('[ac:ac-przeniesienie-strony-wykonane-przez-a] rewrites every citing page of the root, with no unlink+add pairing involved', async () => {
    write('a.md', '# A\n');
    write('one.md', '# One\n\npoints at @a.md here\n');
    write('two.md', '# Two\n\nand [also](a.md) plus `a.md`\n');
    write('unrelated.md', '# U\n\nnothing to see\n');
    await indexer.indexAll();

    // The move already happened; rename-sync is handed BOTH paths outright.
    fs.renameSync(path.join(pages.root, 'a.md'), path.join(pages.root, 'b.md'));
    const rewritten = await indexer.renameSync('pages', 'a.md', 'b.md');

    expect(rewritten.sort()).toEqual(['one.md', 'two.md']);
    expect(fs.readFileSync(path.join(pages.root, 'one.md'), 'utf-8')).toContain('@b.md');
    const two = fs.readFileSync(path.join(pages.root, 'two.md'), 'utf-8');
    expect(two).toContain('[also](b.md)');
    expect(two).toContain('`b.md`');
    // A page that never cited it is not rewritten at all — no spurious commit,
    // no spurious version row.
    expect(fs.readFileSync(path.join(pages.root, 'unrelated.md'), 'utf-8')).toBe('# U\n\nnothing to see\n');
  });

  it('[ac:ac-rename-sync-wywolany-przy-oznaczonej] aborts before the FIRST write when the link projection is marked', async () => {
    write('a.md', '# A\n');
    write('one.md', '# One\n\npoints at @a.md here\n');
    write('two.md', '# Two\n\nalso @a.md\n');
    await indexer.indexAll();
    const before = {
      one: fs.readFileSync(path.join(pages.root, 'one.md'), 'utf-8'),
      two: fs.readFileSync(path.join(pages.root, 'two.md'), 'utf-8'),
    };

    /**
     * Marked on a page that is not even involved in this rename. The refusal is
     * still total, and deliberately so: `reverseIndex` aggregates over every
     * source, so one source that did not recompute makes the LIST OF PAGES TO
     * REWRITE itself unreliable — and rewriting from an unreliable list is how
     * citations get silently dropped.
     */
    status.markStale(PROJECTION_IDS.pageLinks, 'pages:something-else.md');

    await expect(indexer.renameSync('pages', 'a.md', 'b.md')).rejects.toMatchObject({
      code: 'INDEX_STALE',
    });

    // "Before the first write": the move is ABORTED, not half-applied. No source
    // file got rewritten links.
    expect(fs.readFileSync(path.join(pages.root, 'one.md'), 'utf-8')).toBe(before.one);
    expect(fs.readFileSync(path.join(pages.root, 'two.md'), 'utf-8')).toBe(before.two);
  });
});
