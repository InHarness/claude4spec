import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MarkdownFileStore, PagesService } from './pages.js';
import type { PageNode } from '../../shared/types.js';
import { PAGES_KIND, fileMapEntryOf } from '../../shared/root-kinds.js';

function flatten(nodes: PageNode[]): PageNode[] {
  return nodes.flatMap((n) => (n.type === 'folder' && n.children ? [n, ...flatten(n.children)] : [n]));
}

describe('PagesService — .mdx discovery (M02 e16qvg1n)', () => {
  let cwd: string;
  let pages: PagesService;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-pages-'));
    const root = path.join(cwd, 'pages');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'a.md'), '# A\n');
    await fs.writeFile(path.join(root, 'b.mdx'), '# B\n<Callout>hi</Callout>\n');
    await fs.writeFile(path.join(root, 'c.html'), '<p>c</p>\n');
    await fs.writeFile(path.join(root, 'notes.txt'), 'ignored\n');
    pages = new PagesService(cwd, 'pages', 'pages');
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('lists .mdx in the tree as fileType "markdown" (DTO unchanged)', async () => {
    const files = flatten(await pages.listTree()).filter((n) => n.type === 'file');
    const byPath = new Map(files.map((n) => [n.path, n]));
    expect(byPath.get('b.mdx')?.fileType).toBe('markdown');
    expect(byPath.get('a.md')?.fileType).toBe('markdown');
    expect(byPath.get('c.html')?.fileType).toBe('html');
    expect(byPath.has('notes.txt')).toBe(false);
  });

  it('2.1.8 — a tree file\'s fileType follows the `pages` kind\'s file-map entry (markdown → "markdown", raw .html → "html"); nested entries too, dot subtrees skipped', async () => {
    const root = path.join(cwd, 'pages');
    await fs.mkdir(path.join(root, 'sub'), { recursive: true });
    await fs.writeFile(path.join(root, 'sub', 'deep.mdx'), '# Deep\n');
    await fs.writeFile(path.join(root, 'sub', 'deep.html'), '<p>d</p>\n');
    await fs.mkdir(path.join(root, '.drafts'), { recursive: true });
    await fs.writeFile(path.join(root, '.drafts', 'hidden.md'), '# H\n');

    const files = flatten(await pages.listTree()).filter((n) => n.type === 'file');
    for (const f of files) {
      const entry = fileMapEntryOf(PAGES_KIND, f.path);
      expect(entry, f.path).toBeDefined();
      expect(f.fileType).toBe(entry!.format === 'markdown' ? 'markdown' : 'html');
    }
    const byPath = new Map(files.map((n) => [n.path, n]));
    expect(byPath.get('sub/deep.mdx')?.fileType).toBe('markdown');
    expect(byPath.get('sub/deep.html')?.fileType).toBe('html');
    expect(fileMapEntryOf(PAGES_KIND, 'sub/deep.html')).toMatchObject({ format: 'raw', track: 'none' });
    expect([...byPath.keys()].some((p) => p.startsWith('.drafts'))).toBe(false);
    // The raw entry is in the tree but is not a page.
    expect(await pages.listMarkdownFiles()).not.toContain('sub/deep.html');
  });

  it('includes .mdx in listMarkdownFiles (feeds search + M06 reindex), excludes .html/.txt', async () => {
    const md = await pages.listMarkdownFiles();
    expect(md.sort()).toEqual(['a.md', 'b.mdx']);
  });

  it('[section:e16qvg1n] [section:m02multidir] [section:l13model0] 2.1.14 — the root tree (listTree) carries markdown AND raw .html entries with their fileType, while the markdown listing (listMarkdownFiles, its read-only twin and search over it) returns markdown entries only', async () => {
    const root = path.join(cwd, 'pages');
    await fs.mkdir(path.join(root, 'sub'), { recursive: true });
    await fs.writeFile(path.join(root, 'sub', 'mock.html'), '<p>needle</p>\n');
    await fs.writeFile(path.join(root, 'sub', 'page.md'), '# needle\n');
    // A registry-built root: the bare primitive with its kind, under the facade.
    const store = new MarkdownFileStore({ cwd, dir: 'pages', rootId: 'pages', kind: PAGES_KIND });
    const facade = new PagesService({ root: { id: 'pages', dir: 'pages' }, store });

    // The tree: both entry kinds, discriminated by fileType from the kind's file map.
    const tree = flatten(await facade.listTree()).filter((n) => n.type === 'file');
    const byPath = new Map(tree.map((n) => [n.path, n.fileType]));
    expect(byPath.get('c.html')).toBe('html');
    expect(byPath.get('sub/mock.html')).toBe('html');
    expect(byPath.get('a.md')).toBe('markdown');
    expect(byPath.get('b.mdx')).toBe('markdown');
    expect(byPath.get('sub/page.md')).toBe('markdown');

    // The listing: markdown entries only — the same set on the store and the facade.
    const expected = ['a.md', 'b.mdx', 'sub/page.md'];
    expect((await store.listMarkdownFiles()).sort()).toEqual(expected);
    expect((await facade.listMarkdownFiles()).sort()).toEqual(expected);
    expect((await facade.listMarkdownFilesReadonly()).sort()).toEqual(expected);
    // Every listed path is a markdown entry of the map; no raw entry leaks in.
    for (const rel of await facade.listMarkdownFiles()) {
      expect(fileMapEntryOf(PAGES_KIND, rel)?.format, rel).toBe('markdown');
    }
    // Page search walks the listing, so the raw entry's content is never read.
    const hits = await facade.search('needle');
    expect(hits.map((h) => h.path)).toEqual(['sub/page.md']);
  });

  it('[section:m30l13rt] 2.1.14 — in EVERY pages root the .html preview entry comes from that root\'s tree (fileType "html"), never from the markdown listing', async () => {
    await fs.mkdir(path.join(cwd, 'docs'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'docs', 'report.html'), '<p>adr</p>\n');
    await fs.writeFile(path.join(cwd, 'docs', 'adr.md'), '# ADR\n');
    const roots = [
      { id: 'pages', dir: 'pages' },
      { id: 'docs', dir: 'docs' },
    ];
    for (const r of roots) {
      const svc = new PagesService({
        root: r,
        store: new MarkdownFileStore({ cwd, dir: r.dir, rootId: r.id, kind: PAGES_KIND }),
      });
      const htmlInTree = flatten(await svc.listTree())
        .filter((n) => n.type === 'file' && n.fileType === 'html')
        .map((n) => n.path);
      expect(htmlInTree.length, r.id).toBeGreaterThan(0);
      const listed = await svc.listMarkdownFiles();
      for (const p of htmlInTree) expect(listed, `${r.id}:${p}`).not.toContain(p);
    }
  });

  it('reads and writes .mdx, still rejects non-markdown paths', async () => {
    const read = await pages.read('b.mdx');
    expect(read.body).toContain('<Callout>hi</Callout>');
    await pages.write('d.mdx', { body: '# D\n' });
    expect(await pages.exists('d.mdx')).toBe(true);
    await expect(pages.read('notes.txt')).rejects.toThrow(/\.md/);
  });
});
