import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../lib/api-core.js';
import { remoteProjectApi } from '../lib/api.js';
import type {
  RemoteProjectInfo,
  UpdateRemoteProjectRequest,
} from '../../shared/remote-project.js';

/**
 * M26 §4 — fetch the local proxy `/api/remote-project`. Invalidated from
 * `usePatchConfig` (when `remoteProjectId` flips), the M24 logout flow,
 * M25 release-push success, and `useUpdateRemoteProject`. When the proxy
 * surfaces a 502 SESSION_EXPIRED (peer 401 → backend wiped the session
 * row), this hook also invalidates `['remote-account']` so the sidebar
 * UserSection re-renders as logged out (brief 0.1.32 §2d).
 */
export function useRemoteProject() {
  const qc = useQueryClient();
  return useQuery<RemoteProjectInfo>({
    queryKey: ['remote-project'],
    queryFn: async () => {
      try {
        return await remoteProjectApi.get();
      } catch (err) {
        if (err instanceof ApiError && err.code === 'SESSION_EXPIRED') {
          qc.invalidateQueries({ queryKey: ['remote-account'] });
        }
        throw err;
      }
    },
  });
}

/**
 * 0.1.32 M25 §1a — PATCH the remote project's name/description. Owner-only
 * (the form is hidden when isOwner=false). Invalidates the remote-project
 * query on success so the card re-renders with the freshly returned snapshot.
 */
export function useUpdateRemoteProject() {
  const qc = useQueryClient();
  return useMutation<RemoteProjectInfo, Error, UpdateRemoteProjectRequest>({
    mutationFn: (body) => remoteProjectApi.update(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['remote-project'] });
    },
  });
}
