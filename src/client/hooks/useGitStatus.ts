import { useQuery } from '@tanstack/react-query';
import { gitApi } from '../lib/git-api.js';

/**
 * M28 — git repo detection for the Settings Git section and (0.1.118) the
 * sidebar `GitStatusBadge`. `detect()` spawns several git subprocesses
 * server-side, so callers that only care about status when git integration
 * is actually on should pass `enabled: config?.git?.enabled === true` —
 * `GitStatusBadge` is mounted unconditionally in the sidebar (every page
 * load, for every project) and git is off by default, so an ungated fetch
 * there would be a wasted round trip for the common case.
 */
export function useGitStatus(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['git-status'],
    queryFn: () => gitApi.status(),
    enabled: opts.enabled ?? true,
  });
}
