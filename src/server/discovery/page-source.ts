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

  /**
   * The file exactly as authored, frontmatter included.
   *
   * ONLY `get_page` may use this. Anything that deals in LINE NUMBERS must use
   * {@link readBody} instead — see the note there.
   */
  async read(rootId: string, relPath: string): Promise<string> {
    return await this.guard(rootId, relPath, () => this.service(rootId).readRaw(relPath));
  }

  /**
   * The page body with frontmatter stripped — the coordinate space every line
   * number in this project is expressed in.
   *
   * This distinction is load-bearing and easy to get wrong. `section-indexer.ts`
   * indexes `PagesService.read(...).body`, i.e. gray-matter has already removed
   * the frontmatter before `line_start`/`line_end` are computed. Reading the RAW
   * file and slicing it by those numbers silently shifts every result by the
   * height of the frontmatter block: a section comes back starting inside its
   * predecessor and missing its own tail, and a search hit reports a line that
   * points at the wrong text. The same applies to tag positions used by
   * `find_references` and `check_consistency`, which is the space the shared
   * reference core has always worked in.
   */
  async readBody(rootId: string, relPath: string): Promise<string> {
    return await this.guard(rootId, relPath, async () => (await this.service(rootId).read(relPath)).body);
  }

  private async guard(rootId: string, relPath: string, read: () => Promise<string>): Promise<string> {
    try {
      return await read();
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

  /**
   * Every page of every root the caller passes, read once — the shape reference
   * sweeps want. Bodies are frontmatter-stripped, matching both the section
   * index and what `pagesServiceSource` has always handed the reference core.
   */
  async readAll(roots: readonly Root[]): Promise<Array<{ rootId: string; path: string; body: string }>> {
    const out: Array<{ rootId: string; path: string; body: string }> = [];
    for (const root of roots) {
      if (!this.services.has(root.id)) continue;
      for (const rel of await this.list(root.id)) {
        try {
          out.push({ rootId: root.id, path: rel, body: await this.readBody(root.id, rel) });
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
