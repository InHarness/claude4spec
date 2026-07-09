import { useQuery } from '@tanstack/react-query';
import { progressApi } from '../lib/progress-api.js';

/** M35 — spec-vs-code implementation progress + optional git status. */
export function useProgress() {
  return useQuery({
    queryKey: ['progress'],
    queryFn: () => progressApi.get(),
  });
}
