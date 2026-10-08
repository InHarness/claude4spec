import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type { PageContent, PageDetail, PageNode, PageWriteInput, PageSearchHit } from '../../shared/types.js';
import { hasDotSegment } from '../../shared/page-files.js';
import { PAGES_KIND, fileMapEntryOf } from '../../shared/root-kinds.js';
import type { RecordStore } from '../fs/record-store.js';
import type { MarkdownRecord } from '../fs/record-adapters.js';
import { MarkdownFileStore } from './markdown-file-store.js';

export { MarkdownFileStore } from './markdown-file-store.js';

/**
 * 2.1.6 — M02's frontmatter parser for readers that must not fail on a broken
 * block: the parsed YAML keys of a frontmatter block (fences included), or
 * `undefined` when the YAML does not parse. A syntax error is an absence of
 * `fields`, never an error of the read — the literal block is what lets the
 * caller repair it.
 */
export function parseFrontmatterFields(block: string): Record<string, unknown> | undefined {
  try {
    // `{}` as options bypasses gray-matter's string-keyed cache, whose entries
    // are shared mutable objects.
    return { ...((matter(block, {}).data ?? {}) as Record<string, unknown>) };
  } catch {
    return undefined;
  }
}

/** The root a facade serves — a registry root with a facade (or a user-root record). */
export interface PagesRootRef {
  id: string;
  dir: string;
}

/**
 * 2.1.8 — M02's FACADE (D9) over the `MarkdownFileStore` primitive,
 * `new PagesService({ root, store })`. 2.1.9: the facade of the roots with a
 * tree in the sidebar — built by the registry loop for every root whose kind's
 * `sidebar` is not `hidden` (`root-registry-runtime.ts`); there is no
 * `PagesService` outside them — the system roots `plans` / `briefs` / `patches`
 * (`sidebar: hidden`) get the bare store. The facade adds the tree resolution
 * (`listTree`, `fileType` from the root kind's file map) on top of the store's
 * CRUD + frontmatter + sha256, which it forwards unchanged.
 *
 * The positional `(cwd, dir, rootId)` form builds its own store — no production
 * code uses it any more (the discovery reader builds `{ root, store }` too). It
 * stays for the colocated test rigs of `pages` roots, which have no registry
 * loop; a rig for a system root builds the bare `MarkdownFileStore` instead.
 */
export class PagesService {
  readonly store: MarkdownFileStore;
  /** Absolute directory of the root (the store's). */
  readonly root: string;
  /** Registry id of the root (with a facade) this facade serves. */
  readonly rootId: string;

  constructor(opts: { root: PagesRootRef; store: MarkdownFileStore });
  constructor(cwd: string, pagesDir: string, rootId: string);
  constructor(a: string | { root: PagesRootRef; store: MarkdownFileStore }, pagesDir?: string, rootId?: string) {
    // 0.2.101: no `'pages'` defaults — a service constructed without an explicit
    // root would serve whatever directory that literal happens to name today.
    if (typeof a === 'string') {
      this.store = new MarkdownFileStore({ cwd: a, dir: pagesDir!, rootId: rootId! });
    } else {
      if (a.store.rootId !== a.root.id) {
        throw new Error(`[m02] facade for root '${a.root.id}' over the store of '${a.store.rootId}'`);
      }
      this.store = a.store;
    }
    this.root = this.store.root;
    this.rootId = this.store.rootId;
  }

  /** The M42 record store the primitive writes through (see `MarkdownFileStore.records`). */
  get records(): RecordStore<MarkdownRecord> | null {
    return this.store.records;
  }
  set records(records: RecordStore<MarkdownRecord> | null) {
    this.store.records = records;
  }

  // ── tree resolution (the facade's own) ─────────────────────────────────────

  async listTree(): Promise<PageNode[]> {
    await this.ensureRoot();
    return await this.walk(this.root, '');
  }

  // ── forwarded to the primitive ─────────────────────────────────────────────

  get kind(): MarkdownFileStore['kind'] {
    return this.store.kind;
  }
  servesPath(relPath: string): boolean {
    return this.store.servesPath(relPath);
  }
  ensureRoot(): Promise<void> {
    return this.store.ensureRoot();
  }
  listMarkdownFiles(): Promise<string[]> {
    return this.store.listMarkdownFiles();
  }
  listMarkdownFilesReadonly(): Promise<string[]> {
    return this.store.listMarkdownFilesReadonly();
  }
  read(relPath: string): Promise<PageContent> {
    return this.store.read(relPath);
  }
  readDetail(relPath: string): Promise<PageDetail> {
    return this.store.readDetail(relPath);
  }
  readRaw(relPath: string): Promise<string> {
    return this.store.readRaw(relPath);
  }
  stat(relPath: string): Promise<{ size: number; mtimeMs: number }> {
    return this.store.stat(relPath);
  }
  write(relPath: string, input: PageWriteInput): Promise<PageContent> {
    return this.store.write(relPath, input);
  }
  remove(relPath: string): Promise<void> {
    return this.store.remove(relPath);
  }
  search(query: string, limit = 50): Promise<PageSearchHit[]> {
    return this.store.search(query, limit);
  }
  exists(relPath: string): Promise<boolean> {
    return this.store.exists(relPath);
  }

  private async walk(dir: string, relPrefix: string): Promise<PageNode[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    // Children sort by frontmatter `order` ascending, then alphabetically by name.
    // Folders and raw (.html) entries carry no order (Infinity) — there is no
    // folder-ordering mechanism and a raw entry has no frontmatter.
    //
    // 2.1.8 (M02 `e16qvg1n`): a file's `fileType` follows the file map of the
    // root's kind (2.1.9: any kind with a facade; `pages` for the positional test
    // rigs, which carry no kind), not a hard-coded extension list — a markdown entry is
    // `fileType='markdown'`, the raw entry (`.html`, track `none`) is
    // `fileType='html'`: shown in the tree, previewed by M30, never a page.
    const items: { node: PageNode; order: number }[] = [];
    for (const entry of entries) {
      if (hasDotSegment(entry.name)) continue;
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        const children = await this.walk(path.join(dir, entry.name), rel);
        items.push({ node: { type: 'folder', name: entry.name, path: rel, children }, order: Infinity });
        continue;
      }
      if (!entry.isFile()) continue;
      const mapEntry = fileMapEntryOf(this.store.kind ?? PAGES_KIND, rel);
      if (mapEntry?.format === 'markdown') {
        const order = await this.readOrder(path.join(dir, entry.name));
        items.push({ node: { type: 'file', name: entry.name, path: rel, fileType: 'markdown' }, order });
      } else if (mapEntry?.format === 'raw') {
        // M30: raw entries are read-only previews served via /api/static/*.
        // ASSUMPTION:dev-0501 — a raw entry that is not `.html` (2.1.9: a file
        // inside a `skills` package, or loose in that root) is listed the same way.
        items.push({ node: { type: 'file', name: entry.name, path: rel, fileType: 'html' }, order: Infinity });
      }
    }
    items.sort((a, b) =>
      a.order !== b.order ? a.order - b.order : a.node.name.localeCompare(b.node.name),
    );
    return items.map((i) => i.node);
  }

  /** Read the numeric `order` frontmatter from a markdown file; Infinity if absent/invalid. */
  private async readOrder(abs: string): Promise<number> {
    try {
      const data = matter(await fs.readFile(abs, 'utf-8')).data as Record<string, unknown>;
      const o = data?.['order'];
      return typeof o === 'number' ? o : Infinity;
    } catch {
      return Infinity;
    }
  }
}
