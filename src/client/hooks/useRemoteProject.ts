import { useQuery } from '@tanstack/react-query';
import { remoteProjectApi } from '../lib/api.js';
import type { RemoteProjectInfo } from '../../shared/remote-project.js';

/**
 * M26 §4 — fetch the local proxy `/api/remote-project`. Invalidated from
 * `usePatchConfig` (when `remoteProjectId` flips) and from the existing M24
 * logout flow + M25 release-push success. The query key is the single
 * canonical source for the Settings → Remote project section.
 */
export function useRemoteProject() {
  return useQuery<RemoteProjectInfo>({
    queryKey: ['remote-project'],
    queryFn: () => remoteProjectApi.get(),
  });
}
