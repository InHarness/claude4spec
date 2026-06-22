import { useQuery } from '@tanstack/react-query';
import { pageLinksApi } from '../lib/api.js';

export function usePageLinks() {
  return useQuery({
    queryKey: ['pageLinks', 'list'],
    queryFn: () => pageLinksApi.list(),
    // Several components subscribe to this key on one page load (editor index +
    // popovers) and StrictMode remounts in dev — staleTime lets them all share one
    // fetch instead of each re-fetching the full link graph. Invalidated live on
    // `pageLinks:changed` (useFileWatcher), so freshness is event-driven, not polled.
    staleTime: 30_000,
  });
}

export function usePageLinksCounts() {
  return useQuery({
    queryKey: ['pageLinks', 'counts'],
    queryFn: () => pageLinksApi.counts(),
    staleTime: 30_000,
  });
}

export function usePageAutocomplete(q: string, limit = 10) {
  return useQuery({
    queryKey: ['pageLinks', 'autocomplete', q, limit],
    queryFn: () => pageLinksApi.autocomplete(q, limit),
    staleTime: 30_000,
  });
}
