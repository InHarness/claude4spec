import type { FileMeta, PageLinksListResponse } from '../../../shared/page-links.js';

function joinPosix(dir: string, rel: string): string {
  const segs = (dir + '/' + rel).split('/');
  const out: string[] = [];
  for (const seg of segs) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) {
        out.push('..');
      } else if (out[out.length - 1] === '..') {
        out.push('..');
      } else {
        out.pop();
      }
    } else {
      out.push(seg);
    }
  }
  return out.join('/');
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export interface PathIndex {
  has(path: string): boolean;
}

/** Title fallback: file basename without the .md/.mdx extension. */
export function basenameTitle(p: string): string {
  const base = p.split('/').pop() ?? p;
  return base.replace(/\.mdx?$/, '');
}

/**
 * Build the bare, root-relative path → {@link FileMeta} index the resolver looks up.
 *
 * The `/api/page-links` maps are keyed by composite `${rootId}:${relPath}` (and
 * `reverseLinks` values are composite source keys too). When `rootId` is given (the
 * editor's current root), we keep only that root's keys/values and strip the
 * `${rootId}:` prefix, leaving bare relPaths — this is the second half of the 0.1.100
 * fix: it lets {@link resolveAgainstIndex}'s dir-strip fallback match. When `rootId`
 * is omitted (e.g. chat's cross-root scope), keys are taken verbatim (legacy behaviour).
 */
export function buildPageRefIndex(
  list: PageLinksListResponse,
  rootId?: string,
): Map<string, FileMeta> {
  const paths = new Set<string>();
  const prefix = rootId ? `${rootId}:` : undefined;
  const add = (k: string): void => {
    if (!prefix) {
      paths.add(k);
    } else if (k.startsWith(prefix)) {
      paths.add(k.slice(prefix.length));
    }
  };
  for (const k of Object.keys(list.links)) add(k);
  for (const k of Object.keys(list.reverseLinks)) add(k);
  for (const sources of Object.values(list.reverseLinks)) sources.forEach(add);
  // Resolved link targets. `targetPath` is a bare relPath belonging to its source's root
  // (resolution is self-scope), so include it only when that source key matches `rootId`.
  for (const [k, links] of Object.entries(list.links)) {
    if (prefix && !k.startsWith(prefix)) continue;
    for (const l of links) paths.add(l.targetPath);
  }
  const map = new Map<string, FileMeta>();
  for (const p of paths) map.set(p, { path: p, title: basenameTitle(p), anchors: [] });
  return map;
}

export function resolveAgainstIndex(
  raw: string,
  index: PathIndex,
  sourcePath?: string,
  dir?: string,
): string | null {
  if (!raw) return null;
  const stripped = raw.replace(/^\/+/, '');
  if (!stripped) return null;

  if (sourcePath) {
    const joined = joinPosix(dirname(sourcePath), stripped);
    if (joined && !joined.startsWith('..')) {
      if (index.has(joined)) return joined;
      if (index.has(joined + '.md')) return joined + '.md';
    }
  }

  if (stripped.startsWith('..')) return null;
  if (index.has(stripped)) return stripped;
  if (index.has(stripped + '.md')) return stripped + '.md';

  // Step 3b (0.1.100) — mirror of the server CWD-relative fallback. The prose author
  // typed the path relative to the project cwd, which includes the root's `dir` segment
  // (`@pages/reference/x.md`); after the root-relative forms miss, strip `dir/` and retry.
  // No-op when dir='.'. `index` must hold bare, root-relative keys (callers narrow the
  // page-links response to the current root and strip the `${rootId}:` prefix first).
  if (dir && dir !== '.' && stripped.startsWith(dir + '/')) {
    const s = stripped.slice(dir.length + 1);
    if (index.has(s)) return s;
    if (index.has(s + '.md')) return s + '.md';
    if (index.has(s + '.mdx')) return s + '.mdx';
  }
  return null;
}
