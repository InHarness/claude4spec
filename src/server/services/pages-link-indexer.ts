import { scanFences } from '../../shared/code-ranges.js';
import path from 'node:path';
import type { MarkdownFileStore } from './markdown-file-store.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type {
  FileMeta,
  PageLink,
  PageLinkAutocompleteItem,
  PageLinksCounts,
  UnresolvedMention,
} from '../../shared/page-links.js';
import { ANCHOR_ID_SOURCE, ANCHOR_PATTERN_SOURCE } from '../../shared/anchor-pattern.js';
import type { WatchSubscriber, WatchScope, WatchActor, WatchOrigin } from '../fs/watcher.js';
import { reactionRootId } from '../fs/sources.js';
import type { ReactionInput } from '../fs/reactions.js';
import { PROJECTION_IDS, type ProjectionStatusRegistry } from './projection-status.js';

// 0.2.89 — the `#anchor` suffix is the canonical anchor id (`[a-z0-9]{6,12}`), the
// alphabet anchors are minted from. Until now it was 8 hex digits, which almost no
// minted anchor is, so a cited section silently dropped out of the link.
const ANCHOR_SUFFIX = `#(${ANCHOR_ID_SOURCE})(?![a-z0-9])`;
const AT_RE = new RegExp(`(?<![\\w])@([a-zA-Z0-9_][a-zA-Z0-9_\\-/.]*[a-zA-Z0-9_\\-/])(?:${ANCHOR_SUFFIX})?`, 'g');
const LINK_RE = /\[([^\]\n]*)\]\(([^)\s]+)\)/g;
const BACKTICK_RE = /`([^`\n]+)`/g;
const ANCHOR_RE = new RegExp(ANCHOR_PATTERN_SOURCE, 'g');
const HEADING_RE = /^#\s+(.+?)\s*$/m;
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const BACKTICK_PATH_RE = new RegExp(`^([a-zA-Z0-9_][a-zA-Z0-9_\\-/.]*\\.\\w+)(?:#(${ANCHOR_ID_SOURCE}))?$`);

interface ParseResult {
  meta: FileMeta;
  links: PageLink[];
  unresolved: UnresolvedMention[];
  candidates: PageLink[];
  unresolvedCandidates: UnresolvedMention[];
}

/**
 * M14 link indexer.
 *
 * 0.2.10 (M40) / 2.1.8: bound as `m14-link-indexer` (`after:
 * ['m06-section-indexer']`) on every root whose kind selects it — today every
 * `pages` root. `after` is resolved per source: where the section indexer is
 * not bound, the dependency is satisfied and this indexer runs on its own.
 *
 * 2.1.8 — the resolution scope of `@path.md` is EVERY root this indexer covers
 * (all `kind: pages` roots), with precedence: the source page's root, then the
 * `builtin` root, then the rest in `roots[]` order. The same path in several
 * roots resolves to the first hit; a resolved link records the root it landed
 * in (`targetRootId`). `linkTargets` is gone.
 *
 * Its own pending-timer map is gone: debounce belongs to the mount.
 */
export class PagesLinkIndexerService implements WatchSubscriber {
  // 0.1.96: all maps keyed by composite `${rootId}:${path}`. The reverse index
  // is keyed by the TARGET's root, which (2.1.8) may differ from the source's.
  private byPath = new Map<string, FileMeta>();
  private linkIndex = new Map<string, PageLink[]>();
  private reverseIndex = new Map<string, Set<string>>();
  private unresolved = new Map<string, UnresolvedMention[]>();

  constructor(
    /** The roots in scope, in `roots[]` order (Map insertion order). */
    private roots: Map<string, MarkdownFileStore>,
    private ws: WsEmitter,
    /**
     * 0.2.77 — the fail-closed guard's source of truth. Optional: a rig with no
     * projection registry owns nothing that could be marked.
     */
    private projectionStatus?: ProjectionStatusRegistry,
    /**
     * 2.1.8 — the resolution precedence inputs: the `builtin` root's id (second
     * in line after the source root) and each root's cwd-relative dir, so a
     * CWD-relative path (`docs/adr/x.md`) is checked against every root in scope.
     */
    private scope: { builtinRootId?: string; rootDirs?: ReadonlyMap<string, string> } = {},
  ) {}

  /**
   * 0.2.77 — RENAME-SYNC. Rewrite every citation of `from` to `to`, across every
   * source page of one root.
   *
   * Two roads lead here, and only one of them is new. A move performed BY THE
   * APPLICATION hands over both paths outright — there is nothing to infer, and
   * no window to wait out. A move performed by something else (a plain
   * `fs.rename` from an editor or a script) is still only visible as separate
   * events, and is not this method's business.
   *
   * ## The guard, before the first write
   *
   * If the link projection carries ANY staleness marker the whole propagation is
   * abandoned BEFORE a single file is written: no source page gets rewritten
   * links, so the move is aborted rather than half-applied. The refusal is
   * global by design — `reverseIndex` aggregates over every source page, so one
   * source that did not recompute means the list of pages to rewrite is itself
   * unreliable, and rewriting from an unreliable list is how citations get lost.
   *
   * ## Not atomic across files, and not pretending to be
   *
   * Each rewritten page is its OWN write through the record primitive, with its
   * own commit, its own suppressed event and its own full phase chain. There is
   * no transaction spanning N files and none is simulated: a failure partway
   * leaves the pages already rewritten rewritten.
   *
   * Scope is the ROOT. `reverseIndex` does not cover briefs and patches, so their
   * `@page.md` citations stay unsynchronised — unchanged from before.
   */
  async renameSync(rootId: string, from: string, to: string, actor: WatchActor = 'user'): Promise<string[]> {
    this.projectionStatus?.assertFresh(PROJECTION_IDS.pageLinks);

    if (!this.roots.get(rootId)) return [];
    // Read the citing pages BEFORE anything is written — the index is about to
    // be rewritten underneath us by each write's own chain.
    /**
     * `reverseIndex` stores COMPOSITE keys (`${rootId}:${relPath}`) — the same
     * keying every map in this class uses — so the prefix has to come off before
     * a path reaches the record store, which addresses records relative to the
     * root. 2.1.8: a citing page may sit in ANOTHER page root (cross-root
     * resolution), and it is rewritten in its own root.
     */
    const sources = this.getReverseLinks(rootId, from).map((k) => {
      const i = k.indexOf(':');
      return { sourceRootId: k.slice(0, i), sourcePath: k.slice(i + 1) };
    });
    const rewritten: string[] = [];
    for (const { sourceRootId, sourcePath } of sources) {
      if (sourceRootId === rootId && sourcePath === from) continue;
      const svc = this.roots.get(sourceRootId);
      if (!svc?.records) continue;
      const raw = svc.records.readRaw(sourcePath);
      if (raw === null) continue;
      const next = rewritePageCitations(raw, from, to);
      if (next === raw) continue;
      // Attributed to whoever performed the MOVE: the rewrite is a consequence of
      // their action, not an authorless background edit, and `capture` records it
      // under that name in each rewritten page's own version row.
      await svc.records.write(sourcePath, { raw: next }, { actor });
      rewritten.push(sourcePath);
    }
    return rewritten;
  }

  private key(rootId: string, relPath: string): string {
    return `${rootId}:${relPath}`;
  }

  async indexAll(): Promise<void> {
    let fileCount = 0;
    // 2.1.8: two passes over ALL roots — a link may resolve into a root later
    // in the order, so every root's pages must be known before any is resolved.
    const filesByRoot = new Map<string, string[]>();
    for (const [rootId, svc] of this.roots) {
      const files = await svc.listMarkdownFiles();
      filesByRoot.set(rootId, files);
      for (const rel of files) await this.parseAndStoreMeta(rootId, rel);
      fileCount += files.length;
    }
    for (const [rootId, files] of filesByRoot) {
      for (const rel of files) await this.parseAndStoreLinks(rootId, rel, { silent: true });
    }
    console.log(
      `[pages-link-indexer] indexed ${fileCount} pages, ${this.totalLinksCount()} links, ${this.unresolvedCount()} unresolved`
    );
  }

  /** `rootId` comes from the reaction's input — the registry entry's id passed at binding. */
  async onChange(_scope: WatchScope, source: string, relPath: string, _origin?: WatchOrigin, input?: ReactionInput): Promise<void> {
    await this.indexPage(reactionRootId(source, input), relPath);
  }

  onUnlink(_scope: WatchScope, source: string, relPath: string, _origin?: WatchOrigin, input?: ReactionInput): void {
    this.handleUnlink(reactionRootId(source, input), relPath);
  }

  handleUnlink(rootId: string, relPath: string): void {
    const k = this.key(rootId, relPath);
    const hadMeta = this.byPath.delete(k);
    this.clearSourceLinks(k);
    this.unresolved.delete(k);
    // Other pages may now point at a non-existent target; let their own events resolve later.
    if (hadMeta) {
      this.ws.broadcast({ kind: 'pageLinks:changed', rootId, sourcePath: relPath });
    }
  }

  private async indexPage(rootId: string, relPath: string): Promise<void> {
    const k = this.key(rootId, relPath);
    const prevMeta = this.byPath.get(k);
    const metaChanged = await this.parseAndStoreMeta(rootId, relPath);
    const linksChanged = await this.parseAndStoreLinks(rootId, relPath);
    const exists = this.byPath.has(k);
    if (!exists && prevMeta) {
      this.handleUnlink(rootId, relPath);
      return;
    }
    if (metaChanged || linksChanged) {
      this.ws.broadcast({ kind: 'pageLinks:changed', rootId, sourcePath: relPath });
    }
  }

  private async parseAndStoreMeta(rootId: string, relPath: string): Promise<boolean> {
    const k = this.key(rootId, relPath);
    const svc = this.roots.get(rootId);
    if (!svc) return this.byPath.delete(k);
    let page;
    try {
      page = await svc.read(relPath);
    } catch {
      return this.byPath.delete(k);
    }
    const title = extractTitle(relPath, page.frontmatter, page.body);
    const anchors = extractAnchors(page.body);
    const prev = this.byPath.get(k);
    const next: FileMeta = { path: relPath, title, anchors };
    this.byPath.set(k, next);
    return !prev || !sameMeta(prev, next);
  }

  private async parseAndStoreLinks(
    rootId: string,
    relPath: string,
    opts: { silent?: boolean } = {}
  ): Promise<boolean> {
    void opts;
    const k = this.key(rootId, relPath);
    const svc = this.roots.get(rootId);
    if (!svc) return this.clearSourceLinks(k);
    let page;
    try {
      page = await svc.read(relPath);
    } catch {
      return this.clearSourceLinks(k);
    }
    const parsed = parseLinks(page.body);
    const resolvedLinks: PageLink[] = [];
    const unresolvedEntries: UnresolvedMention[] = [];

    for (const cand of parsed.candidates) {
      const hit = this.resolve(cand.targetPath, relPath, rootId);
      if (!hit) {
        if (cand.syntax === 'at' || cand.syntax === 'link') {
          unresolvedEntries.push({
            syntax: cand.syntax,
            rawToken: cand.rawToken,
            candidatePath: cand.targetPath,
            line: cand.line,
            col: cand.col,
          });
        }
        continue;
      }
      resolvedLinks.push({
        syntax: cand.syntax,
        rawToken: cand.rawToken,
        targetRootId: hit.rootId,
        targetPath: hit.path,
        anchor: cand.anchor,
        line: cand.line,
        col: cand.col,
      });
    }

    const prevLinks = this.linkIndex.get(k) ?? [];
    const prevUnresolved = this.unresolved.get(k) ?? [];

    let changed = !sameLinks(prevLinks, resolvedLinks);
    if (!changed) changed = !sameUnresolved(prevUnresolved, unresolvedEntries);

    // Reverse index keyed by composite target `${targetRootId}:${targetPath}`.
    const oldTargets = new Set(prevLinks.map((l) => this.key(l.targetRootId ?? rootId, l.targetPath)));
    const newTargets = new Set(resolvedLinks.map((l) => this.key(l.targetRootId ?? rootId, l.targetPath)));
    for (const t of oldTargets) {
      if (!newTargets.has(t)) {
        const srcs = this.reverseIndex.get(t);
        if (srcs) {
          srcs.delete(k);
          if (srcs.size === 0) this.reverseIndex.delete(t);
        }
      }
    }
    for (const t of newTargets) {
      let srcs = this.reverseIndex.get(t);
      if (!srcs) {
        srcs = new Set();
        this.reverseIndex.set(t, srcs);
      }
      srcs.add(k);
    }

    if (resolvedLinks.length === 0) this.linkIndex.delete(k);
    else this.linkIndex.set(k, resolvedLinks);
    if (unresolvedEntries.length === 0) this.unresolved.delete(k);
    else this.unresolved.set(k, unresolvedEntries);
    return changed;
  }

  private clearSourceLinks(sourceKey: string): boolean {
    const rootId = sourceKey.slice(0, sourceKey.indexOf(':'));
    const prev = this.linkIndex.get(sourceKey);
    if (!prev) {
      return this.unresolved.delete(sourceKey);
    }
    for (const l of prev) {
      const t = this.key(l.targetRootId ?? rootId, l.targetPath);
      const srcs = this.reverseIndex.get(t);
      if (srcs) {
        srcs.delete(sourceKey);
        if (srcs.size === 0) this.reverseIndex.delete(t);
      }
    }
    this.linkIndex.delete(sourceKey);
    this.unresolved.delete(sourceKey);
    return true;
  }

  /**
   * The roots `@path.md` is resolved against from a page of `sourceRootId`, in
   * precedence order: the source root, the `builtin` root, then the rest in
   * `roots[]` order. A source outside the indexed roots (an artifact — plan,
   * brief, patch) starts at the `builtin` root.
   */
  private resolutionOrder(sourceRootId: string | null): string[] {
    const order: string[] = [];
    const push = (id: string | undefined): void => {
      if (id && this.roots.has(id) && !order.includes(id)) order.push(id);
    };
    push(sourceRootId ?? undefined);
    push(this.scope.builtinRootId);
    for (const id of this.roots.keys()) push(id);
    return order;
  }

  /**
   * Resolve a candidate path across the roots in scope (2.1.8). Step by step,
   * each step over every root in precedence order (first hit wins):
   *   0. relative to the source page (source root only);
   *   2. the path as a root-relative one, exact;
   *   3. the same without an extension — `.md`, then `.mdx`;
   *   3b. a CWD-relative spelling with each root's own `dir` stripped, exact and
   *       then `.md`/`.mdx` — only after 2–3 missed in every root, so a
   *       root-relative hit anywhere in scope beats a dir-prefixed one.
   *
   * `sourceRootId: null` resolves for an artifact (from the `builtin` root on).
   */
  resolve(
    candidate: string,
    sourcePath: string,
    sourceRootId: string | null,
  ): { rootId: string; path: string; anchor?: string } | null {
    if (!candidate) return null;
    const hashIdx = candidate.indexOf('#');
    const rawPath = hashIdx >= 0 ? candidate.slice(0, hashIdx) : candidate;
    const anchor = hashIdx >= 0 ? candidate.slice(hashIdx + 1) : undefined;
    const stripped = rawPath.replace(/^\/+/, '');
    if (!stripped) return null;
    const normalized = path.posix.normalize(stripped);
    const order = this.resolutionOrder(sourceRootId);

    const exact = (rootId: string, p: string) =>
      this.byPath.has(this.key(rootId, p)) ? { rootId, path: p, anchor } : null;
    const noExt = (rootId: string, p: string) => {
      for (const ext of ['.md', '.mdx']) {
        if (this.byPath.has(this.key(rootId, p + ext))) return { rootId, path: p + ext, anchor };
      }
      return null;
    };

    if (sourcePath && sourceRootId && order.includes(sourceRootId)) {
      const dir = path.posix.dirname(sourcePath);
      const joined = path.posix.normalize(path.posix.join(dir, stripped));
      if (!joined.startsWith('..') && !joined.startsWith('/')) {
        const found = exact(sourceRootId, joined) ?? noExt(sourceRootId, joined);
        if (found) return found;
      }
    }
    if (normalized.startsWith('..') || normalized.startsWith('/')) return null;

    for (const rootId of order) {
      const found = exact(rootId, normalized);
      if (found) return found;
    }
    for (const rootId of order) {
      const found = noExt(rootId, normalized);
      if (found) return found;
    }
    for (const rootId of order) {
      const rootDir = this.scope.rootDirs?.get(rootId);
      const prefix = rootDir ? path.posix.normalize(rootDir.replace(/\\/g, '/')).replace(/\/+$/, '') : '';
      if (!prefix || prefix === '.' || !normalized.startsWith(prefix + '/')) continue;
      const rel = normalized.slice(prefix.length + 1);
      const found = exact(rootId, rel) ?? noExt(rootId, rel);
      if (found) return found;
    }
    return null;
  }

  getFileMeta(rootId: string, relPath: string): FileMeta | undefined {
    return this.byPath.get(this.key(rootId, relPath));
  }

  getLinks(rootId: string, relPath: string): PageLink[] {
    return this.linkIndex.get(this.key(rootId, relPath)) ?? [];
  }

  getReverseLinks(rootId: string, relPath: string): string[] {
    const srcs = this.reverseIndex.get(this.key(rootId, relPath));
    if (!srcs) return [];
    return [...srcs].sort();
  }

  getUnresolved(rootId: string, relPath: string): UnresolvedMention[] {
    return this.unresolved.get(this.key(rootId, relPath)) ?? [];
  }

  allLinks(): Record<string, PageLink[]> {
    const out: Record<string, PageLink[]> = {};
    for (const k of [...this.linkIndex.keys()].sort()) {
      out[k] = this.linkIndex.get(k)!;
    }
    return out;
  }

  allReverseLinks(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const k of [...this.reverseIndex.keys()].sort()) {
      out[k] = [...this.reverseIndex.get(k)!].sort();
    }
    return out;
  }

  allUnresolved(): Record<string, UnresolvedMention[]> {
    const out: Record<string, UnresolvedMention[]> = {};
    for (const k of [...this.unresolved.keys()].sort()) {
      out[k] = this.unresolved.get(k)!;
    }
    return out;
  }

  counts(): PageLinksCounts {
    let brokenLinkCount = 0;
    let unresolvedMentionCount = 0;
    for (const entries of this.unresolved.values()) {
      for (const u of entries) {
        if (u.syntax === 'link') brokenLinkCount++;
        else if (u.syntax === 'at') unresolvedMentionCount++;
      }
    }
    return {
      brokenLinkCount,
      unresolvedMentionCount,
      totalLinks: this.totalLinksCount(),
    };
  }

  /**
   * 2.1.8 — suggestions span every root in scope (all `kind: pages` roots). The
   * same path in several roots is offered once, from the root the inserted
   * `@path.md` would resolve to: the source page's root, then `builtin`, then
   * `roots[]` order — the precedence of `resolve`. `sourceRootId: null` (an
   * artifact, or a caller that does not know its root) starts at `builtin`.
   */
  autocomplete(query: string, limit = 10, sourceRootId: string | null = null): PageLinkAutocompleteItem[] {
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    const items: PageLinkAutocompleteItem[] = [];
    for (const rootId of this.resolutionOrder(sourceRootId)) {
      const prefix = `${rootId}:`;
      for (const [k, meta] of this.byPath) {
        if (!k.startsWith(prefix) || seen.has(meta.path)) continue;
        const score = q ? fuzzyScore(q, meta.path, meta.title) : 0;
        if (q && score <= 0) continue;
        seen.add(meta.path);
        items.push({ path: meta.path, title: meta.title, matchScore: score, rootId });
      }
    }
    items.sort((a, b) => b.matchScore - a.matchScore || a.path.localeCompare(b.path));
    return items.slice(0, limit);
  }

  private totalLinksCount(): number {
    let total = 0;
    for (const v of this.linkIndex.values()) total += v.length;
    return total;
  }

  private unresolvedCount(): number {
    let total = 0;
    for (const v of this.unresolved.values()) total += v.length;
    return total;
  }
}

