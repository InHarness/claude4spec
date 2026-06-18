import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PagesService } from './pages.js';
import type { PageNode } from '../../shared/types.js';

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
    pages = new PagesService(cwd);
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
