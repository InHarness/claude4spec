import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type { PageContent, PageDetail, PageWriteInput, PageSearchHit } from '../../shared/types.js';
import { hasDotSegment, isMarkdownPath } from '../../shared/page-files.js';
import { fileMapEntryOf, type RootKind } from '../../shared/root-kinds.js';
import type { RecordStore } from '../fs/record-store.js';
import type { MarkdownRecord } from '../fs/record-adapters.js';

/**
 * 2.1.8 — M02's PRIMITIVE (D9): CRUD + frontmatter + sha256 over the markdown
 * entries (`*.md` / `*.mdx`) of ONE directory, parametrized `{ rootId, dir }`.
 *
 * Generic — agnostic of the root's kind. The registry loop (the L13 build hook,
 * `root-registry-runtime.ts`) builds one per root whose kind's file map has a
 * markdown entry: wrapped by the `PagesService` FACADE for kind `pages`, used
 * bare (no facade) by the system roots `plans` / `briefs` / `patches`, whose
 * read family (M36) consumes it directly.
 *
 * Deliberately no `private` members: the facade forwards this whole surface,
 * so a `PagesService` is accepted wherever a `MarkdownFileStore` is (the
 * consumers that serve every markdown root — frontmatter indexer, capture
 * serializer, anchor injection — take this type).
 */
export interface MarkdownFileStoreOptions {
  /** Registry id of the root this store serves. */
  rootId: string;
  /** The root's directory, relative to `cwd`. */
  dir: string;
  /** Project directory the root's `dir` resolves against. */
  cwd: string;
  /**
   * The root's kind. When given, the store serves only the paths its kind's file
   * map lists as markdown entries (`fileMapEntryOf`) — the same set the live
   * reaction filters see, so a file outside the map (a nested or `.mdx` brief)
   * is invisible to the boot listing, the readers and the writer alike. Omitted
   * by the hand-rolled rigs: every `.md` / `.mdx` path under the dir.
   */
  kind?: RootKind;
}

export class MarkdownFileStore {
  /** Absolute directory of the root. */
  readonly root: string;
  readonly rootId: string;
  /** The root's kind, when the store was built for a registry root (see the option). */
  readonly kind: RootKind | undefined;
  /**
   * 0.2.76 — the M42 record store this root writes through. Set after
   * construction because the mount this store is bound to is claimed by the
   * registry loop. `null` for the hand-rolled rigs that have no watcher at all;
   * those keep the plain write.
   */
  records: RecordStore<MarkdownRecord> | null = null;

  constructor(opts: MarkdownFileStoreOptions) {
    this.root = path.join(opts.cwd, opts.dir);
    this.rootId = opts.rootId;
    this.kind = opts.kind;
  }

  /** Is `relPath` a markdown entry of this root's kind's file map? Always true without a kind. */
  servesPath(relPath: string): boolean {
    return this.kind === undefined || fileMapEntryOf(this.kind, relPath)?.format === 'markdown';
  }

  async ensureRoot(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
  }

  /**
   * The markdown entries (`*.md` / `*.mdx`) under the root — what indexers,
   * capture and search read. ASSUMPTION:dev-0004 — the raw `.html` entry of the
   * `pages` map is not listed here (no content reader may read it); the root's
   * tree (`PagesService.listTree`) is what covers it.
   */
  async listMarkdownFiles(): Promise<string[]> {
    await this.ensureRoot();
    return (await collectMarkdown(this.root, '')).filter((rel) => this.servesPath(rel));
  }

  /**
   * The same listing, WITHOUT creating the root — for readers that must not write
   * (the `readonly-reader` CLI path: a root nobody created yet holds no pages,
   * and a read-only checkout must not fail on a mkdir).
   */
  async listMarkdownFilesReadonly(): Promise<string[]> {
    try {
      return (await collectMarkdown(this.root, '')).filter((rel) => this.servesPath(rel));
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') return [];
      throw err;
    }
  }

  async read(relPath: string): Promise<PageContent> {
    return parseRead(relPath, await this.readRaw(relPath));
  }

  /**
   * 2.1.6 — the `page-detail` record for the editor: the raw file and its hash
   * from ONE read, plus the editor's frontmatter/body split of it.
   */
  async readDetail(relPath: string): Promise<PageDetail> {
    const raw = await this.readRaw(relPath);
    return { rootId: this.rootId, ...parseRead(relPath, raw), content: raw };
  }

  /**
   * The file exactly as authored — frontmatter included, XML tags untouched
   * (M39 `get_page` returns a page as-authored because a tag IS an edge).
   */
  async readRaw(relPath: string): Promise<string> {
    return await fs.readFile(resolveServed(this, relPath), 'utf-8');
  }