function extractTitle(
  relPath: string,
  frontmatter: Record<string, unknown>,
  body: string
): string {
  const fmTitle = frontmatter['title'];
  if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle.trim();
  const m = HEADING_RE.exec(body);
  if (m?.[1]) return m[1].trim();
  const base = path.posix.basename(relPath, '.md');
  return base;
}

function extractAnchors(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  ANCHOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANCHOR_RE.exec(body))) {
    const a = m[1]!;
    if (!seen.has(a)) {
      seen.add(a);
      out.push(a);
    }
  }
  return out;
}

/**
 * M39: exported so the discovery core's section edges and `find_references`
 * `target: "page"` variant reuse THIS parser rather than becoming a third
 * implementation of "what counts as a page link". The consumer of an edge must
 * not be parsing markdown itself, and neither must a second module here.
 */
export function parseLinks(body: string): { candidates: PageLink[] } {
  const masked = maskFences(body);
  const lineOffsets = computeLineOffsets(masked);
  const candidates: PageLink[] = [];
  const covered: Array<[number, number]> = [];

  LINK_RE.lastIndex = 0;
  let lm: RegExpExecArray | null;
  while ((lm = LINK_RE.exec(masked))) {
    const full = lm[0]!;
    const target = lm[2]!;
    if (URL_SCHEME_RE.test(target) || target.startsWith('#')) continue;
    const { hashIdx, pathPart, anchor } = splitAnchor(target);
    void hashIdx;
    const { line, col } = offsetToLineCol(lineOffsets, lm.index);
    candidates.push({
      syntax: 'link',
      rawToken: full,
      targetPath: pathPart,
      anchor,
      line,
      col,
    });
    covered.push([lm.index, lm.index + full.length]);
  }

  BACKTICK_RE.lastIndex = 0;
  let bm: RegExpExecArray | null;
  while ((bm = BACKTICK_RE.exec(masked))) {
    if (isCovered(covered, bm.index)) continue;
    const inner = bm[1]!;
    const pm = BACKTICK_PATH_RE.exec(inner);
    if (!pm) continue;
    const { line, col } = offsetToLineCol(lineOffsets, bm.index);
    candidates.push({
      syntax: 'backticks',
      rawToken: bm[0]!,
      targetPath: pm[1]!,
      anchor: pm[2] ?? undefined,
      line,
      col,
    });
    covered.push([bm.index, bm.index + bm[0]!.length]);
  }

  AT_RE.lastIndex = 0;
  let am: RegExpExecArray | null;
  while ((am = AT_RE.exec(masked))) {
    if (isCovered(covered, am.index)) continue;
    const full = am[0]!;
    const pathCand = am[1]!;
    const anchor = am[2] ?? undefined;
    const { line, col } = offsetToLineCol(lineOffsets, am.index);
    candidates.push({
      syntax: 'at',
      rawToken: full,
      targetPath: pathCand,
      anchor,
      line,
      col,
    });
  }

  return { candidates };
}

