import { useQuery } from '@tanstack/react-query';
import { apiFetch, handle } from '../lib/api-core.js';
import { encodeArtifactPath } from '../lib/artifact-path.js';
import type { ArtifactKind } from './useArtifactThreads.js';

/** One `file_version` row as served by `GET /api/artifacts/:kind/:path/versions`. */
export interface FileVersionListItem {
  id: number;
  path: string;
  version: number;
  op: 'create' | 'update' | 'delete';
  changedBy: 'user' | 'agent' | 'filesystem';
  releaseId: number | null;
  serializerVersion: string;
  createdAt: string;
  rootId: string;
  changeSummary: string | null;
}

export const artifactVersionsKey = (kind: ArtifactKind, path: string) =>
  ['artifact', 'versions', kind, path] as const;

/**
 * 0.1.139: single query key per `/api/artifacts/:kind/:path/versions` URL.
 * `useBriefVersions` and `usePlanVersions` used to hold two independent keys
 * over the same endpoint with two locally-declared row types; both now delegate
 * here, and `<FileVersionHistory />` reads it directly.
 *
 * Rows arrive newest-first (the `file_version` log lists DESC), which callers
 * rely on — `PlanPage` derives the plan's current version from `[0]`.
 */
export function useArtifactVersions(kind: ArtifactKind, path: string | null) {
  return useQuery({
    enabled: !!path,
    queryKey: artifactVersionsKey(kind, path ?? ''),
    queryFn: async () => {
      const res = await apiFetch(
        `/api/artifacts/${kind}/${encodeArtifactPath(path as string)}/versions`,
      );
      const env = await handle<{ data: FileVersionListItem[] }>(res);
      return env.data;
    },
  });
}
