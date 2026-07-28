import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { releasesApi } from '../lib/releases-api.js';
import { releasesService } from '../runtime/releases-service.js';

/**
 * The full release list — everything the host's `/releases` UI needs
 * (`description`, `createdBy`, `createdAt`). Host-only: the plugin surface gets
 * the narrower label mirror below.
 */
export function useReleaseList() {
  return useQuery({
    queryKey: ['releases'],
    queryFn: () => releasesService.listReleases(),
  });
}

/**
 * M17/L11: the release-label lookup — `releaseId → name`. This is the ONE
 * `useReleases` in the codebase: the host's own version-history timeline and
 * every plugin (via `@c4s/plugin-runtime`) read release labels through it, off
 * the same `['releases']` query, so there is a single fetch and a single shape.
 * A version with `release_id IS NULL` is simply absent from the map — callers
 * render "(unreleased)".
 */
export function useReleases(): Map<number, string> {
  const { data } = useReleaseList();
  return useMemo(() => new Map((data ?? []).map((r) => [r.id, r.name])), [data]);
}

export function useRelease(idOrName: string | number | undefined) {
  return useQuery({
    queryKey: ['release', String(idOrName ?? '')],
    queryFn: () => releasesApi.get(idOrName!),
    enabled: idOrName != null && String(idOrName).length > 0,
  });
}

/** Count of unreleased captures at HEAD — for the "You have N unreleased changes" banner. */
export function useUnreleasedCount() {
  return useQuery({
    queryKey: ['releases', 'unreleased-count'],
    queryFn: () => releasesApi.unreleasedCount(),
  });
}

export function useReleaseDiff(
  from: string | number | null | undefined,
  to: string | number | undefined,
) {
  return useQuery({
    queryKey: [
      'release-diff',
      from === null ? '__INITIAL__' : String(from ?? ''),
      String(to ?? ''),
    ],
    queryFn: () => releasesApi.diff(from as string | number | null, to!),
    enabled:
      to != null &&
      (from === null || (from !== undefined && String(from) !== String(to))),
  });
}

export function useReleaseSnapshot(idOrName: string | number | undefined) {
  return useQuery({
    queryKey: ['release-snapshot', String(idOrName ?? '')],
    queryFn: () => releasesApi.snapshot(idOrName!),
    enabled: idOrName != null && String(idOrName).length > 0,
  });
}

export function useCreateRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description: string }) => releasesApi.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['releases'] });
    },
  });
}

export function useUpdateRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      idOrName: string | number;
      name?: string;
      description?: string;
      assignUnreleased?: boolean;
    }) =>
      releasesApi.update(params.idOrName, {
        name: params.name,
        description: params.description,
        assignUnreleased: params.assignUnreleased,
      }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['releases'] });
      qc.invalidateQueries({ queryKey: ['release', String(updated.id)] });
      qc.invalidateQueries({ queryKey: ['release', updated.name] });
    },
  });
}

export function useRestoreEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { releaseId: string | number; type: string; slug: string }) =>
      releasesApi.restoreEntity(params.releaseId, { type: params.type, slug: params.slug }),
    onSuccess: () => {
      qc.invalidateQueries(); // restore touches everything
    },
  });
}

export function useRestorePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { releaseId: string | number; path: string }) =>
      releasesApi.restorePage(params.releaseId, { path: params.path }),
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}

export function useRestoreSpec() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (releaseId: string | number) => releasesApi.restoreSpec(releaseId),
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}
