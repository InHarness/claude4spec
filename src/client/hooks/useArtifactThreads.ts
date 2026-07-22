import { useInfiniteQuery } from '@tanstack/react-query';
import { apiFetch, handle } from '../lib/api-core.js';
import { encodeArtifactPath } from '../lib/artifact-path.js';
import type { ArtifactThreadListItem } from '../../shared/entities.js';

/** Artifact kinds the generic `/api/artifacts/:kind/...` family serves. */
export type ArtifactKind = 'brief' | 'patch' | 'plan';

/**
 * Rows per request. The endpoint's own default is 20; asking for a larger page
 * keeps the common artifact (a handful of threads) to a single round-trip while
 * still paging rather than truncating when there are many.
 */
const PAGE_SIZE = 50;

export const artifactThreadsKey = (kind: ArtifactKind, path: string) =>
  ['artifact', 'threads', kind, path] as const;

/**
 * 0.1.139: the one way a detail page lists the chat threads referencing its
 * artifact — `GET /api/artifacts/:kind/:path/threads`. Replaced
 * `usePlanThreads` (bespoke `/api/plans/:slug/threads`) and the brief/patch
 * pages' habit of reading `.threads` off the detail response, so a panel can
 * refetch its own list without pulling the whole artifact body with it.
 *
 * Paged, NOT capped. The three per-kind queries this replaced were unbounded,
 * so a plain `limit`-defaulted fetch would have silently hidden every thread
 * past the first page and reported a wrong count in the panel header — the
 * caller gets `fetchNextPage`/`hasNextPage` and surfaces them instead.
 *
 * `refetchOnMount: 'always'` because nothing invalidates this key when a thread
 * gains messages or is renamed/deleted (those happen in the chat overlay, far
 * from here). The panels mount on tab switch, so re-opening Threads always
 * shows current `messageCount`s and ordering rather than a stale session-old
 * snapshot.
 */
export function useArtifactThreads(kind: ArtifactKind, path: string | null) {
  const query = useInfiniteQuery({
    enabled: !!path,
    queryKey: artifactThreadsKey(kind, path ?? ''),
    initialPageParam: 0,
    refetchOnMount: 'always',
    queryFn: async ({ pageParam }) => {
      const res = await apiFetch(
        `/api/artifacts/${kind}/${encodeArtifactPath(path as string)}/threads` +
          `?limit=${PAGE_SIZE}&offset=${pageParam}`,
      );
      const env = await handle<{ data: ArtifactThreadListItem[] }>(res);
      return env.data;
    },
    // A short page means the end; a full one means there may be more.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAGE_SIZE ? undefined : allPages.length * PAGE_SIZE,
  });

  return {
    ...query,
    threads: query.data?.pages.flat() ?? [],
  };
}