  /** Size + mtime without reading the file — `list_pages` measures before fetching. */
  async stat(relPath: string): Promise<{ size: number; mtimeMs: number }> {
    const st = await fs.stat(resolveServed(this, relPath));
    return { size: st.size, mtimeMs: st.mtimeMs };
  }

  async write(relPath: string, input: PageWriteInput): Promise<PageContent> {
    resolveSafe(this.root, relPath); // path-safety refusals first, as on every other method
    if (!this.servesPath(relPath)) {
      throw new Error(`path '${relPath}' is not an entry of the '${this.kind}' root's file map`);
    }
    const written = await writeBytes(this, relPath, input);
    return {
      path: relPath,
      frontmatter: input.frontmatter ?? {},
      body: input.body,
      // Of the bytes actually written — same basis as `read`.
      // Note this is NOT the hash callers should hold: `page-write.commit` reads
      // the SETTLED state, after the write-back phase has injected anchors this
      // string predates. See its own comment.
      hash: sha256(written),
    };
  }

  async remove(relPath: string): Promise<void> {
    await fs.unlink(resolveServed(this, relPath));
  }

  async search(query: string, limit = 50): Promise<PageSearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    const lower = q.toLowerCase();
    const files = await this.listMarkdownFiles();
    const hits: PageSearchHit[] = [];
    for (const rel of files) {
      if (hits.length >= limit) break;
      const pathHit = rel.toLowerCase().includes(lower);
      const abs = resolveSafe(this.root, rel);
      let snippet: string | null = null;
      let line = 0;
      try {
        const raw = await fs.readFile(abs, 'utf-8');
        const lines = raw.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const text = lines[i] ?? '';
          if (text.toLowerCase().includes(lower)) {
            snippet = text.trim().slice(0, 160);
            line = i + 1;
            break;
          }
        }
      } catch {
        /* ignore unreadable file */
      }
      if (pathHit || snippet) {
        hits.push({
          path: rel,
          line,
          snippet: snippet ?? '',
          matchesPath: pathHit,
        });
      }
    }
    return hits;
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await fs.access(resolveServed(this, relPath));
      return true;
    } catch {
      return false;
    }
  }
}

function sha256(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf-8').digest('hex');
}

/** `read()`'s split of bytes already read — shared with `readDetail` so both answer from ONE read. */
function parseRead(relPath: string, raw: string): PageContent {
  const parsed = matter(raw);
  return {
    path: relPath,
    frontmatter: (parsed.data ?? {}) as Record<string, unknown>,
    body: parsed.content,
    // 0.2.15 — over the RAW bytes, not the parsed body: this is the value
    // `update_page` compares `expectedHash` against, and that comparison is
    // against the file.
    hash: sha256(raw),
  };
}

/** The bytes that landed. Through the record store when this root has one. */
async function writeBytes(store: MarkdownFileStore, relPath: string, input: PageWriteInput): Promise<string> {
  if (store.records) {
    const res = await store.records.write(relPath, {
      body: input.body,
      ...(input.frontmatter !== undefined ? { frontmatter: input.frontmatter } : {}),
    });
    return res.content;
  }
  const abs = resolveSafe(store.root, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const hasFrontmatter = input.frontmatter && Object.keys(input.frontmatter).length > 0;
  const serialized = hasFrontmatter
    ? matter.stringify(input.body, input.frontmatter as Record<string, unknown>)
    : input.body;
  await fs.writeFile(abs, serialized, 'utf-8');
  return serialized;
}

/** A root-relative markdown path → absolute, refusing anything that escapes the root. */
export function resolveSafe(root: string, relPath: string): string {
  if (!relPath || relPath.includes('\0')) throw new Error('invalid path');
  if (!isMarkdownPath(relPath)) throw new Error('only .md / .mdx paths allowed');
  const abs = path.resolve(root, relPath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path escapes pages root: ${relPath}`);
  }
  return abs;
}

/**
 * `resolveSafe` for a path the store serves. A path outside the kind's file map
 * reads as absent (`ENOENT`) — the same answer a reader gets for a missing file,
 * so every route that maps a missing file to 404 treats it alike.
 */
function resolveServed(store: MarkdownFileStore, relPath: string): string {
  const abs = resolveSafe(store.root, relPath);
  if (!store.servesPath(relPath)) {
    throw Object.assign(new Error(`ENOENT: '${relPath}' is not an entry of the '${store.kind}' root's file map`), {
      code: 'ENOENT',
    });
  }
  return abs;
}

/** Dot-segment subtrees are outside the root's namespace (L13). */
async function collectMarkdown(dir: string, prefix: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (hasDotSegment(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await collectMarkdown(path.join(dir, entry.name), rel)));
    } else if (entry.isFile() && isMarkdownPath(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}
