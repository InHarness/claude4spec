import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { gitApi } from '../lib/git-api.js';
import { GIT_STATUS_KEY } from '../lib/git-ws.js';

/**
 * M28 — git repo detection for the Settings Git section and (0.1.118) the
 * sidebar `GitStatusBadge`. `detect()` spawns several git subprocesses
 * server-side, so callers that only care about status when git integration
 * is actually on should pass `enabled: config?.git?.enabled === true` —
 * `GitStatusBadge` is mounted unconditionally in the sidebar (every page
 * load, for every project) and git is off by default, so an ungated fetch
 * there would be a wasted round trip for the common case.
 *
 * 2.1.10 (M28 8i5qf0xx "Stan"): besides the WS map (`git:status-changed` →
 * invalidate, `lib/git-ws.ts`), `["git-status"]` is read again when the window
 * regains focus — a change made outside the app (a terminal `git pull`) emits
 * no event. The app-wide `refetchOnWindowFocus` is off and React Query's own
 * focus manager only watches `visibilitychange`, so this hook listens to both
 * the window `focus` and the page becoming visible. `cancelRefetch: false`
 * dedupes the two (and several mounted callers) onto one request.
 */
export function useGitStatus(opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const refetch = () => {
      void qc.refetchQueries({ queryKey: GIT_STATUS_KEY, type: 'active' }, { cancelRefetch: false });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refetch();
    };
    window.addEventListener('focus', refetch);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', refetch);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [qc, enabled]);

  return useQuery({
    queryKey: GIT_STATUS_KEY,
    queryFn: () => gitApi.status(),
    enabled,
  });
}
