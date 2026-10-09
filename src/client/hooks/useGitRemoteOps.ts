import { useMutation, useQueryClient } from '@tanstack/react-query';
import { gitApi } from '../lib/git-api.js';
import { GIT_STATUS_KEY } from '../lib/git-ws.js';
import { useGitOpsStore } from '../state/gitOps.js';
import type { GitFetchResponse, GitSyncResponse } from '../../shared/git.js';

/**
 * 2.1.10 (M28 846dmtbu "Fetch i Sync") — `POST /api/git/fetch`. Resolves
 * (never rejects) with the domain outcome; the header entry turns it into a
 * toast or hint (`lib/git-results.ts`). The status is refreshed here as well as
 * by the `git:status-changed` event, so the counts update even if the socket
 * is reconnecting.
 */
export function useGitFetch() {
  const qc = useQueryClient();
  return useMutation<GitFetchResponse, Error, void>({
    mutationFn: () => gitApi.fetch(),
    onMutate: () => useGitOpsStore.getState().begin('fetch'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: GIT_STATUS_KEY });
    },
    onSettled: () => useGitOpsStore.getState().end('fetch'),
  });
}

const headChanged = (r: GitSyncResponse | undefined) =>
  r?.status === 'fast-forwarded' || r?.status === 'merged';

/**
 * Outcome handlers of one `useGitSync` caller. They run as mutation-level
 * callbacks, so — unlike callbacks passed to `mutate()`, which TanStack Query
 * drops once the component unmounts — they still fire when the caller is gone
 * (a `git-sync-recover` window replaced by another modal while Sync is in
 * flight): the reload after a HEAD change still happens, and with it the
 * `pending: 'sync'` mark is consumed instead of lingering.
 */
export interface GitSyncHandlers {
  onSuccess?: (result: GitSyncResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * 2.1.10 — `POST /api/git/sync`. After `fast-forwarded`/`merged` the caller
 * reloads the project route (M31 ic35jwy6), and the own-op mark stays until
 * then, so the WS map does not mistake this sync's `headChanged` event for
 * another client's.
 */
export function useGitSync(handlers: GitSyncHandlers = {}) {
  const qc = useQueryClient();
  return useMutation<GitSyncResponse, Error, void>({
    mutationFn: () => gitApi.sync(),
    onMutate: () => useGitOpsStore.getState().begin('sync'),
    onSuccess: (result) => {
      if (!headChanged(result)) void qc.invalidateQueries({ queryKey: GIT_STATUS_KEY });
      handlers.onSuccess?.(result);
    },
    onError: (error) => handlers.onError?.(error),
    onSettled: (result) => {
      if (!headChanged(result)) useGitOpsStore.getState().end('sync');
    },
  });
}
