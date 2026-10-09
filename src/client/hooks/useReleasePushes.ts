import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { releasePushesApi } from '../lib/release-pushes-api.js';
import type { ReleasePushResponse } from '../../shared/release-push.js';

/** Query key of one release's audit log — addressed by name (2.1.11). */
export function releasePushesKey(releaseName: string | undefined) {
  return ['release-pushes', { releaseName }] as const;
}

/** Audit log for one release (key `['release-pushes', { releaseName }]`). */
export function useReleasePushes(releaseName: string | undefined) {
  return useQuery({
    queryKey: releasePushesKey(releaseName),
    queryFn: () => releasePushesApi.listForRelease(releaseName!),
    enabled: releaseName != null && releaseName.length > 0,
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
  return useMutation<ReleasePushResponse, Error, string>({
    mutationFn: (releaseName: string) => releasePushesApi.push(releaseName),
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
