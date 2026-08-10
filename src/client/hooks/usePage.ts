import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

// 0.1.96: page queries/mutations are keyed by (rootId, path).
export function usePage(rootId: string, path: string | null) {
  return useQuery({
    queryKey: ['page', rootId, path],
    queryFn: () => api.read(rootId, path as string),
    enabled: Boolean(path),
    staleTime: 0,
  });
}

/**
 * A save re-reads the page instead of being handed it back.
 *
 * This used to seed `['page', …]` with the write's own response, which worked
 * only because the write echoed the whole `PageContent`. That echo is gone: the
 * server answers with the hash, the version and the anchors that moved, and a
 * caller that wants the page reads it. Invalidating costs one GET per save and
 * has the same end state — with the cache now holding what is on disk rather
 * than what the client believed it sent.
 *
 * The key comes from `vars`, not from the response: `path` is the caller's own
 * input, and the answer no longer carries one.
 */
export function useWritePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { rootId: string; path: string; body: string; frontmatter?: Record<string, unknown> }) =>
      api.write(args.rootId, args.path, args.body, args.frontmatter),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['page', vars.rootId, vars.path] });
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
