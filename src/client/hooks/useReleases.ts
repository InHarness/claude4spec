import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { releasesApi } from '../lib/releases-api.js';
import { CURRENT_RELEASE_NAME } from '../../shared/entities.js';
import { unreleasedCountOf } from '../../shared/unreleased-counter.js';
import { releasesService } from '../runtime/releases-service.js';
import { releasePushesKey } from './useReleasePushes.js';

/**
 * The full release list — everything the host's `/releases` UI needs
 * (`description`, `createdBy`, `createdAt`). Host-only: the plugin surface gets
 * the narrower label mirror below.
 */
export function useReleaseList(opts: { refetchOnMount?: boolean } = {}) {
  return useQuery({
    queryKey: ['releases'],
    queryFn: () => releasesService.listReleases(),
    ...(opts.refetchOnMount === false ? { refetchOnMount: false } : {}),
  });
}

/**
 * M17/L11: the release-label lookup — `releaseId → name`. This is the ONE
 * `useReleases` in the codebase: the host's own version-history timeline and
 * every plugin (via `@c4s/plugin-runtime`) read release labels through it, off
 * the same `['releases']` query, so there is a single fetch and a single shape.
 * The map is keyed by the `releaseId` every version-list row
 * (`EntityVersionMeta`, 2.1.25) carries, so a version joins its release name in
 * one render. Versions are grouped by release (2.1.26): a version with
 * `releaseId: null` (not yet released) is simply absent from the map and falls
 * into the "Unreleased" group; a version row carries no release pill.
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

/**
 * 2.1.45 (M17 L5 "Stan → Zapytania") — the key of the unreleased counter:
 * `['release-diff', <newest release>, 'current', { summaryOnly: true }]`. It
 * shares the `['release-diff', <from>, 'current']` prefix with the Compare
 * tab's diff, so one `['release-diff']` invalidation refreshes both.
 */
export function unreleasedCounterKey(latestReleaseName: string) {
  return ['release-diff', latestReleaseName, 'current', { summaryOnly: true }] as const;
}

/**
 * 2.1.45 (M17 L2 zbc9jdnr) — THE unreleased counter, the one shared frontend
 * query every consumer reads (Compare tab label, create-release warning, M25
 * banner): the size of the light `release_diff` delta from the newest release
 * (the head of the newest-first `['releases']` list) to `current` — changed
 * entities plus changed pages (`unreleasedCountOf`), not a count of versions.
 * Without any release the counter does not exist: the query stays disabled
 * and `data` is `undefined`.
 */
export function useUnreleasedCount(opts: { refetchOnMount?: boolean } = {}) {
  const { data: releases } = useReleaseList(opts);
  const latest = releases?.[0]?.name;
  return useQuery({
    queryKey: unreleasedCounterKey(latest ?? ''),
    queryFn: async () => unreleasedCountOf((await releasesApi.diffSummary(latest!, CURRENT_RELEASE_NAME)).total),
    enabled: latest != null,
    // A consumer mounted under a screen that already observes the counter (the
    // create-release window) passes `false`: it reads the cached value, kept
    // fresh by the WS invalidation map, instead of refetching it on open. With
    // nothing cached yet the query still loads.
    ...(opts.refetchOnMount === false ? { refetchOnMount: false } : {}),
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
      // 2.1.11: the screen's queries are keyed by name. The new name is seeded
      // here; the old name's entries are dropped by `forgetReleaseName` AFTER the
      // route has moved — refetching them while the old route is still mounted
      // would ask the server about a name that no longer exists.
      qc.setQueryData(['release', updated.name], updated);
      if (updated.name === params.releaseName) {
        qc.invalidateQueries({ queryKey: ['release', updated.name] });
        qc.invalidateQueries({ queryKey: releasePushesKey(updated.name) });
      }
    },
  });
}

/**
 * 2.1.11: drop every query keyed by a release name that no longer exists (after
 * a rename): the detail, the snapshot, the push log and any diff naming it on
 * either side. A later visit to the old address then fetches afresh and behaves
 * like any unknown name. Call it once nothing on screen observes the old name.
 */
export function forgetReleaseName(qc: QueryClient, oldName: string): void {
  qc.removeQueries({ queryKey: ['release', oldName], exact: true });
  qc.removeQueries({ queryKey: ['release-snapshot', oldName], exact: true });
  qc.removeQueries({ queryKey: releasePushesKey(oldName), exact: true });
  qc.removeQueries({
    predicate: (q) => q.queryKey[0] === 'release-diff' && (q.queryKey[1] === oldName || q.queryKey[2] === oldName),
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
