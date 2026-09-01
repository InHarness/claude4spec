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
import { invalidArgument, pageNotFound } from './errors.js';

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
    // An unknown root is a bad argument, not a missing page — the same rule
    // `RootSet.require` applies, restated here because this is the second door
    // into the same mistake and the two must not answer it differently.
    if (!svc)
      throw invalidArgument(
        `unknown rootId '${rootId}'`,
        `roots in this project: ${[...this.services.keys()].join(', ') || 'none'}`,
      );
    return svc;
  }

  /**
   * READ-ONLY listing: the discovery core is the read path, and a reader that
   * creates the directory it was asked to read is not a reader. See
   * `PagesService.listMarkdownFilesReadonly`.
   */
  async list(rootId: string): Promise<string[]> {
    return await this.service(rootId).listMarkdownFilesReadonly();
  }

  /** Listing + measurement in one pass, so a caller can size a root before pulling it. */
  async listWithStats(rootId: string): Promise<PageFile[]> {
    const svc = this.service(rootId);
    const rels = await svc.listMarkdownFilesReadonly();
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

  /**
   * The body AND the hash of the raw file, from a single read.
   *
   * `get_page_outline` needs both: the body to measure each section before anything is
   * fetched, and the file's digest for the envelope's `hash` — the value a caller
   * copies straight into `expectedHash`. Two calls would read the same file twice
   * for a listing that exists precisely to be cheap.
   *
   * The digest is `PagesService.read`'s own, taken over the RAW bytes rather than
   * over the `body` returned beside it: `expectedHash` is compared against the
   * file, so hashing the frontmatter-stripped half would arm a guard that never
   * passes on any page that has frontmatter.
   */
  async readWithHash(rootId: string, relPath: string): Promise<{ body: string; hash: string }> {
    return await this.guard(rootId, relPath, async () => {
      const page = await this.service(rootId).read(relPath);
      return { body: page.body, hash: page.hash };
    });
  }

  private async guard<T>(rootId: string, relPath: string, read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        throw pageNotFound(rootId, relPath, [...this.services.keys()]);
      }
      /**
       * `PagesService` refuses a path that escapes its root — the barrier that
       * keeps a page operation from naming a brief or the entity catalogue. It
       * refuses with a plain `Error`, so it used to surface as `INTERNAL`: the
       * right ANSWER under the wrong code, which reads to a caller as "the
       * server broke" rather than "that is not an address". The refusal is
       * unchanged; only its classification is.
       */
      const message = err instanceof Error ? err.message : String(err);
      if (/path escapes|invalid path|paths allowed/i.test(message)) {
        throw invalidArgument(
          message,
          `a page is addressed by (rootId, path) RELATIVE to the root — use list_pages({ rootId: "${rootId}" }) to see what it contains`,
        );
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
