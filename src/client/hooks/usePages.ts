import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

/**
 * 0.1.96 multiroot: a page tree is keyed by `rootId`. Defaults to the mandatory
 * built-in `'pages'` root so zero-arg legacy callers keep working.
 */
export function usePages(rootId = 'pages') {
  return useQuery({
    queryKey: ['pages', rootId],
    queryFn: () => api.tree(rootId),
  });
}

export function usePagesSearch(query: string, rootId = 'pages') {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['pages-search', rootId, trimmed],
    queryFn: () => api.search(rootId, trimmed),
    enabled: trimmed.length > 0,
    staleTime: 5_000,
  });
}
