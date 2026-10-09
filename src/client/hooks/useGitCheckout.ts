import { useMutation, useQueryClient } from '@tanstack/react-query';
import { gitApi } from '../lib/git-api.js';
import { useGitOpsStore } from '../state/gitOps.js';
import type { GitCheckoutResponse } from '../../shared/git.js';

/**
 * 0.1.123 — `POST /api/git/checkout`. Resolves (never rejects) with the
 * domain outcome on `result.status`; the caller drives UI per-status (see
 * `GitStatusBadge`). On `'not-found'` the branch list is refetched since it
 * may be stale; on `'switched'` the caller reloads the project route instead of
 * query invalidation (queries won't survive it anyway).
 *
 * 2.1.10: registers itself as this client's own git op, so the WS map does not
 * treat the `headChanged` event of this very checkout as another client's. A
 * `switched` result keeps the mark until the reload.
 */
export function useGitCheckout() {
  const qc = useQueryClient();
  return useMutation<GitCheckoutResponse, Error, string>({
    mutationFn: (branch: string) => gitApi.checkout(branch),
    onMutate: () => useGitOpsStore.getState().begin('checkout'),
    onSuccess: (result) => {
      if (result.status === 'not-found') {
        qc.invalidateQueries({ queryKey: ['git-branches'] });
      }
    },
    onSettled: (result) => {
      if (result?.status !== 'switched') useGitOpsStore.getState().end('checkout');
    },
  });
}
