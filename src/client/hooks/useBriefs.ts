import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BriefCreateRequest,
  BriefFrontmatterUpdateRequest,
} from '../../shared/entities.js';
import { briefsApi, encodeBriefPath } from '../lib/briefs-api.js';
import { handle } from '../lib/api-core.js';

const keys = {
  list: (implemented?: boolean) => ['briefs', 'list', implemented ?? null] as const,
  detail: (path: string) => ['briefs', 'detail', path] as const,
  threads: (path: string) => ['briefs', 'threads', path] as const,
  versions: (path: string) => ['briefs', 'versions', path] as const,
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

export function useBriefThreads(briefPath: string | null) {
  return useQuery({
    enabled: !!briefPath,
    queryKey: keys.threads(briefPath ?? ''),
    queryFn: () => briefsApi.listThreads(briefPath as string),
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
    mutationFn: (input: { content: string; expectedHash: string; changeSummary?: string }) =>
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
    mutationFn: (patch: BriefFrontmatterUpdateRequest) =>
      briefsApi.updateFrontmatter(briefPath, patch),
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

interface BriefVersionListItem {
  id: number;
  path: string;
  version: number;
  op: 'create' | 'update' | 'delete';
  changedBy: 'user' | 'agent' | 'filesystem';
  releaseId: number | null;
  serializerVersion: string;
  createdAt: string;
  changeSummary: string | null;
}

export function useBriefVersions(briefPath: string | null) {
  return useQuery({
    enabled: !!briefPath,
    queryKey: keys.versions(briefPath ?? ''),
    queryFn: async () => {
      const res = await fetch(`/api/briefs/${encodeBriefPath(briefPath as string)}/versions`);
      const env = await handle<{ data: BriefVersionListItem[] }>(res);
      return env.data;
    },
  });
}

export function useCreateBriefThread(briefPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name?: string) => briefsApi.createThread(briefPath, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.threads(briefPath) });
      qc.invalidateQueries({ queryKey: keys.detail(briefPath) });
    },
  });
}
