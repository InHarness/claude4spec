import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, handle } from '../lib/api-core.js';
import type { ProjectionStatusRow } from '../../shared/projection-status.js';

/**
 * 0.2.77 — the settings card's data, and the source for the sidebar indicator
 * and the global banner alike.
 *
 * ONE key for all three surfaces, deliberately: they must never disagree about
 * whether something is stale, and the `index:status-changed` event invalidates
 * this key alone. Nothing polls — the WS event is the only refresh trigger.
 */
const KEY = ['index-status'] as const;

export interface IndexStatusResult {
  projections: ProjectionStatusRow[];
}

export function useIndexStatus() {
  return useQuery<IndexStatusResult>({
    queryKey: KEY,
    queryFn: () => apiFetch('/api/_meta/index-status').then(handle<IndexStatusResult>),
    // The card renders whatever the last answer was until the socket says
    // otherwise; a stale-time of 0 would refetch on every mount for no gain.
    staleTime: 30_000,
  });
}

/** Every projection currently marked stale — what the banner and the badge ask. */
export function staleRows(rows: readonly ProjectionStatusRow[] | undefined): ProjectionStatusRow[] {
  return (rows ?? []).filter((r) => r.state === 'stale');
}

/**
 * A GLOBAL marking is the only thing that raises the full-width banner.
 *
 * That narrowness is the point: the banner exists because in this state search,
 * entity lists and section writes all refuse, so a user who is not warned meets a
 * refusal on their first click. Local staleness leaves most of the app working
 * and gets the toast and the sidebar indicator instead.
 */
export function hasGlobalStale(rows: readonly ProjectionStatusRow[] | undefined): boolean {
  return staleRows(rows).some((r) => r.scope === 'global');
}

export function useRebuildIndex() {
  const qc = useQueryClient();
  return useMutation({
    // No `projection` means rebuild everything — the card's bulk button.
    mutationFn: (projection?: string) =>
      apiFetch('/api/_meta/index-status/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projection ? { projection } : {}),
      }).then(handle<IndexStatusResult>),
    onSuccess: (data: IndexStatusResult) => {
      // The response already carries the fresh snapshot, so the card updates
      // without a second round-trip; the WS event will arrive too and is harmless.
      if (data?.projections) qc.setQueryData(KEY, data);
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
}
