/**
 * 2.1.8 — a store built for a registry root serves only its kind's file map.
 *
 * The `plans` / `briefs` / `patches` maps are flat `*.md`, and the live reaction
 * filters (fileMapFilter) already see only those paths. The boot listing
 * (`indexAll` → `listMarkdownFiles`) and the artifact readers (`exists` →
 * NOT_FOUND, `readRaw`) must agree, or a nested / `.mdx` file is indexed at boot
 * but never re-indexed or captured afterwards. Out-of-map = invisible everywhere.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MarkdownFileStore } from './markdown-file-store.js';
import { systemRootDir, systemRootId } from '../../shared/root-kinds.js';

describe('MarkdownFileStore — the kind file map bounds what the store serves', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-mfs-'));
  });
  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  for (const kind of ['plans', 'briefs', 'patches'] as const) {
    it(`${kind}: a nested or .mdx file is absent from the listing, the readers and the writer`, async () => {
      const dir = systemRootDir(kind);
      const abs = path.join(cwd, dir);
      fs.mkdirSync(path.join(abs, 'nested'), { recursive: true });
      fs.writeFileSync(path.join(abs, 'top.md'), '# Top\n', 'utf8');
      fs.writeFileSync(path.join(abs, 'nested', 'deep.md'), '# Deep\n', 'utf8');
      fs.writeFileSync(path.join(abs, 'other.mdx'), '# Mdx\n', 'utf8');

      const store = new MarkdownFileStore({ cwd, dir, rootId: systemRootId(kind), kind });

      expect(await store.listMarkdownFiles()).toEqual(['top.md']);
      expect(await store.listMarkdownFilesReadonly()).toEqual(['top.md']);
      expect(await store.exists('top.md')).toBe(true);
      expect((await store.read('top.md')).body).toContain('# Top');

      for (const rel of ['nested/deep.md', 'other.mdx']) {
        expect(await store.exists(rel)).toBe(false);
        await expect(store.readRaw(rel)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(store.stat(rel)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(store.write(rel, { body: 'x' })).rejects.toThrow(/not an entry of the '.+' root's file map/);
      }
      // The refused write left the file on disk untouched.
      expect(fs.readFileSync(path.join(abs, 'nested', 'deep.md'), 'utf8')).toBe('# Deep\n');
    });
  }

  it('pages: the recursive `**/*.{md,mdx}` entry keeps nested and .mdx pages', async () => {
    fs.mkdirSync(path.join(cwd, 'pages', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'pages', 'top.md'), '# Top\n', 'utf8');
    fs.writeFileSync(path.join(cwd, 'pages', 'nested', 'deep.md'), '# Deep\n', 'utf8');
    fs.writeFileSync(path.join(cwd, 'pages', 'other.mdx'), '# Mdx\n', 'utf8');

    const store = new MarkdownFileStore({ cwd, dir: 'pages', rootId: 'pages', kind: 'pages' });

    expect((await store.listMarkdownFiles()).sort()).toEqual(['nested/deep.md', 'other.mdx', 'top.md']);
    expect(await store.exists('nested/deep.md')).toBe(true);
  });
});
