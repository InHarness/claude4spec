import { useQuery } from '@tanstack/react-query';
import { gitApi } from '../lib/git-api.js';

/** M28 — git repo detection for the Settings Git section. */
export function useGitStatus() {
  return useQuery({
    queryKey: ['git-status'],
    queryFn: () => gitApi.status(),
  });
}
