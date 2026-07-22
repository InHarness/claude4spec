import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BriefCreateRequest } from '../../shared/entities.js';
import { briefsApi } from '../lib/briefs-api.js';
import { artifactVersionsKey } from './useArtifactVersions.js';
import { artifactThreadsKey } from './useArtifactThreads.js';

const keys = {
  list: (implemented?: boolean) => ['briefs', 'list', implemented ?? null] as const,
  detail: (path: string) => ['briefs', 'detail', path] as const,
  versions: (path: string) => artifactVersionsKey('brief', path),
};

export function useBriefs(opts: { implemented?: boolean } = {}) {
  return useQuery({
    queryKey: keys.list(opts.implemented),
    queryFn: () => briefsApi.list(opts),
  });
}

export function useBrief(briefPath: string | null) {
  return useQuery({
    enabled: !!briefPath,
    queryKey: keys.detail(briefPath ?? ''),
    queryFn: () => briefsApi.get(briefPath as string),
  });
}

export function useCreateBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BriefCreateRequest) => briefsApi.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['briefs', 'list'] });
    },
  });
}

export function useUpdateBriefContent(briefPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { content: string; expectedHash: string }) =>
      briefsApi.updateContent(briefPath, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.detail(briefPath) });
      qc.invalidateQueries({ queryKey: keys.versions(briefPath) });
    },
  });
}

export function useUpdateBriefFrontmatter(briefPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (frontmatter: Record<string, unknown>) =>
      briefsApi.updateFrontmatter(briefPath, frontmatter),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.detail(briefPath) });
      qc.invalidateQueries({ queryKey: ['briefs', 'list'] });
    },
  });
}

export function useSetBriefImplemented(briefPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (implemented: boolean) =>
      briefsApi.updateFrontmatter(briefPath, { implemented }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.detail(briefPath) });
      qc.invalidateQueries({ queryKey: ['briefs', 'list'] });
    },
  });
}

export function useCreateBriefThread(briefPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name?: string) => briefsApi.createThread(briefPath, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.detail(briefPath) });
      qc.invalidateQueries({ queryKey: artifactThreadsKey('brief', briefPath) });
    },
  });
}
