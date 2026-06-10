/**
 * M21 / M02 (m02fmidx): in-memory index of YAML frontmatter for every markdown
 * file under both `pagesDir` and `briefsDir`. Fed by both `PagesWatcher`
 * instances. Provides synchronous lookups for:
 *   - hidden-tree filter (`pagesRouter` excludes pages with `frontmatter.type === 'brief'`)
 *   - `briefService.listBriefs()` (find by `frontmatter.type === 'brief'`)
 *   - any future module that wants to discover pages by frontmatter type
 *
 * Pattern derived from `TodosIndexerService` / `PagesLinkIndexerService`:
 * debounced reindex per file, in-memory `Map<path, Record>`, WS broadcast.
 */

import matter from 'gray-matter';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PagesService } from './pages.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { PagesRootDir } from '../../shared/types.js';

export interface FrontmatterRecord {
  rootDir: PagesRootDir;
  frontmatter: Record<string, unknown>;
}

export interface FrontmatterFindOptions {
  rootDir?: PagesRootDir;
}

export class PagesFrontmatterIndexer {
  private debounceMs = 200;
  private pending = new Map<string, NodeJS.Timeout>();
  /** Composite key `${rootDir}:${path}` so the same path could theoretically
   * exist in both roots without collision (defensive — collision would be a
   * config-misconfiguration, but indexer must remain correct). */
  private byKey = new Map<string, FrontmatterRecord>();

  constructor(
    private pages: PagesService,
    private briefs: PagesService,
    private patches: PagesService,
    private ws: WsEmitter,
  ) {}

  private rootFor(rootDir: PagesRootDir): PagesService {
    if (rootDir === 'briefs') return this.briefs;
    if (rootDir === 'patches') return this.patches;
    return this.pages;
  }

  /** Broadcast the rootDir-specific change event (briefs:changed / patches:changed). */
  private broadcastRootChange(rootDir: PagesRootDir, relPath: string): void {
    if (rootDir === 'briefs') this.ws.broadcast({ kind: 'briefs:changed', path: relPath });
    else if (rootDir === 'patches') this.ws.broadcast({ kind: 'patches:changed', path: relPath });
  }

  private key(rootDir: PagesRootDir, relPath: string): string {
    return `${rootDir}:${relPath}`;
  }

  schedulePage(rootDir: PagesRootDir, relPath: string): void {
    const k = this.key(rootDir, relPath);
    const prev = this.pending.get(k);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this.pending.delete(k);
      this.indexPage(rootDir, relPath).catch((err) => {
        console.error(`[pages-frontmatter-indexer] failed to index ${rootDir}:${relPath}:`, err);
      });
    }, this.debounceMs);
    this.pending.set(k, timer);
  }

  handleUnlink(rootDir: PagesRootDir, relPath: string): void {
    const k = this.key(rootDir, relPath);
    const prev = this.pending.get(k);
    if (prev) {
      clearTimeout(prev);
      this.pending.delete(k);
    }
    if (this.byKey.delete(k)) {
      this.ws.broadcast({ kind: 'pages:frontmatter-changed', path: relPath, rootDir });
      this.broadcastRootChange(rootDir, relPath);
    }
  }

  async indexAll(): Promise<void> {
    let count = 0;
    for (const rootDir of ['pages', 'briefs', 'patches'] as const) {
      const svc = this.rootFor(rootDir);
      const files = await svc.listMarkdownFiles();
      for (const rel of files) {
        await this.indexPage(rootDir, rel, { silent: true });
        count++;
      }
    }
    console.log(`[pages-frontmatter-indexer] indexed ${count} files`);
  }

  async indexPage(
    rootDir: PagesRootDir,
    relPath: string,
    opts: { silent?: boolean } = {},
  ): Promise<void> {
    const svc = this.rootFor(rootDir);
    const k = this.key(rootDir, relPath);
    let frontmatter: Record<string, unknown>;
    try {
      const abs = path.join(svc.root, relPath);
      const raw = await fs.readFile(abs, 'utf-8');
      const parsed = matter(raw);
      frontmatter = (parsed.data ?? {}) as Record<string, unknown>;
    } catch {
      // File disappeared between schedule and read — treat as unlink.
      if (this.byKey.delete(k) && !opts.silent) {
        this.ws.broadcast({ kind: 'pages:frontmatter-changed', path: relPath, rootDir });
        this.broadcastRootChange(rootDir, relPath);
      }
      return;
    }
    const prev = this.byKey.get(k);
    const changed = !prev || !sameFrontmatter(prev.frontmatter, frontmatter);
    this.byKey.set(k, { rootDir, frontmatter });
    if (changed && !opts.silent) {
      this.ws.broadcast({ kind: 'pages:frontmatter-changed', path: relPath, rootDir });
      this.broadcastRootChange(rootDir, relPath);
    }
  }

  getFrontmatter(rootDir: PagesRootDir, relPath: string): Record<string, unknown> | null {
    return this.byKey.get(this.key(rootDir, relPath))?.frontmatter ?? null;
  }

  /**
   * Find paths whose frontmatter has `type === <type>`. Optionally restrict
   * to a single rootDir (defaults to all). Returns sorted by path.
   */
  findByFrontmatterType(
    type: string,
    opts: FrontmatterFindOptions = {},
  ): Array<{ rootDir: PagesRootDir; path: string; frontmatter: Record<string, unknown> }> {
    const out: Array<{ rootDir: PagesRootDir; path: string; frontmatter: Record<string, unknown> }> = [];
    for (const [k, rec] of this.byKey) {
      if (opts.rootDir && rec.rootDir !== opts.rootDir) continue;
      if (rec.frontmatter.type !== type) continue;
      const colonIx = k.indexOf(':');
      const relPath = k.slice(colonIx + 1);
      out.push({ rootDir: rec.rootDir, path: relPath, frontmatter: rec.frontmatter });
    }
    out.sort((a, b) => a.path.localeCompare(b.path));
    return out;
  }
}

function sameFrontmatter(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) if (ak[i] !== bk[i]) return false;
  for (const key of ak) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
  }
  return true;
}
