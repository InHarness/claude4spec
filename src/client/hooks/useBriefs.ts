import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BriefCreateRequest } from '../../shared/entities.js';
import { bodyOf } from '../lib/artifact-frontmatter.js';
import { briefsApi, type BriefDetailResponse } from '../lib/briefs-api.js';
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
    onSuccess: (written, input) => {
      // 2.1.48: the detail read is the WHOLE brief file (the route's default
      // projection), so refetching it after every debounced autosave would
      // re-download the entire brief just to learn the new hash — and a second
      // autosave fired during that long refetch would send the stale hash and
      // hit a spurious 409. The client holds the content it just sent and the
      // PUT answers hash + frontmatter: write the detail cache directly.
      qc.setQueryData<BriefDetailResponse>(keys.detail(briefPath), (prev) =>
        prev
          ? {
              ...prev,
              content: input.content,
              body: bodyOf(input.content),
              hash: written.hash,
              frontmatter: written.frontmatter,
            }
          : prev,
      );
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
      // 2.1.48: only the threads list changed. The detail read is the WHOLE
      // brief file (the route's default projection), and a new thread does not
      // touch it — refetching it here re-downloaded the brief for nothing.
      qc.invalidateQueries({ queryKey: artifactThreadsKey('brief', briefPath) });
    },
  });
}
