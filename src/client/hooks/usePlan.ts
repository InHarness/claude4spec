import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BlameBlock,
  Plan,
  PlanExecuteMode,
  PlanExecuteResult,
  PlanListItem,
  PlanVersion,
  PlanVersionMeta,
} from '../../shared/entities.js';

type Envelope<T> = { data: T };

const keys = {
  list: (opts: { search?: string; limit?: number; offset?: number } | undefined) =>
    ['plans-list', opts ?? {}] as const,
  byThread: (threadId: string) => ['plan', 'by-thread', threadId] as const,
  detail: (planId: number) => ['plan', 'detail', planId] as const,
  versions: (planId: number) => ['plan', 'versions', planId] as const,
  version: (planId: number, version: number) =>
    ['plan', 'version', planId, version] as const,
  blame: (planId: number) => ['plan', 'blame', planId] as const,
};

export interface PlanDetailResponse extends Plan {
  versions: PlanVersionMeta[];
  versionsTotal: number;
  threadCount: number;
  lastThreadId: string | null;
}

interface PlansListResponse {
  plans: PlanListItem[];
  total: number;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    const msg = body?.error?.message ?? res.statusText;
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function usePlans(opts: { search?: string; limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: keys.list(opts),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (opts.search) params.set('search', opts.search);
      if (typeof opts.limit === 'number') params.set('limit', String(opts.limit));
      if (typeof opts.offset === 'number') params.set('offset', String(opts.offset));
      const qs = params.toString();
      const url = qs ? `/api/plans?${qs}` : `/api/plans`;
      const body = await fetchJson<Envelope<PlansListResponse>>(url);
      return body.data;
    },
  });
}

export function usePlan(planId: number | null) {
  return useQuery({
    queryKey: planId === null ? ['plan', 'detail', 'none'] : keys.detail(planId),
    queryFn: async () => {
      const body = await fetchJson<Envelope<PlanDetailResponse>>(
        `/api/plans/${planId}`,
      );
      return body.data;
    },
    enabled: planId !== null,
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

export function usePlanVersions(planId: number | null) {
  return useQuery({
    queryKey: planId === null ? ['plan', 'versions', 'none'] : keys.versions(planId),
    queryFn: async () => {
      const body = await fetchJson<{ data: PlanVersionMeta[]; total: number }>(
        `/api/plans/${planId}/versions`,
      );
      return { versions: body.data, total: body.total };
    },
    enabled: planId !== null,
  });
}

export function usePlanVersion(planId: number | null, version: number | null) {
  return useQuery({
    queryKey:
      planId === null || version === null
        ? ['plan', 'version', 'none']
        : keys.version(planId, version),
    queryFn: async () => {
      const body = await fetchJson<Envelope<PlanVersion>>(
        `/api/plans/${planId}/versions/${version}`,
      );
      return body.data;
    },
    enabled: planId !== null && version !== null,
  });
}

export function usePlanBlame(planId: number | null) {
  return useQuery({
    queryKey: planId === null ? ['plan', 'blame', 'none'] : keys.blame(planId),
    queryFn: async () => {
      const body = await fetchJson<Envelope<BlameBlock[]>>(
        `/api/plans/${planId}/blame`,
      );
      return body.data;
    },
    enabled: planId !== null,
  });
}

export function useSavePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      planId: number;
      content: string;
      changeSummary?: string;
      threadId?: string;
    }) => {
      const body = await fetchJson<
        Envelope<{ plan: Plan; version: number }>
      >(`/api/plans/${input.planId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: input.content,
          changeSummary: input.changeSummary,
          threadId: input.threadId,
        }),
      });
      return body.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: keys.detail(data.plan.id) });
      qc.invalidateQueries({ queryKey: keys.versions(data.plan.id) });
      qc.invalidateQueries({ queryKey: keys.blame(data.plan.id) });
      qc.invalidateQueries({ queryKey: ['plan', 'by-thread'] });
      qc.invalidateQueries({ queryKey: ['plans-list'] });
    },
  });
}

export function useUpdatePlanTitle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { planId: number; title: string | null }) => {
      const body = await fetchJson<Envelope<Plan>>(
        `/api/plans/${input.planId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: input.title }),
        },
      );
      return body.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: keys.detail(data.id) });
      qc.invalidateQueries({ queryKey: ['plans-list'] });
    },
  });
}

export function useCreateThreadFromPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { planId: number }) => {
      const body = await fetchJson<Envelope<{ threadId: string }>>(
        `/api/plans/${input.planId}/create-thread`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      );
      return body.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: keys.detail(vars.planId) });
      qc.invalidateQueries({ queryKey: ['plans-list'] });
      qc.invalidateQueries({ queryKey: ['threads'] });
    },
  });
}

export function useExecutePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      planId: number;
      mode: PlanExecuteMode;
      threadId?: string;
    }) => {
      const body = await fetchJson<Envelope<PlanExecuteResult>>(
        `/api/plans/${input.planId}/execute`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: input.mode, threadId: input.threadId }),
        },
      );
      return body.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: keys.detail(vars.planId) });
      qc.invalidateQueries({ queryKey: ['threads'] });
      qc.invalidateQueries({ queryKey: ['plans-list'] });
    },
  });
}
