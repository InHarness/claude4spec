import { useQuery } from '@tanstack/react-query';
import { pageLinksApi } from '../lib/api.js';

export function usePageLinks() {
  return useQuery({
    queryKey: ['pageLinks', 'list'],
    queryFn: () => pageLinksApi.list(),
  });
}

export function usePageLinksCounts() {
  return useQuery({
    queryKey: ['pageLinks', 'counts'],
    queryFn: () => pageLinksApi.counts(),
  });
}

export function usePageAutocomplete(q: string, limit = 10) {
  return useQuery({
    queryKey: ['pageLinks', 'autocomplete', q, limit],
    queryFn: () => pageLinksApi.autocomplete(q, limit),
    staleTime: 30_000,
  });
}
