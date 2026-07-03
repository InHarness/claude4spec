import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PagesService } from './pages.js';
import { PagesLinkIndexerService } from './pages-link-indexer.js';
import type { WsEmitter } from '../ws/project-emitter.js';

const ws: WsEmitter = { broadcast: () => {} };

async function build(dir: string, seed: (root: string) => Promise<void>): Promise<PagesLinkIndexerService> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-plink-'));
  const root = path.join(cwd, dir);
  await fs.mkdir(root, { recursive: true });
  await seed(root);
  const pages = new PagesService(cwd, dir, 'pages');
  const indexer = new PagesLinkIndexerService(new Map([['pages', pages]]), ws);
  await indexer.indexAll();
  // Stash cwd on the instance so callers can clean up.
  (indexer as unknown as { __cwd: string }).__cwd = cwd;
  return indexer;
}

async function cleanup(indexer: PagesLinkIndexerService): Promise<void> {
  const cwd = (indexer as unknown as { __cwd?: string }).__cwd;
  if (cwd) await fs.rm(cwd, { recursive: true, force: true });
}

describe('PagesLinkIndexerService.resolve — CWD-relative fallback (M14 0.1.100 step 3b)', () => {
  let indexer: PagesLinkIndexerService | undefined;
  afterEach(async () => {
    if (indexer) await cleanup(indexer);
    indexer = undefined;
  });

  it("dir='.' — root-relative @reference/x.md resolves (unchanged; CWD-relative form is identical)", async () => {
    indexer = await build('.', async (root) => {
      await fs.mkdir(path.join(root, 'reference'), { recursive: true });
      await fs.writeFile(path.join(root, 'reference', 'x.md'), '# X\n');
      await fs.writeFile(path.join(root, 'index.md'), 'See @reference/x.md for details.\n');
    });

    const links = indexer.allLinks()['pages:index.md'] ?? [];
    expect(links.map((l) => l.targetPath)).toEqual(['reference/x.md']);
    expect(indexer.allUnresolved()['pages:index.md']).toBeUndefined();
    expect(indexer.counts().unresolvedMentionCount).toBe(0);
  });

  it("dir='pages' — @pages/reference/x.md and @reference/x.md both resolve to the same page", async () => {
    indexer = await build('pages', async (root) => {
      await fs.mkdir(path.join(root, 'reference'), { recursive: true });
      await fs.writeFile(path.join(root, 'reference', 'x.md'), '# X\n');
      await fs.writeFile(
        path.join(root, 'index.md'),
        'CWD form @pages/reference/x.md\nRoot form @reference/x.md\n',
      );
    });

    const links = indexer.allLinks()['pages:index.md'] ?? [];
    // Both mentions resolve, both to the canonical root-relative targetPath.
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.targetPath)).toEqual(['reference/x.md', 'reference/x.md']);
    expect(indexer.allUnresolved()['pages:index.md']).toBeUndefined();
    expect(indexer.counts().unresolvedMentionCount).toBe(0);
    expect(indexer.counts().brokenLinkCount).toBe(0);
  });

  it("collision — a real file at relPath 'pages/x.md' wins root-relative (step 2), never reaching 3b", async () => {
    indexer = await build('pages', async (root) => {
      // File keyed 'pages/x.md' (double-nested dir segment).
      await fs.mkdir(path.join(root, 'pages'), { recursive: true });
      await fs.writeFile(path.join(root, 'pages', 'x.md'), '# X\n');
      await fs.writeFile(path.join(root, 'index.md'), 'Ambiguous @pages/x.md\n');
    });

    const links = indexer.allLinks()['pages:index.md'] ?? [];
    // Root-relative match wins: targetPath is the literal 'pages/x.md', not the 3b-stripped 'x.md'.
    expect(links.map((l) => l.targetPath)).toEqual(['pages/x.md']);
    expect(indexer.allUnresolved()['pages:index.md']).toBeUndefined();
  });
});
