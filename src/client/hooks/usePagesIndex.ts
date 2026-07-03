import { useMemo } from 'react';
import { usePageLinks } from './usePageLinks.js';
import { buildPageRefIndex } from '../tiptap/lib/pathResolve.js';
import type { FileMeta } from '../../shared/page-links.js';

/**
 * Builds the path → {@link FileMeta} index used by PageRefNode post-processors to
 * promote resolved `@path` references into chips. Backed by the shared, cached
 * `pageLinks` query, so calling this from several editors is cheap.
 *
 * Pass the editor's current `rootId` (0.1.100) to narrow the index to that root and
 * strip the composite `${rootId}:` prefix, yielding bare relPath keys the resolver's
 * dir-strip fallback can match. Omit it for cross-root callers (legacy behaviour).
 */
export function usePagesIndex(rootId?: string): Map<string, FileMeta> | undefined {
  const pageLinks = usePageLinks();
  return useMemo<Map<string, FileMeta> | undefined>(() => {
    const list = pageLinks.data;
    if (!list) return undefined;
    return buildPageRefIndex(list, rootId);
  }, [pageLinks.data, rootId]);
}
