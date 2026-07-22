import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api-core.js';
import { encodeArtifactPath } from '../lib/artifact-path.js';
import type { ArtifactThreadListItem, Plan, PlanFrontmatter } from '../../shared/entities.js';
import {
  artifactVersionsKey,
  useArtifactVersions,
  type FileVersionListItem,
} from './useArtifactVersions.js';
import { artifactThreadsKey } from './useArtifactThreads.js';

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

export type { FileVersionListItem };

const keys = {
  list: (opts: { search?: string } | undefined) => ['plans-list', opts ?? {}] as const,
  byThread: (threadId: string) => ['plan', 'by-thread', threadId] as const,
  threads: (planPath: string) => artifactThreadsKey('plan', planPath),
  lastThread: (planPath: string) => ['plan', 'last-thread', planPath] as const,
  detail: (planPath: string) => ['plan', 'detail', planPath] as const,
  versions: (planPath: string) => artifactVersionsKey('plan', planPath),
  version: (planPath: string, version: number) => ['plan', 'version', planPath, version] as const,
};

export interface PlanDetailResponse extends PlanArtifactResponse {
  threads: ArtifactThreadListItem[];
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

/**
 * 0.1.139: `usePlanThreads` (bespoke `GET /api/plans/:slug/threads`) is GONE —
 * use `useArtifactThreads('plan', planPath)`. What survives is this single-row
 * shortcut, which the threads panel's "Open last thread" button needs and the
 * generic listing does not cover (it answers "the freshest one" without
 * fetching a page of rows).
 */
export function usePlanLastThread(planPath: string | null) {
  return useQuery({
    queryKey: planPath === null ? ['plan', 'last-thread', 'none'] : keys.lastThread(planPath),
    queryFn: async () => {
      const body = await fetchJson<Envelope<{ threadId: string | null }>>(
        `/api/plans/${encodeArtifactPath(planPath!)}/last-thread`,
      );
      return body.data.threadId;
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

/**
 * 0.1.127: version history moved to the generic M36 family + `file_version` — no
 * more per-action metadata (see brief 0-1-126-to-0-1-127 drift notes).
 * 0.1.139: the fetch itself is `useArtifactVersions`, shared with
 * `<FileVersionHistory />`; this wrapper only keeps the `{ versions, total }`
 * shape `ComparePanel`/`PlanPage` read.
 */
export function usePlanVersions(planPath: string | null) {
  const q = useArtifactVersions('plan', planPath);
  const versions = q.data ?? [];
  return { ...q, data: q.data ? { versions, total: versions.length } : undefined };
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

/**
 * 0.1.138: the single "run a plan" path. `useExecutePlan` (POST
 * /api/plans/:slug/execute, modes new-session/continue) is gone — the execution
 * prompt is now a client-side composer draft, see PlanPage's footer.
 */
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
      qc.invalidateQueries({ queryKey: keys.lastThread(vars.planPath) });
      qc.invalidateQueries({ queryKey: ['plans-list'] });
      qc.invalidateQueries({ queryKey: ['threads'] });
    },
  });
}