function splitAnchor(target: string): { hashIdx: number; pathPart: string; anchor: string | undefined } {
  const idx = target.indexOf('#');
  if (idx < 0) return { hashIdx: -1, pathPart: target, anchor: undefined };
  return { hashIdx: idx, pathPart: target.slice(0, idx), anchor: target.slice(idx + 1) };
}

function maskFences(body: string): string {
  // 2.0.0 — the shared excluded-range scanner (CommonMark fences: ``` and ~~~,
  // run length, list/quote containers, unclosed → end of document).
  let out = body;
  for (const [start, end] of scanFences(body).fenced) {
    out = out.slice(0, start) + body.slice(start, end).replace(/[^\n]/g, ' ') + out.slice(end);
  }
  return out;
}

function computeLineOffsets(body: string): number[] {
  const offsets = [0];
  for (let i = 0; i < body.length; i++) {
    if (body.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return offsets;
}

function offsetToLineCol(lineOffsets: number[], offset: number): { line: number; col: number } {
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineOffsets[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - lineOffsets[lo]! };
}

function isCovered(ranges: Array<[number, number]>, pos: number): boolean {
  for (const [s, e] of ranges) {
    if (pos >= s && pos < e) return true;
  }
  return false;
}

function sameMeta(a: FileMeta, b: FileMeta): boolean {
  if (a.title !== b.title) return false;
  if (a.anchors.length !== b.anchors.length) return false;
  for (let i = 0; i < a.anchors.length; i++) {
    if (a.anchors[i] !== b.anchors[i]) return false;
  }
  return true;
}

function sameLinks(a: PageLink[], b: PageLink[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.syntax !== y.syntax ||
      x.rawToken !== y.rawToken ||
      x.targetPath !== y.targetPath ||
      x.anchor !== y.anchor ||
      x.line !== y.line ||
      x.col !== y.col
    ) {
      return false;
    }
  }
  return true;
}

function sameUnresolved(a: UnresolvedMention[], b: UnresolvedMention[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.syntax !== y.syntax ||
      x.rawToken !== y.rawToken ||
      x.candidatePath !== y.candidatePath ||
      x.line !== y.line ||
      x.col !== y.col
    ) {
      return false;
    }
  }
  return true;
}

