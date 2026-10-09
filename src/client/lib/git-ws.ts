import type { QueryKey } from '@tanstack/react-query';
import { useGitOpsStore } from '../state/gitOps.js';
import { setGitFlashToast } from './git-flash.js';
import { SYNC_UPDATED_TOAST } from './git-results.js';
import { reloadProjectRoute } from './project-reload.js';

/** React Query key of `GET /api/git/status` (M28 "Stan → Zapytania"). */
export const GIT_STATUS_KEY = ['git-status'] as const;

/**
 * 2.1.10 (M28 8i5qf0xx "Stan", M31 ic35jwy6) — the module's map
 * "WS event → query key":
 *
 * - `git:status-changed` → invalidate `["git-status"]`, so the client reads
 *   `GET /api/git/status` again;
 * - the same event with `headChanged: true`, caused by ANOTHER client's
 *   operation → reload the project route. When THIS client's own sync/checkout
 *   moved HEAD, its response handler reloads instead; an own sync parks the
 *   "Updated from the remote" toast first, because the server's context reload
 *   (`project:disposed`) may reload this tab before the response arrives.
 */
export function handleGitStatusChanged(
  event: { headChanged: boolean },
  deps: { queue(queryKey: QueryKey): void },
): void {
  deps.queue([...GIT_STATUS_KEY]);
  if (!event.headChanged) return;
  const own = useGitOpsStore.getState().pending;
  if (own === 'sync') {
    setGitFlashToast({ ...SYNC_UPDATED_TOAST });
    return;
  }
  if (own === 'checkout') return;
  reloadProjectRoute();
}
