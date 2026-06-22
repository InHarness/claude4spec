import { useQuery } from '@tanstack/react-query';
import { apiFetch, handle } from '../lib/api-core.js';
import type { EntityCountsResponse } from '../../shared/entities.js';

/**
 * Per-type entity counts for the sidebar ELEMENTS badges. One light aggregate
 * (`GET /api/entities/counts`) instead of fetching every entity's full list just
 * to read `.length` on each page view. Full entity lists stay lazy (entity index
 * pages, embed nodes, mention-autocomplete fetch them on demand).
 */
export function useEntityCounts() {
  return useQuery({
    queryKey: ['entities', 'counts'],
    queryFn: async () => handle<EntityCountsResponse>(await apiFetch('/api/entities/counts')),
    staleTime: 30_000,
  });
}
