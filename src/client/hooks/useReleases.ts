import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { releasesApi } from '../lib/releases-api.js';
import { releasesService } from '../runtime/releases-service.js';
import { releasePushesKey } from './useReleasePushes.js';

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

/** 2.1.11: a release is addressed by name only — the key is `['release', name]`. */
export function useRelease(name: string | undefined) {
  return useQuery({
    queryKey: ['release', name ?? ''],
    queryFn: () => releasesApi.get(name!),
    enabled: name != null && name.length > 0,
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
  from: string | null | undefined,
  to: string | undefined,
) {
  return useQuery({
    queryKey: [
      'release-diff',
      from === null ? '__INITIAL__' : (from ?? ''),
      to ?? '',
    ],
    queryFn: () => releasesApi.diff(from as string | null, to!),
    enabled: to != null && (from === null || (from !== undefined && from !== to)),
  });
}

export function useReleaseSnapshot(name: string | undefined) {
  return useQuery({
    queryKey: ['release-snapshot', name ?? ''],
    queryFn: () => releasesApi.snapshot(name!),
    enabled: name != null && name.length > 0,
  });
}

export function useCreateRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description: string }) => releasesApi.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['releases'] });
      // A release's rank places briefs on the release axis (server-computed).
      qc.invalidateQueries({ queryKey: ['briefs', 'list'] });
    },
  });
}

export function useUpdateRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      releaseName: string;
      name?: string;
      description?: string;
      assignUnreleased?: boolean;
    }) =>
      releasesApi.update(params.releaseName, {
        name: params.name,
        description: params.description,
        assignUnreleased: params.assignUnreleased,
      }),
    onSuccess: (updated, params) => {
      qc.invalidateQueries({ queryKey: ['releases'] });
      // A rename moves briefs on the release axis (rank is looked up by name).
      qc.invalidateQueries({ queryKey: ['briefs', 'list'] });
      // 2.1.11: the screen's queries are keyed by name, so a rename re-keys them:
      // the new name gets the fresh detail, the old name's entries are dropped —
      // an address with the old name then behaves like any unknown name.
      const oldName = params.releaseName;
      if (updated.name !== oldName) {
        qc.removeQueries({ queryKey: ['release', oldName], exact: true });
        qc.removeQueries({ queryKey: ['release-snapshot', oldName], exact: true });
        qc.removeQueries({ queryKey: releasePushesKey(oldName), exact: true });
        qc.invalidateQueries({ queryKey: ['release-diff'] });
      }
      qc.setQueryData(['release', updated.name], updated);
      qc.invalidateQueries({ queryKey: ['release', updated.name] });
      qc.invalidateQueries({ queryKey: releasePushesKey(updated.name) });
    },
  });
}

// 0.1.143: `useRestoreEntity` (release-scoped per-entity restore) is gone. Entity
// history restores through M13 `useRestoreVersion` — one path for the host and
// for plugins. The release-scoped restore stays available for whole-release and
// page scopes (`useRestorePage` / `useRestoreSpec` below) and, for a single
// entity, via `releasesApi.restoreEntity` over REST/MCP.

export function useRestorePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { releaseName: string; path: string }) =>
      releasesApi.restorePage(params.releaseName, { path: params.path }),
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}

export function useRestoreSpec() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (releaseName: string) => releasesApi.restoreSpec(releaseName),
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}
