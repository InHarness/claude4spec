import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import type { PageContent } from '../../shared/types.js';

// 0.1.96: page queries/mutations are keyed by (rootId, path).
export function usePage(rootId: string, path: string | null) {
  return useQuery({
    queryKey: ['page', rootId, path],
    queryFn: () => api.read(rootId, path as string),
    enabled: Boolean(path),
    staleTime: 0,
  });
}

export function useWritePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { rootId: string; path: string; body: string; frontmatter?: Record<string, unknown> }) =>
      api.write(args.rootId, args.path, args.body, args.frontmatter),
    onSuccess: (data: PageContent, vars) => {
      qc.setQueryData(['page', vars.rootId, data.path], data);
      qc.invalidateQueries({ queryKey: ['pages', vars.rootId] });
    },
  });
}

export function useDeletePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { rootId: string; path: string }) => api.remove(args.rootId, args.path),
    onSuccess: (_data, vars) => {
      qc.removeQueries({ queryKey: ['page', vars.rootId, vars.path] });
      qc.invalidateQueries({ queryKey: ['pages', vars.rootId] });
    },
  });
}
