import { useQuery } from '@tanstack/react-query';
import { remoteAccountApi } from '../lib/api.js';

/**
 * M24: remote-account identity for the sidebar "User" slot. Query key
 * `["remote-account"]` — invalidated/seeded by UserSection after login/logout.
 */
export function useRemoteAccount() {
  return useQuery({
    queryKey: ['remote-account'],
    queryFn: () => remoteAccountApi.get(),
  });
}
