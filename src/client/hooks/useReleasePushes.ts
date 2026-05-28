import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { releasePushesApi } from '../lib/release-pushes-api.js';
import type { ReleasePushResponse } from '../../shared/release-push.js';

/** Audit log for one release (key `['release-pushes', { releaseId }]`). */
export function useReleasePushes(releaseId: number | undefined) {
  return useQuery({
    queryKey: ['release-pushes', { releaseId }],
    queryFn: () => releasePushesApi.listForRelease(releaseId!),
    enabled: releaseId != null,
  });
}

/** Whole audit log — used by the releases list to derive per-release push counts. */
export function useAllReleasePushes() {
  return useQuery({
    queryKey: ['release-pushes', 'all'],
    queryFn: () => releasePushesApi.listAll(),
  });
}

export function usePushRelease() {
  const qc = useQueryClient();
  return useMutation<ReleasePushResponse, Error, number>({
    mutationFn: (releaseId: number) => releasePushesApi.push(releaseId),
    onSuccess: () => {
      // Refresh push history (both per-release and 'all'), plus config
      // (remoteProjectId changes on first push) and the releases list (badges).
      // M26: also refresh remote-project so the Settings card reflects the
      // newly-created or freshly-pushed project.
      qc.invalidateQueries({ queryKey: ['release-pushes'] });
      qc.invalidateQueries({ queryKey: ['config'] });
      qc.invalidateQueries({ queryKey: ['releases'] });
      qc.invalidateQueries({ queryKey: ['remote-project'] });
    },
  });
}
