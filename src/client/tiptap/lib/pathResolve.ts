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

export function resolveAgainstIndex(
  raw: string,
  index: PathIndex,
  sourcePath?: string,
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
  return null;
}

/**
 * 0.2.110 M14 — where a broken `@path` chip's file would be created: the raw
 * path joined to the source document's directory (a leading `/` means the root
 * top level), with `.md` added when no extension is given. `null` when the path
 * climbs out of the root.
 */
export function candidatePagePath(raw: string, sourcePath?: string): string | null {
  const absolute = raw.startsWith('/');
  const stripped = raw.replace(/^\/+/, '');
  if (!stripped) return null;
  const joined = !absolute && sourcePath ? joinPosix(dirname(sourcePath), stripped) : joinPosix('', stripped);
  if (!joined || joined.startsWith('..')) return null;
  return /\.[a-z0-9]+$/i.test(joined) ? joined : `${joined}.md`;
}
