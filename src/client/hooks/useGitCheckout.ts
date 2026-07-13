import { useMutation, useQueryClient } from '@tanstack/react-query';
import { gitApi } from '../lib/git-api.js';
import type { GitCheckoutResponse } from '../../shared/git.js';

/**
 * 0.1.123 — `POST /api/git/checkout`. Resolves (never rejects) with the
 * domain outcome on `result.status`; the caller drives UI per-status (see
 * `GitStatusBadge`). On `'not-found'` the branch list is refetched since it
 * may be stale; on `'switched'` the caller does a full page reload instead of
 * query invalidation (queries won't survive it anyway).
 */
export function useGitCheckout() {
  const qc = useQueryClient();
  return useMutation<GitCheckoutResponse, Error, string>({
    mutationFn: (branch: string) => gitApi.checkout(branch),
    onSuccess: (result) => {
      if (result.status === 'not-found') {
        qc.invalidateQueries({ queryKey: ['git-branches'] });
      }
    },
  });
}
