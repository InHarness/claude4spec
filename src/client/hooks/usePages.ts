import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

export function usePages() {
  return useQuery({
    queryKey: ['pages'],
    queryFn: () => api.tree(),
  });
}

export function usePagesSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['pages-search', trimmed],
    queryFn: () => api.search(trimmed),
    enabled: trimmed.length > 0,
    staleTime: 5_000,
  });
}
