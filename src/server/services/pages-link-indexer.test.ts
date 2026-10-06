import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PagesLinkIndexerService, parseLinks, rewritePageCitations } from './pages-link-indexer.js';
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

describe('the #anchor suffix is the canonical anchor id', () => {
  /**
   * 0.2.89 — anchors are minted from `[a-z0-9]`, 8 long, and hand-written ones
   * run 6–12. The suffix used to be 8 hex digits, so `kkz1e7d6` was not an anchor
   * to the link parser and a cited section dropped out of the edge.
   */
  it('captures a minted (non-hex) anchor in all three spellings', () => {
    const { candidates } = parseLinks('@a.md#kkz1e7d6 and `b.md#m21chatcols` and [x](c.md#q3v8n1zt)');
    expect(candidates.map((c) => [c.syntax, c.targetPath, c.anchor])).toEqual([
      ['link', 'c.md', 'q3v8n1zt'],
      ['backticks', 'b.md', 'm21chatcols'],
      ['at', 'a.md', 'kkz1e7d6'],
    ]);
  });

  it('does not take a longer word as a truncated anchor', () => {
    const { candidates } = parseLinks('@a.md#thisistoolongforananchor');
    expect(candidates[0]!.anchor).toBeUndefined();
  });

  it('preserves a minted anchor across a rename', () => {
    expect(rewritePageCitations('@a.md#kkz1e7d6 `a.md#m21chatcols` [y](a.md#q3v8n1zt)', 'a.md', 'b.md')).toBe(
      '@b.md#kkz1e7d6 `b.md#m21chatcols` [y](b.md#q3v8n1zt)',
    );
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

/**
 * 2.1.8 — `@path.md` resolves across EVERY page root in scope, with precedence
 * source root → builtin root → the rest in `roots[]` (Map) order. A resolved
 * link records where it landed (`targetRootId`), and the reverse index is keyed
 * by that TARGET root.
 */
describe('cross-root resolution (2.1.8)', () => {
  let cwd: string;
  let runtime: FileWatchRuntime;
  let services: Map<string, PagesService>;
  let indexer: PagesLinkIndexerService;

  /**
   * Map order is deliberately a, b, c, pages — the builtin root LAST — so that
   * "builtin before the rest" is distinguishable from plain Map order.
   */
  const ROOT_IDS = ['a', 'b', 'c', 'pages'] as const;
  const SCOPE: WatchScope = 'context:cross-root-rig';

  beforeEach(async () => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cross-root-'));
    runtime = new FileWatchRuntime({ fsEvents: false });
    services = new Map();
    for (const id of ROOT_IDS) {
      const svc = new PagesService(cwd, id, id);
      await svc.ensureRoot();
      runtime.mountSource({ source: `pages:${id}`, dir: svc.root, scope: SCOPE });
      svc.records = new RecordStore<MarkdownRecord>({
        registrar: runtime.scoped(SCOPE),
        source: `pages:${id}`,
        dir: svc.root,
        adapter: markdownAdapter,
      });
      services.set(id, svc);
    }
    indexer = new PagesLinkIndexerService(services, { broadcast: () => {} } as never, undefined, {
      builtinRootId: 'pages',
      rootDirs: new Map(ROOT_IDS.map((id) => [id, id])),
    });
  });

  afterEach(async () => {
    await runtime.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  function write(rootId: string, rel: string, body: string): void {
    fs.writeFileSync(path.join(services.get(rootId)!.root, rel), body, 'utf-8');
  }

  it('@x.md from root A resolves into root B when A lacks it, and the link carries targetRootId', async () => {
    write('a', 'src.md', '# Src\n\nsee @x.md here\n');
    write('b', 'x.md', '# X\n');
    await indexer.indexAll();

    expect(indexer.resolve('x.md', 'src.md', 'a')).toEqual({ rootId: 'b', path: 'x.md', anchor: undefined });
    const links = indexer.getLinks('a', 'src.md');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ targetRootId: 'b', targetPath: 'x.md', syntax: 'at' });
    expect(indexer.getUnresolved('a', 'src.md')).toEqual([]);
    // The reverse index is keyed by the TARGET root.
    expect(indexer.getReverseLinks('b', 'x.md')).toEqual(['a:src.md']);
    expect(indexer.getReverseLinks('a', 'x.md')).toEqual([]);
  });

  it('a target in a root that comes BEFORE the source in map order resolves too', async () => {
    write('c', 'src.md', '# Src\n\nsee @y.md#kkz1e7d6\n');
    write('a', 'y.md', '# Y\n');
    await indexer.indexAll();

    expect(indexer.getLinks('c', 'src.md')[0]).toMatchObject({ targetRootId: 'a', targetPath: 'y.md', anchor: 'kkz1e7d6' });
  });

  it('[ac:ac-resolve-i-autocomplete-path-md-sa-ogran] precedence: the source root wins, then the builtin root, then map order', async () => {
    for (const id of ROOT_IDS) write(id, 'x.md', `# X in ${id}\n`);
    await indexer.indexAll();

    // Source root first — every root has it, `c` keeps its own.
    expect(indexer.resolve('x.md', 'src.md', 'c')?.rootId).toBe('c');
    // Root `a` lacks it below: the builtin `pages` beats `b`, though `b` is earlier in the map.
    fs.rmSync(path.join(services.get('a')!.root, 'x.md'));
    indexer.handleUnlink('a', 'x.md');
    expect(indexer.resolve('x.md', 'src.md', 'a')?.rootId).toBe('pages');
    // Without the builtin, map order decides: `b` before `c`.
    fs.rmSync(path.join(services.get('pages')!.root, 'x.md'));
    indexer.handleUnlink('pages', 'x.md');
    expect(indexer.resolve('x.md', 'src.md', 'a')?.rootId).toBe('b');
    // A source outside every root (an artifact) starts at the builtin root.
    write('pages', 'x.md', '# X back\n');
    await indexer.onChange(SCOPE, 'pages:pages', 'x.md');
    expect(indexer.resolve('x.md', 'plan.md', null)?.rootId).toBe('pages');
  });

  it('the resolved link of an indexed page follows the same precedence', async () => {
    write('a', 'src.md', '# Src\n\n@x.md\n');
    write('b', 'x.md', '# X in b\n');
    write('pages', 'x.md', '# X in pages\n');
    await indexer.indexAll();

    expect(indexer.getLinks('a', 'src.md')[0]).toMatchObject({ targetRootId: 'pages', targetPath: 'x.md' });
  });

  it('a CWD-relative spelling resolves through that root’s own dir', () => {
    write('b', 'z.md', '# Z\n');
    return indexer.indexAll().then(() => {
      expect(indexer.resolve('b/z.md', 'src.md', 'a')).toMatchObject({ rootId: 'b', path: 'z.md' });
    });
  });

  it('renameSync rewrites a citing page that lives in ANOTHER root', async () => {
    write('c', 'src.md', '# Src\n\nsee @x.md here\n');
    write('a', 'x.md', '# X\n');
    await indexer.indexAll();

    fs.renameSync(path.join(services.get('a')!.root, 'x.md'), path.join(services.get('a')!.root, 'x2.md'));
    const rewritten = await indexer.renameSync('a', 'x.md', 'x2.md');

    expect(rewritten).toEqual(['src.md']);
    expect(fs.readFileSync(path.join(services.get('c')!.root, 'src.md'), 'utf-8')).toContain('@x2.md');
  });
});
