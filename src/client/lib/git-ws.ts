import type { QueryKey } from '@tanstack/react-query';
import { useGitOpsStore } from '../state/gitOps.js';
import { setGitFlashToast } from './git-flash.js';
import { SYNC_UPDATED_TOAST } from './git-results.js';
import { reloadProjectRoute } from './project-reload.js';

/** React Query key of `GET /api/git/status` (M28 "Stan → Zapytania"). */
export const GIT_STATUS_KEY = ['git-status'] as const;

/** 2.1.46 — React Query key of `GET /api/git/shadows` (M28 8i5qf0xx "Stan → Zapytania"). */
export const GIT_SHADOWS_KEY = ['git-shadows'] as const;

/**
 * 2.1.10 (M28 8i5qf0xx "Stan", M31 ic35jwy6) — the module's map
 * "WS event → query key":
 *
 * - `git:status-changed` → invalidate `["git-status"]`, so the client reads
 *   `GET /api/git/status` again, and (2.1.46) `["git-shadows"]` — an accepted
 *   shadow leaves the list after the release commit, a shadow deleted on the
 *   remote after a Fetch;
 * - the same event with `headChanged: true`, caused by ANOTHER client's
 *   operation → reload the project route. When THIS client's own sync/checkout
 *   moved HEAD, its response handler reloads instead; an own sync parks the
 *   "Updated from the remote" toast first, because the server's context reload
 *   (`project:disposed`) may reload this tab before the response arrives.
 *   2.1.47 — THIS client's own shadow acceptance (M17 L5 m17ui001) moves HEAD
 *   with its release commit and does not reload at all: its success is the
 *   toast and the List tab, and the acceptance itself invalidates what it
 *   changed. The event may arrive before or after the acceptance's answer;
 *   either way it is attributed to the acceptance (`claimHeadChange`), and
 *   each own operation absorbs one HEAD event only — the next one is another
 *   client's and reloads.
 */
export function handleGitStatusChanged(
  event: { headChanged: boolean },
  deps: { queue(queryKey: QueryKey): void },
): void {
  deps.queue([...GIT_STATUS_KEY]);
  deps.queue([...GIT_SHADOWS_KEY]);
  if (!event.headChanged) return;
  const own = useGitOpsStore.getState().claimHeadChange();
  if (own === 'sync') {
    setGitFlashToast({ ...SYNC_UPDATED_TOAST });
    return;
  }
  // An own checkout reloads from its response; an own acceptance stays.
  if (own === null) reloadProjectRoute();
}

/**
 * 2.1.47 (M28 8i5qf0xx) — the live-update socket reconnected after a drop.
 * The server does not replay `git:status-changed`, so an own HEAD-moving
 * operation that has its answer but not yet its event lost that event for
 * good: its mark is dropped (`dropAnswered`), and the next HEAD move —
 * another client's — reloads as the M31 contract says.
 */
export function handleLiveUpdateReconnected(): void {
  useGitOpsStore.getState().dropAnswered();
}
