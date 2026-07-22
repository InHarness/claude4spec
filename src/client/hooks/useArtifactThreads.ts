import { useQuery } from '@tanstack/react-query';
import { apiFetch, handle } from '../lib/api-core.js';
import { encodeArtifactPath } from '../lib/artifact-path.js';
import type { ArtifactThreadListItem } from '../../shared/entities.js';

/** Artifact kinds the generic `/api/artifacts/:kind/...` family serves. */
export type ArtifactKind = 'brief' | 'patch' | 'plan';

export const artifactThreadsKey = (kind: ArtifactKind, path: string) =>
  ['artifact', 'threads', kind, path] as const;

/**
 * 0.1.139: the one way a detail page lists the chat threads referencing its
 * artifact — `GET /api/artifacts/:kind/:path/threads`. Replaced
 * `usePlanThreads` (bespoke `/api/plans/:slug/threads`) and the brief/patch
 * pages' habit of reading `.threads` off the detail response, so a panel can
 * refetch its own list without pulling the whole artifact body with it.
 */
export function useArtifactThreads(kind: ArtifactKind, path: string | null) {
  return useQuery({
    enabled: !!path,
    queryKey: artifactThreadsKey(kind, path ?? ''),
    queryFn: async () => {
      const res = await apiFetch(
        `/api/artifacts/${kind}/${encodeArtifactPath(path as string)}/threads`,
      );
      const env = await handle<{ data: ArtifactThreadListItem[] }>(res);
      return env.data;
    },
  });
}
