import { useQuery } from '@tanstack/react-query';
import { gitApi } from '../lib/git-api.js';
import { GIT_SHADOWS_KEY } from '../lib/git-ws.js';

/**
 * 2.1.46 (M28 8i5qf0xx / 846dmtbu) — the shadow list `["git-shadows"]` from
 * `GET /api/git/shadows`, read by the header's „Shadows” section and by the
 * Shadows tab's picker on `/releases` (one query, one cache entry). Callers gate
 * `enabled`: the header only while its dropdown is open, the tab only with git
 * on and a detected repository. `git:status-changed` invalidates it
 * (`lib/git-ws.ts`).
 */
export function useGitShadows(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: GIT_SHADOWS_KEY,
    queryFn: () => gitApi.shadows(),
    enabled: opts.enabled ?? true,
  });
}
