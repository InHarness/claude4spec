import { useQuery } from '@tanstack/react-query';
import { gitApi } from '../lib/git-api.js';

/**
 * 0.1.123 — local branches for the interactive `GitStatusBadge` dropdown.
 * Callers should gate `enabled` on the dropdown actually being open (not just
 * `config.git.enabled`, unlike `useGitStatus`) — the branch list is only
 * needed while the user is picking, not on every badge mount.
 */
export function useGitBranches(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['git-branches'],
    queryFn: () => gitApi.branches(),
    enabled: opts.enabled ?? true,
  });
}
