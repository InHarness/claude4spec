import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api-core.js';
import { encodeArtifactPath } from '../lib/artifact-path.js';
import type {
  Plan,
  PlanExecuteMode,
  PlanExecuteResult,
  PlanFrontmatter,
  PlanThreadItem,
} from '../../shared/entities.js';

type Envelope<T> = { data: T };

interface ArtifactListItem {
  path: string;
  frontmatter: Record<string, unknown>;
  hash: string;
  updatedAt: string | null;
}

interface PlanArtifactResponse {
  path: string;
  frontmatter: PlanFrontmatter;
  body: string;
  content: string;
  hash: string;
}

export interface FileVersionListItem {
  id: number;
  path: string;
  version: number;
  op: 'create' | 'update' | 'delete';
  changedBy: 'user' | 'agent' | 'filesystem';
  releaseId: number | null;
  serializerVersion: string;
  createdAt: string;
  rootId: string;
  changeSummary: string | null;
}

const keys = {
  list: (opts: { search?: string } | undefined) => ['plans-list', opts ?? {}] as const,
  byThread: (threadId: string) => ['plan', 'by-thread', threadId] as const,
  threads: (planPath: string) => ['plan', 'threads', planPath] as const,
  detail: (planPath: string) => ['plan', 'detail', planPath] as const,
  versions: (planPath: string) => ['plan', 'versions', planPath] as const,
  version: (planPath: string, version: number) => ['plan', 'version', planPath, version] as const,
};

export interface PlanDetailResponse extends PlanArtifactResponse {
  threads: PlanThreadItem[];
}

export interface PlanListEntry {
  path: string;
  title: string | null;
  updatedAt: string | null;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    const msg = body?.error?.message ?? res.statusText;
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

/** 0.1.127: plan listing moved to the generic M36 family (`GET /api/plans` is gone). */
export function usePlans(opts: { search?: string } = {}) {
  return useQuery({
    queryKey: keys.list(opts),
    queryFn: async (): Promise<PlanListEntry[]> => {
      const params = new URLSearchParams();
      if (opts.search) params.set('search', opts.search);
      const qs = params.toString();
      const url = qs ? `/api/artifacts/plan?${qs}` : `/api/artifacts/plan`;
      const body = await fetchJson<Envelope<ArtifactListItem[]>>(url);
      return body.data.map((item) => ({
        path: item.path,
        title: typeof item.frontmatter.title === 'string' ? item.frontmatter.title : null,
        updatedAt: item.updatedAt,
      }));
    },
  });
}

/** 0.1.127: identity is now the file path (slug), not a numeric id — mirrors briefs/patches. */
export function usePlan(planPath: string | null) {
  return useQuery({
    queryKey: planPath === null ? ['plan', 'detail', 'none'] : keys.detail(planPath),
    queryFn: async () => {
      const body = await fetchJson<Envelope<PlanDetailResponse>>(
        `/api/artifacts/plan/${encodeArtifactPath(planPath!)}`,
      );
      return body.data;
    },
    enabled: planPath !== null,
  });
}

export function usePlanThreads(planPath: string | null) {
  return useQuery({
    queryKey: planPath === null ? ['plan', 'threads', 'none'] : keys.threads(planPath),
    queryFn: async () => {
      const body = await fetchJson<Envelope<PlanThreadItem[]>>(
        `/api/plans/${encodeArtifactPath(planPath!)}/threads`,
      );
      return body.data;
    },
    enabled: planPath !== null,
  });
}

export function usePlanByThread(threadId: string | null) {
  return useQuery({
    queryKey:
      threadId === null ? ['plan', 'by-thread', 'none'] : keys.byThread(threadId),
    queryFn: async () => {
      const body = await fetchJson<Envelope<Plan | null>>(
        `/api/plans/by-thread/${threadId}`,
      );
      return body.data;
    },
    enabled: threadId !== null,
  });
}

/** 0.1.127: version history moved to the generic M36 family + `file_version` — no more per-action metadata (see brief 0-1-126-to-0-1-127 drift notes). */
export function usePlanVersions(planPath: string | null) {
  return useQuery({
    queryKey: planPath === null ? ['plan', 'versions', 'none'] : keys.versions(planPath),
    queryFn: async () => {
      const body = await fetchJson<Envelope<FileVersionListItem[]>>(
        `/api/artifacts/plan/${encodeArtifactPath(planPath!)}/versions`,
      );
      return { versions: body.data, total: body.data.length };
    },
    enabled: planPath !== null,
  });
}

export function usePlanVersion(planPath: string | null, version: number | null) {
  return useQuery({
    queryKey:
      planPath === null || version === null
        ? ['plan', 'version', 'none']
        : keys.version(planPath, version),
    queryFn: async () => {
      const body = await fetchJson<Envelope<FileVersionListItem & { data: { content: string } }>>(
        `/api/artifacts/plan/${encodeArtifactPath(planPath!)}/versions/${version}`,
      );
      return body.data;
    },
    enabled: planPath !== null && version !== null,
  });
}

/**
 * 0.1.127: full-content save now goes through the generic
 * `PUT /api/artifacts/plan/:path/content` — optimistic concurrency via
 * `expectedHash` (409 on conflict), same contract as briefs/patches. The old
 * `PUT /api/plans/:planId` (no hash required, always won) is gone.
 */
export function useSavePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { planPath: string; content: string; expectedHash: string }) => {
      const body = await fetchJson<Envelope<PlanArtifactResponse>>(
        `/api/artifacts/plan/${encodeArtifactPath(input.planPath)}/content`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: input.content, expectedHash: input.expectedHash }),
        },
      );
      return body.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: keys.detail(data.path) });
      qc.invalidateQueries({ queryKey: keys.versions(data.path) });
      qc.invalidateQueries({ queryKey: ['plan', 'by-thread'] });
      qc.invalidateQueries({ queryKey: ['plans-list'] });
    },
  });
}

export function useUpdatePlanTitle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { planPath: string; title: string }) => {
      const body = await fetchJson<Envelope<PlanArtifactResponse>>(
        `/api/artifacts/plan/${encodeArtifactPath(input.planPath)}/frontmatter`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frontmatter: { title: input.title } }),
        },
      );
      return body.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: keys.detail(data.path) });
      qc.invalidateQueries({ queryKey: ['plans-list'] });
    },
  });
}

export function useCreateThreadFromPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { planPath: string }) => {
      const body = await fetchJson<Envelope<{ threadId: string }>>(
        `/api/plans/${encodeArtifactPath(input.planPath)}/create-thread`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      );
      return body.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: keys.detail(vars.planPath) });
      qc.invalidateQueries({ queryKey: keys.threads(vars.planPath) });
      qc.invalidateQueries({ queryKey: ['plans-list'] });
      qc.invalidateQueries({ queryKey: ['threads'] });
    },
  });
}

export function useExecutePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      planPath: string;
      mode: PlanExecuteMode;
      threadId?: string;
    }) => {
      const body = await fetchJson<Envelope<PlanExecuteResult>>(
        `/api/plans/${encodeArtifactPath(input.planPath)}/execute`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: input.mode, threadId: input.threadId }),
        },
      );
      return body.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: keys.detail(vars.planPath) });
      qc.invalidateQueries({ queryKey: keys.threads(vars.planPath) });
      qc.invalidateQueries({ queryKey: ['threads'] });
      qc.invalidateQueries({ queryKey: ['plans-list'] });
    },
  });
}
