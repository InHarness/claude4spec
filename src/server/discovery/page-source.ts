/**
 * M39 — root-aware access to page files.
 *
 * Every read here is keyed by `(rootId, relPath)`. The source owns one
 * `PagesService` per root rather than reimplementing the walk and the
 * path-safety check: that service already refuses `\0`, non-markdown extensions,
 * dot-segments and any path that escapes its root, and duplicating those rules
 * is how one copy ends up laxer than the other.
 */

import type { Root } from '../../shared/types.js';
import { PagesService } from '../services/pages.js';
import { pageNotFound } from './errors.js';

export interface PageFile {
  rootId: string;
  path: string;
  title: string;
  size: number;
  mtimeMs: number;
}

export class PageSource {
  private readonly services = new Map<string, PagesService>();

  constructor(
    readonly projectDir: string,
    roots: readonly Root[],
  ) {
    for (const root of roots) {
      this.services.set(root.id, new PagesService(projectDir, root.dir, root.id));
    }
  }

  private service(rootId: string): PagesService {
    const svc = this.services.get(rootId);
    if (!svc) throw pageNotFound(rootId, '', [...this.services.keys()]);
    return svc;
  }

  async list(rootId: string): Promise<string[]> {
    return await this.service(rootId).listMarkdownFiles();
  }

  /** Listing + measurement in one pass, so a caller can size a root before pulling it. */
  async listWithStats(rootId: string): Promise<PageFile[]> {
    const svc = this.service(rootId);
    const rels = await svc.listMarkdownFiles();
    const out: PageFile[] = [];
    for (const rel of rels) {
      try {
        const st = await svc.stat(rel);
        out.push({ rootId, path: rel, title: titleOf(rel), size: st.size, mtimeMs: st.mtimeMs });
      } catch {
        // A file that vanished between listing and stat is simply not listed.
        // The alternative — failing the whole page listing — turns one racing
        // editor save into an outage of the operation.
      }
    }
    return out;
  }

  /** The file as authored. Throws `PAGE_NOT_FOUND` rather than a raw fs error. */
  async read(rootId: string, relPath: string): Promise<string> {
    try {
      return await this.service(rootId).readRaw(relPath);
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        throw pageNotFound(rootId, relPath, [...this.services.keys()]);
      }
      throw err;
    }
  }

  async exists(rootId: string, relPath: string): Promise<boolean> {
    return await this.service(rootId).exists(relPath);
  }

  /** Every page of every root the caller passes, read once — the shape reference sweeps want. */
  async readAll(roots: readonly Root[]): Promise<Array<{ rootId: string; path: string; body: string }>> {
    const out: Array<{ rootId: string; path: string; body: string }> = [];
    for (const root of roots) {
      if (!this.services.has(root.id)) continue;
      for (const rel of await this.list(root.id)) {
        try {
          out.push({ rootId: root.id, path: rel, body: await this.read(root.id, rel) });
        } catch {
          /* unreadable file — skipped, same reason as listWithStats */
        }
      }
    }
    return out;
  }
}

/** Cheap, deterministic display name. The real title lives in frontmatter or the H1;
 *  `list_pages` is a measurement operation, and neither is worth reading every file for. */
function titleOf(relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath;
  return base.replace(/\.mdx?$/, '');
}
