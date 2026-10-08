import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PagesService } from './pages.js';
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

  it('reads and writes .mdx, still rejects non-markdown paths', async () => {
    const read = await pages.read('b.mdx');
    expect(read.body).toContain('<Callout>hi</Callout>');
    await pages.write('d.mdx', { body: '# D\n' });
    expect(await pages.exists('d.mdx')).toBe(true);
    await expect(pages.read('notes.txt')).rejects.toThrow(/\.md/);
  });
});
