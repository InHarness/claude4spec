import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PatchStatus } from '../../shared/entities.js';
import { patchesApi } from '../lib/patches-api.js';
import { artifactThreadsKey } from './useArtifactThreads.js';

const keys = {
  list: (brief?: string, status?: string) =>
    ['patches', 'list', brief ?? null, status ?? null] as const,
  detail: (path: string) => ['patches', 'detail', path] as const,
};

export function usePatches(opts: { brief?: string; status?: string } = {}) {
  return useQuery({
    queryKey: keys.list(opts.brief, opts.status),
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

export function useUpdatePatchStatus(patchPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: PatchStatus) => patchesApi.updateFrontmatter(patchPath, { status }),
    // ^ patchesApi.updateFrontmatter now takes a raw frontmatter bag
    //   (Record<string, unknown>) matching ArtifactFrontmatterUpdateRequest —
    //   `{ status }` still satisfies that shape structurally, no change needed.
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
