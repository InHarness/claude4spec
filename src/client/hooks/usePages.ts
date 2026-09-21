import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

/**
 * 0.1.96 multiroot: a page tree is keyed by `rootId`.
 *
 * 0.2.101: no default. The old fallback was the literal `'pages'`, which names
 * the base root only in a project that never renamed it — elsewhere it asked for
 * a space that does not exist and got a 404 tree. Callers that mean "the base
 * root" pass `useBaseRootId()`, and the query idles (`null`) until the config
 * resolves.
 */
export function usePages(rootId: string | null) {
  return useQuery({
    queryKey: ['pages', rootId],
    queryFn: () => api.tree(rootId!),
    enabled: !!rootId,
  });
}

export function usePagesSearch(query: string, rootId: string | null) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['pages-search', rootId, trimmed],
    queryFn: () => api.search(rootId!, trimmed),
    enabled: !!rootId && trimmed.length > 0,
    staleTime: 5_000,
  });
}
