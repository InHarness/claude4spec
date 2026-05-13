import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import type { PageContent } from '../../shared/types.js';

export function usePage(path: string | null) {
  return useQuery({
    queryKey: ['page', path],
    queryFn: () => api.read(path as string),
    enabled: Boolean(path),
    staleTime: 0,
  });
}

export function useWritePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { path: string; body: string; frontmatter?: Record<string, unknown> }) =>
      api.write(args.path, args.body, args.frontmatter),
    onSuccess: (data: PageContent) => {
      qc.setQueryData(['page', data.path], data);
      qc.invalidateQueries({ queryKey: ['pages'] });
    },
  });
}

export function useDeletePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.remove(path),
    onSuccess: (_data, path) => {
      qc.removeQueries({ queryKey: ['page', path] });
      qc.invalidateQueries({ queryKey: ['pages'] });
    },
  });
}
