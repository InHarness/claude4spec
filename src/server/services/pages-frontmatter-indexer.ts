/**
 * M21 / M02 (m02fmidx): in-memory index of YAML frontmatter for every markdown
 * file of every registry root whose kind selects `m02-frontmatter-indexer`
 * (2.1.8: pages, plans, briefs, patches). Provides synchronous lookups for:
 *   - `briefService.listBriefs()` (find by `frontmatter.type === 'brief'`)
 *   - any future module that wants to discover pages by frontmatter type
 *
 * 0.1.96: keyed by a dynamic `rootId` instead of the fixed pages/briefs/patches
 * triple; 2.1.8: that `rootId` is the registry entry's id (a pages root, or the
 * system roots `plans`/`briefs`/`patches`).
 * M36: the artifact-specific WS broadcast (briefs:changed/patches:changed) is
 * driven by a caller-supplied rootId → event map (`artifactRegistry`-derived),
 * not a hardcoded per-kind if/else — see `broadcastRootChange`.
 * 0.2.10 (M40): fed by one `projection` subscription per mounted source instead
 * of by every root's own watcher.
 */

import matter from 'gray-matter';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MarkdownFileStore } from './markdown-file-store.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { WatchOrigin, WatchSubscriber, WatchScope } from '../fs/watcher.js';
import { reactionRootId } from '../fs/sources.js';
import type { ReactionInput } from '../fs/reactions.js';

export interface FrontmatterRecord {
  rootId: string;
  frontmatter: Record<string, unknown>;
}

export interface FrontmatterFindOptions {
  rootId?: string;
}

/**
 * M02 frontmatter projection.
 *
 * 2.1.8 (m02fmidx): the definition `m02-frontmatter-indexer` (projection,
 * markdown only — a raw `.html` entry is skipped) is selected by the `pages`,
 * `plans`, `briefs` and `patches` kinds, so the root-registry implementor binds
 * it to the source of every root of those kinds — iterating the registry
 * explicitly, because M40 has no wildcards. A record's `rootId` is always the
 * registry entry's id. Its own 200 ms debounce is gone; the mount owns it.
 */
export class PagesFrontmatterIndexer implements WatchSubscriber {
  /** Composite key `${rootId}:${path}` so the same path can exist in multiple
   * roots without collision. */
  private byKey = new Map<string, FrontmatterRecord>();

  /**
   * @param roots resolver from rootId → MarkdownFileStore, covering every registry
   *   root whose kind selects `m02-frontmatter-indexer`.
   * @param artifactEvents M36: rootId → WS event kind to broadcast on change,
   *   built by the caller from `artifactRegistry` (`e.rootId -> e.changedEvent`).
   *   A rootId absent from this map (e.g. an ordinary page root) broadcasts
   *   nothing extra here — only the shared `pages:frontmatter-changed` event.
   */
  constructor(
    private roots: Map<string, MarkdownFileStore>,
    private ws: WsEmitter,
    private artifactEvents: Map<string, 'briefs:changed' | 'patches:changed' | 'plans:changed'> = new Map(),
  ) {}

  private rootFor(rootId: string): MarkdownFileStore | undefined {
    return this.roots.get(rootId);
  }

  /** Broadcast the artifact-specific change event (briefs:changed / patches:changed), if any. */
  private broadcastRootChange(rootId: string, relPath: string): void {
    const kind = this.artifactEvents.get(rootId);
    if (kind) this.ws.broadcast({ kind, path: relPath });
  }

  private key(rootId: string, relPath: string): string {
    return `${rootId}:${relPath}`;
  }

  /**
   * The record's `rootId` is the registry entry's id the L13 implementor passed
   * when binding `m02-frontmatter-indexer` to the root's source (`briefs`,
   * `patches`, `plans`, or a pages root's id) — the same value `file_version`
   * carries for the file.
   */
  async onChange(
    _scope: WatchScope,
    source: string,
    relPath: string,
    _origin?: WatchOrigin,
    input?: ReactionInput,
  ): Promise<void> {
    await this.indexPage(reactionRootId(source, input), relPath);
  }

  onUnlink(_scope: WatchScope, source: string, relPath: string, _origin?: WatchOrigin, input?: ReactionInput): void {
    this.handleUnlink(reactionRootId(source, input), relPath);
  }

  handleUnlink(rootId: string, relPath: string): void {
    const k = this.key(rootId, relPath);
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
