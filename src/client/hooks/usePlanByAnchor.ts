import { useQuery } from '@tanstack/react-query';
import { plansApi, type PlanAnchorRef } from '../lib/api.js';

/**
 * Resolve a heading anchor to a plan, mirroring {@link useSection}. Gated by `enabled`
 * so callers can keep page-first precedence: only fire this after the page-section
 * lookup has resolved to a miss. `data` is `undefined` while loading/disabled, `null`
 * when the anchor is not a plan anchor (404), or a `PlanAnchorRef` on a hit.
 */
export function usePlanByAnchor(anchor: string | null | undefined, enabled: boolean) {
  return useQuery<PlanAnchorRef | null>({
    queryKey: ['plan-by-anchor', anchor ?? 'none'],
    queryFn: () => plansApi.getByAnchor(anchor as string),
    enabled: Boolean(anchor) && enabled,
    staleTime: 30_000,
  });
}