function fuzzyScore(q: string, pathStr: string, title: string): number {
  const p = pathStr.toLowerCase();
  const t = title.toLowerCase();
  const pi = p.indexOf(q);
  const ti = t.indexOf(q);
  if (pi < 0 && ti < 0) return 0;
  const pScore = pi < 0 ? 0 : 1000 - pi * 10;
  const tScore = ti < 0 ? 0 : 500 - ti * 5;
  const exactBonus = p === q || t === q ? 500 : 0;
  const baseBonus = path.posix.basename(p, '.md') === q ? 200 : 0;
  return Math.max(pScore, tScore) + exactBonus + baseBonus;
}


/**
 * The three citation FORMS a page may carry, rewritten together.
 *
 * They are three spellings of one edge, so a rename that fixed only the `@`
 * mentions would leave the markdown links and the backticked paths pointing at a
 * file that is no longer there — a half-done rename is worse than none, because
 * it looks done.
 *
 * The optional `#anchor` suffix on the first two forms is PRESERVED: a move
 * changes where a page lives, never which section of it was cited.
 *
 * Exported for its own test — the substitution is the part worth pinning, and it
 * is pure.
 */
export function rewritePageCitations(content: string, from: string, to: string): string {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content
    // `@a.md` and `@a.md#kkz1e7d6`
    .replace(new RegExp(`(?<![\\w])@${esc}(?=(#${ANCHOR_ID_SOURCE})?(?![\\w\\-/.]))`, 'g'), `@${to}`)
    // `` `a.md` `` and `` `a.md#kkz1e7d6` ``
    .replace(new RegExp('`' + esc + `(#${ANCHOR_ID_SOURCE})?` + '`', 'g'), (_m, anchor: string | undefined) =>
      '`' + to + (anchor ?? '') + '`',
    )
    // `](a.md)`
    .replace(new RegExp(`\\]\\(${esc}(#${ANCHOR_ID_SOURCE})?\\)`, 'g'), (_m, anchor: string | undefined) =>
      `](${to}${anchor ?? ''})`,
    );
}
