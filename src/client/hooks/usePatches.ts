import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { patchesApi } from '../lib/patches-api.js';
import { artifactThreadsKey } from './useArtifactThreads.js';

const keys = {
  list: (brief?: string, applied?: boolean) =>
    ['patches', 'list', brief ?? null, applied ?? null] as const,
  detail: (path: string) => ['patches', 'detail', path] as const,
};

export function usePatches(opts: { brief?: string; applied?: boolean } = {}) {
  return useQuery({
    queryKey: keys.list(opts.brief, opts.applied),
    queryFn: () => patchesApi.list(opts),
  });
}

export function usePatch(patchPath: string | null) {
  return useQuery({
    enabled: !!patchPath,
    queryKey: keys.detail(patchPath ?? ''),
    queryFn: () => patchesApi.get(patchPath as string),
  });
}

export function useUpdatePatchContent(patchPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { content: string; expectedHash: string }) =>
      patchesApi.updateContent(patchPath, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.detail(patchPath) });
      qc.invalidateQueries({ queryKey: ['patches', 'list'] });
    },
  });
}

/**
 * The user's door to the patch's `applied` flag — two-way. 2.1.4: setting it
 * `true` usually comes from the patch thread's agent (`mark_patch_applied`,
 * one-way); reverting to `false` is user-only, and this hook is how. An agent
 * write reaches open views through `patches:changed` (useFileWatcher).
 */
export function useSetPatchApplied(patchPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (applied: boolean) => patchesApi.updateFrontmatter(patchPath, { applied }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.detail(patchPath) });
      qc.invalidateQueries({ queryKey: ['patches', 'list'] });
    },
  });
}

export function useCreatePatchThread(patchPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name?: string) => patchesApi.createThread(patchPath, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.detail(patchPath) });
      qc.invalidateQueries({ queryKey: ['patches', 'list'] });
      qc.invalidateQueries({ queryKey: artifactThreadsKey('patch', patchPath) });
    },
  });
}
