/**
 * M21 / M02 (m02fmidx): in-memory index of YAML frontmatter for every markdown
 * file across ALL page roots (`config.roots[]`) plus the briefs/patches
 * directories. Fed by every root's `PagesWatcher` plus the dedicated
 * briefs/patches watchers. Provides synchronous lookups for:
 *   - hidden-tree filter (`pagesRouter` excludes pages with `frontmatter.type === 'brief'`)
 *   - `briefService.listBriefs()` (find by `frontmatter.type === 'brief'`)
 *   - any future module that wants to discover pages by frontmatter type
 *
 * 0.1.96: keyed by a dynamic `rootId` (built-in 'pages' root, user root slugs,
 * and the 'brief'/'patch' markers) instead of the fixed pages/briefs/patches
 * triple.
 */

import matter from 'gray-matter';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PagesService } from './pages.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import { BRIEF_ROOT_MARKER, PATCH_ROOT_MARKER } from '../../shared/types.js';

export interface FrontmatterRecord {
  rootId: string;
  frontmatter: Record<string, unknown>;
}

export interface FrontmatterFindOptions {
  rootId?: string;
}

export class PagesFrontmatterIndexer {
  private debounceMs = 200;
  private pending = new Map<string, NodeJS.Timeout>();
  /** Composite key `${rootId}:${path}` so the same path can exist in multiple
   * roots without collision. */
  private byKey = new Map<string, FrontmatterRecord>();

  /**
   * @param roots resolver from rootId → PagesService, covering every page root
   *   plus the 'brief'/'patch' marker instances.
   */
  constructor(
    private roots: Map<string, PagesService>,
    private ws: WsEmitter,
  ) {}

  private rootFor(rootId: string): PagesService | undefined {
    return this.roots.get(rootId);
  }

  /** Broadcast the marker-specific change event (briefs:changed / patches:changed). */
  private broadcastRootChange(rootId: string, relPath: string): void {
    if (rootId === BRIEF_ROOT_MARKER) this.ws.broadcast({ kind: 'briefs:changed', path: relPath });
    else if (rootId === PATCH_ROOT_MARKER) this.ws.broadcast({ kind: 'patches:changed', path: relPath });
  }

  private key(rootId: string, relPath: string): string {
    return `${rootId}:${relPath}`;
  }

  schedulePage(rootId: string, relPath: string): void {
    const k = this.key(rootId, relPath);
    const prev = this.pending.get(k);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this.pending.delete(k);
      this.indexPage(rootId, relPath).catch((err) => {
        console.error(`[pages-frontmatter-indexer] failed to index ${rootId}:${relPath}:`, err);
      });
    }, this.debounceMs);
    this.pending.set(k, timer);
  }

  handleUnlink(rootId: string, relPath: string): void {
    const k = this.key(rootId, relPath);
    const prev = this.pending.get(k);
    if (prev) {
      clearTimeout(prev);
      this.pending.delete(k);
    }
    if (this.byKey.delete(k)) {
      this.ws.broadcast({ kind: 'pages:frontmatter-changed', path: relPath, rootId });
      this.broadcastRootChange(rootId, relPath);
    }
  }

  async indexAll(): Promise<void> {
    let count = 0;
    for (const [rootId, svc] of this.roots) {
      const files = await svc.listMarkdownFiles();
      for (const rel of files) {
        await this.indexPage(rootId, rel, { silent: true });
        count++;
      }
    }
    console.log(`[pages-frontmatter-indexer] indexed ${count} files`);
  }

  async indexPage(
    rootId: string,
    relPath: string,
    opts: { silent?: boolean } = {},
  ): Promise<void> {
    const svc = this.rootFor(rootId);
    if (!svc) return;
    const k = this.key(rootId, relPath);
    let frontmatter: Record<string, unknown>;
    try {
      const abs = path.join(svc.root, relPath);
      const raw = await fs.readFile(abs, 'utf-8');
      const parsed = matter(raw);
      frontmatter = (parsed.data ?? {}) as Record<string, unknown>;
    } catch {
      // File disappeared between schedule and read — treat as unlink.
      if (this.byKey.delete(k) && !opts.silent) {
        this.ws.broadcast({ kind: 'pages:frontmatter-changed', path: relPath, rootId });
        this.broadcastRootChange(rootId, relPath);
      }
      return;
    }
    const prev = this.byKey.get(k);
    const changed = !prev || !sameFrontmatter(prev.frontmatter, frontmatter);
    this.byKey.set(k, { rootId, frontmatter });
    if (changed && !opts.silent) {
      this.ws.broadcast({ kind: 'pages:frontmatter-changed', path: relPath, rootId });
      this.broadcastRootChange(rootId, relPath);
    }
  }

  getFrontmatter(rootId: string, relPath: string): Record<string, unknown> | null {
    return this.byKey.get(this.key(rootId, relPath))?.frontmatter ?? null;
  }

  /**
   * Find paths whose frontmatter has `type === <type>`. Optionally restrict
   * to a single rootId (defaults to all). Returns sorted by path.
   */
  findByFrontmatterType(
    type: string,
    opts: FrontmatterFindOptions = {},
  ): Array<{ rootId: string; path: string; frontmatter: Record<string, unknown> }> {
    const out: Array<{ rootId: string; path: string; frontmatter: Record<string, unknown> }> = [];
    for (const [k, rec] of this.byKey) {
      if (opts.rootId && rec.rootId !== opts.rootId) continue;
      if (rec.frontmatter.type !== type) continue;
      const colonIx = k.indexOf(':');
      const relPath = k.slice(colonIx + 1);
      out.push({ rootId: rec.rootId, path: relPath, frontmatter: rec.frontmatter });
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
