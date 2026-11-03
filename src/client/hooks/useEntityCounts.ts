import { useQuery } from '@tanstack/react-query';
import { apiFetch, handle } from '../lib/api-core.js';
import type { EntityCountsResponse } from '../../shared/entities.js';

/**
 * The query key of the entity counts map. 2.1.65 (M13 `m13ui000`): it sits
 * under the `['entities']` aggregate prefix, so the host's WS observer refreshes
 * the WHOLE map after every entity change, index change, tag change and plugin
 * reload (`entityChangeKeys` / `tagChangeKeys` / `plugin:reloaded` all
 * invalidate `['entities']`). There is no key for one type's count, so a single
 * type's counter is never refreshed on its own.
 */
export const ENTITY_COUNTS_KEY = ['entities', 'counts'] as const;

/**
 * Per-type entity counts for the sidebar ELEMENTS badges. One light aggregate
 * (`GET /api/entities/counts`, `{ counts }`) instead of fetching every entity's
 * full list just to read `.length` on each page view. Full entity lists stay
 * lazy (entity index pages, embed nodes, mention-autocomplete fetch them on
 * demand). The hook hands its consumers the map itself: the host shows, beside
 * each type entry, the number this map holds for it.
 */
export function useEntityCounts() {
  return useQuery({
    queryKey: ENTITY_COUNTS_KEY,
    queryFn: async () => handle<EntityCountsResponse>(await apiFetch('/api/entities/counts')),
    select: (response: EntityCountsResponse): Record<string, number> => response.counts,
    staleTime: 30_000,
  });
}
