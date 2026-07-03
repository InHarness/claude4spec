import path from 'node:path';
import type { PagesService } from './pages.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type {
  FileMeta,
  PageLink,
  PageLinkAutocompleteItem,
  PageLinksCounts,
  UnresolvedMention,
} from '../../shared/page-links.js';
import { ANCHOR_PATTERN_SOURCE } from '../../shared/anchor-pattern.js';

const AT_RE = /(?<![\w])@([a-zA-Z0-9_][a-zA-Z0-9_\-/.]*[a-zA-Z0-9_\-/])(?:#([a-f0-9]{8}))?/g;
const LINK_RE = /\[([^\]\n]*)\]\(([^)\s]+)\)/g;
const BACKTICK_RE = /`([^`\n]+)`/g;
const FENCE_RE = /^```[\s\S]*?^```/gm;
const ANCHOR_RE = new RegExp(ANCHOR_PATTERN_SOURCE, 'g');
const HEADING_RE = /^#\s+(.+?)\s*$/m;
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const BACKTICK_PATH_RE = /^([a-zA-Z0-9_][a-zA-Z0-9_\-/.]*\.\w+)(?:#([a-f0-9]{8}))?$/;

interface ParseResult {
  meta: FileMeta;
  links: PageLink[];
  unresolved: UnresolvedMention[];
  candidates: PageLink[];
  unresolvedCandidates: UnresolvedMention[];
}

export class PagesLinkIndexerService {
  private debounceMs = 300;
  private pending = new Map<string, NodeJS.Timeout>();

  // 0.1.96: all maps keyed by composite `${rootId}:${path}`. Resolution is
  // scoped to the source root only (default linkTargets: [] ⇒ today's behaviour);
  // cross-root `@`-autocomplete scope is applied client-side by the editor.
  private byPath = new Map<string, FileMeta>();
  private linkIndex = new Map<string, PageLink[]>();
  private reverseIndex = new Map<string, Set<string>>();
  private unresolved = new Map<string, UnresolvedMention[]>();

  constructor(private roots: Map<string, PagesService>, private ws: WsEmitter) {}

  private key(rootId: string, relPath: string): string {
    return `${rootId}:${relPath}`;
  }

  async indexAll(): Promise<void> {
    let fileCount = 0;
    for (const [rootId, svc] of this.roots) {
      const files = await svc.listMarkdownFiles();
      for (const rel of files) await this.parseAndStoreMeta(rootId, rel);
      for (const rel of files) await this.parseAndStoreLinks(rootId, rel, { silent: true });
      fileCount += files.length;
    }
    console.log(
      `[pages-link-indexer] indexed ${fileCount} pages, ${this.totalLinksCount()} links, ${this.unresolvedCount()} unresolved`
    );
  }

  schedulePage(rootId: string, relPath: string): void {
    const k = this.key(rootId, relPath);
    const prev = this.pending.get(k);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this.pending.delete(k);
      this.indexPage(rootId, relPath).catch((err) => {
        console.error(`[pages-link-indexer] failed to index ${k}:`, err);
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

    // Reverse index keyed by composite target `${rootId}:${targetPath}` (self-scope).
    const oldTargets = new Set(prevLinks.map((l) => this.key(rootId, l.targetPath)));
    const newTargets = new Set(resolvedLinks.map((l) => this.key(rootId, l.targetPath)));
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
      const t = this.key(rootId, l.targetPath);
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

  /** Resolve a candidate path within the SAME root (self-scope). */
  resolve(candidate: string, sourcePath: string, rootId: string): { path: string; anchor?: string } | null {
    if (!candidate) return null;
    const hashIdx = candidate.indexOf('#');
    const rawPath = hashIdx >= 0 ? candidate.slice(0, hashIdx) : candidate;
    const anchor = hashIdx >= 0 ? candidate.slice(hashIdx + 1) : undefined;
    const stripped = rawPath.replace(/^\/+/, '');
    if (!stripped) return null;

    const has = (p: string): boolean => this.byPath.has(this.key(rootId, p));

    if (sourcePath) {
      const dir = path.posix.dirname(sourcePath);
      const joined = path.posix.normalize(path.posix.join(dir, stripped));
      if (!joined.startsWith('..') && !joined.startsWith('/')) {
        if (has(joined)) return { path: joined, anchor };
        if (has(joined + '.md')) return { path: joined + '.md', anchor };
      }
    }

    const normalized = path.posix.normalize(stripped);
    if (normalized.startsWith('..') || normalized.startsWith('/')) return null;
    if (has(normalized)) return { path: normalized, anchor };
    if (has(normalized + '.md')) return { path: normalized + '.md', anchor };

    // Step 3b (0.1.100) — CWD-relative fallback. Agents writing prose usually type the
    // path relative to the project cwd, which includes the root's `dir` segment
    // (e.g. `@pages/reference/x.md` for a file keyed `reference/x.md` in root `pages`
    // whose dir='pages'). After the root-relative forms (steps 2–3) miss, strip the
    // source root's `dir/` prefix and retry exact + `.md`/`.mdx`. No-op when dir='.'
    // (both forms are identical). Precedence: root-relative always wins, so a genuine
    // file at relPath `<dir>/x.md` is matched above and never reaches this branch.
    const dir = this.roots.get(rootId)?.dir;
    if (dir && dir !== '.' && normalized.startsWith(dir + '/')) {
      const s = normalized.slice(dir.length + 1);
      if (has(s)) return { path: s, anchor };
      if (has(s + '.md')) return { path: s + '.md', anchor };
      if (has(s + '.mdx')) return { path: s + '.mdx', anchor };
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

  autocomplete(query: string, limit = 10): PageLinkAutocompleteItem[] {
    const q = query.trim().toLowerCase();
    if (!q) {
      const items: PageLinkAutocompleteItem[] = [];
      for (const meta of this.byPath.values()) {
        items.push({ path: meta.path, title: meta.title, matchScore: 0 });
      }
      items.sort((a, b) => a.path.localeCompare(b.path));
      return items.slice(0, limit);
    }
    const hits: PageLinkAutocompleteItem[] = [];
    for (const meta of this.byPath.values()) {
      const score = fuzzyScore(q, meta.path, meta.title);
      if (score > 0) {
        hits.push({ path: meta.path, title: meta.title, matchScore: score });
      }
    }
    hits.sort((a, b) => b.matchScore - a.matchScore || a.path.localeCompare(b.path));
    return hits.slice(0, limit);
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

function parseLinks(body: string): { candidates: PageLink[] } {
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
  return body.replace(FENCE_RE, (block) => block.replace(/[^\n]/g, ' '));
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
