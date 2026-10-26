import { useQuery } from '@tanstack/react-query';
import { gitApi } from '../lib/git-api.js';

/**
 * 0.1.123 — local branches (`GET /api/git/branches`). 2.1.49 (M28 ja538czb):
 * two consumers — the interactive `GitStatusBadge` dropdown in the header and
 * the `Commit target` lists of the `#git` settings card. Callers should gate
 * `enabled` on the list actually being shown (the dropdown open, a non-`current`
 * commit target with a detected repository) — not just `config.git.enabled`,
 * unlike `useGitStatus`.
 */
export function useGitBranches(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['git-branches'],
    queryFn: () => gitApi.branches(),
    enabled: opts.enabled ?? true,
  });
}
