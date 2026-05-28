import { useMemo } from 'react';
import { usePageLinks } from './usePageLinks.js';
import type { FileMeta } from '../../shared/page-links.js';

/**
 * Builds the path → {@link FileMeta} index used by PageRefNode post-processors to
 * promote resolved `@path` references into chips. Backed by the shared, cached
 * `pageLinks` query, so calling this from several editors is cheap.
 */
export function usePagesIndex(): Map<string, FileMeta> | undefined {
  const pageLinks = usePageLinks();
  return useMemo<Map<string, FileMeta> | undefined>(() => {
    const list = pageLinks.data;
    if (!list) return undefined;
    const map = new Map<string, FileMeta>();
    const paths = new Set<string>();
    for (const p of Object.keys(list.links)) paths.add(p);
    for (const p of Object.keys(list.reverseLinks)) paths.add(p);
    for (const sources of Object.values(list.reverseLinks)) sources.forEach((p) => paths.add(p));
    for (const links of Object.values(list.links)) for (const l of links) paths.add(l.targetPath);
    for (const p of paths) map.set(p, { path: p, title: basenameTitle(p), anchors: [] });
    return map;
  }, [pageLinks.data]);
}

function basenameTitle(p: string): string {
  const base = p.split('/').pop() ?? p;
  return base.replace(/\.md$/, '');
}
