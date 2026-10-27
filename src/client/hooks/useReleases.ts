import { useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { releasesApi } from '../lib/releases-api.js';
import { CURRENT_RELEASE_NAME, type CreateReleaseResponse, type ShadowAcceptRequest } from '../../shared/entities.js';
import { unreleasedCountOf } from '../../shared/unreleased-counter.js';
import { releasesService } from '../runtime/releases-service.js';
import { SHADOW_DIFF_KEY, shadowDiffKey } from '../lib/release-diff-invalidation.js';
import { GIT_SHADOWS_KEY } from '../lib/git-ws.js';
import { useGitOpsStore } from '../state/gitOps.js';
import { ApiError } from '../lib/api-core.js';
import { beginOwnReleaseWrite } from '../lib/own-writes.js';

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
 * tab's diff, so one invalidation of the diffs against `current`
 * (`release-diff-invalidation.ts`) refreshes both.
 */
export function unreleasedCounterKey(latestReleaseName: string) {
  return ['release-diff', latestReleaseName, 'current', { summaryOnly: true }] as const;
}

/**
 * 2.1.45 (M17 L2 zbc9jdnr) — THE unreleased counter, the one shared frontend
 * query every consumer reads (Compare tab label, create-release warning): the
 * size of the light `release_diff` delta from the newest release (the head of
 * the newest-first `['releases']` list) to `current` — changed
 * entities plus changed pages (`unreleasedCountOf`), not a count of versions.
 * Without any release the counter does not exist: `data` is `undefined`.
 *
 * No query exists until the newest release's name is known: the counter is
 * observed through `useQueries` with an empty list while `['releases']` is
 * loading (or empty), so no placeholder entry such as
 * `['release-diff', '', 'current', …]` is ever created in the cache — every
 * mount before the list resolves would otherwise leave a junk, disabled query
 * (and an observer re-bound on the key change) behind.
 */
export function useUnreleasedCount(opts: { refetchOnMount?: boolean } = {}): { data: number | undefined } {
  const { data: releases } = useReleaseList(opts);
  const latest = releases?.[0]?.name;
  const queries: Array<UseQueryOptions<number, Error, number, ReturnType<typeof unreleasedCounterKey>>> =
    latest == null
      ? []
      : [
          {
            queryKey: unreleasedCounterKey(latest),
            queryFn: async () => unreleasedCountOf((await releasesApi.diffSummary(latest, CURRENT_RELEASE_NAME)).total),
            // A consumer mounted under a screen that already observes the counter
            // (the create-release window) passes `false`: it reads the cached
            // value, kept fresh by the WS invalidation map, instead of refetching
            // it on open. With nothing cached yet the query still loads.
            ...(opts.refetchOnMount === false ? { refetchOnMount: false } : {}),
          },
        ];
  const data = useQueries({ queries, combine: (results): number | undefined => results[0]?.data });
  return { data };
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

/**
 * 2.1.46 (M17 L5 m17ui001) — the Shadows tab's delta `['shadow-diff', <ref>]`
 * from `GET /api/shadow-diff`, disabled until a shadow is chosen. A
 * refusal (`SHADOW_NOT_FOUND`, `GIT_UNAVAILABLE`) is an answer, not a transient
 * failure: it is not retried.
 */
export function useShadowDiff(ref: string | null) {
  return useQuery({
    queryKey: shadowDiffKey(ref ?? ''),
    queryFn: () => releasesApi.shadowDiff(ref!),
    enabled: ref != null && ref.length > 0,
    retry: false,
  });
}

/**
 * 2.1.47 — the key of the shadow acceptance mutation. While one is in flight
 * the screen is in its `shadow-accepting` state (`useIsMutating` on this key):
 * the Shadows tab shows a spinner and locks its picker, `ReleasesPage` locks
 * the tab switcher.
 */
export const SHADOW_ACCEPT_KEY = ['shadow-accept'] as const;

/**
 * 2.1.47 (M17 L5 m17ui001, endpoint `post-api-shadow-accept`) — accept a
 * shadow as a new release. A success invalidates the release list, the
 * briefs list, `['git-shadows']` and `['shadow-diff']` at once, without
 * waiting for the WS event. The acceptance is THIS client's own git operation
 * (`useGitOpsStore`), so its release commit's `headChanged` event does not
 * reload the route, whichever of the event and the answer arrives first: an
 * answer whose release commit landed (`gitSync.status === 'committed'`) keeps
 * the mark until the event has been attributed to it — a success body, or the
 * error envelope of a failure past the point of no return (`error.gitSync`).
 * The outcome handlers are mutation-level (they live on the mutation, not on
 * one `mutate()` call), so a toast or a repair window is not lost when the
 * screen unmounts mid-flight.
 */
export function useAcceptShadow(handlers: {
  onSuccess: (release: CreateReleaseResponse, input: ShadowAcceptRequest) => void;
  onError: (error: Error, input: ShadowAcceptRequest) => void;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: SHADOW_ACCEPT_KEY,
    mutationFn: (input: ShadowAcceptRequest) => releasesApi.acceptShadow(input),
    // THIS client's own HEAD-moving operation: the WS map must not reload the
    // route on the release commit's `git:status-changed { headChanged: true }`.
    // 2.1.49: and its own release write — the list's `file:changed` echo is
    // absorbed, the invalidation below refetches it once (`lib/own-writes.ts`).
    onMutate: () => {
      useGitOpsStore.getState().begin('accept');
      return beginOwnReleaseWrite();
    },
    onSuccess: (release, input, own) => {
      own?.succeeded();
      void qc.invalidateQueries({ queryKey: ['releases'] });
      // A release's rank places briefs on the release axis (server-computed).
      void qc.invalidateQueries({ queryKey: ['briefs', 'list'] });
      void qc.invalidateQueries({ queryKey: GIT_SHADOWS_KEY });
      void qc.invalidateQueries({ queryKey: SHADOW_DIFF_KEY });
      handlers.onSuccess(release, input);
    },
    onError: (error, input, own) => {
      if (own?.failed()) void qc.invalidateQueries({ queryKey: ['releases'] });
      handlers.onError(error, input);
    },
    onSettled: (release, error) => {
      const ops = useGitOpsStore.getState();
      if (releaseCommitLanded(release, error)) ops.answeredWithHeadChange('accept');
      else ops.end('accept');
    },
  });
}

/**
 * Whether the acceptance's answer says its release commit landed (HEAD moved):
 * `gitSync.status === 'committed'` on the success body, or on the error
 * envelope of a failure past the point of no return (`error.gitSync`).
 */
function releaseCommitLanded(release: CreateReleaseResponse | undefined, error: Error | null): boolean {
  const gitSync = error instanceof ApiError ? error.details?.gitSync : release?.gitSync;
  return (gitSync as { status?: unknown } | null | undefined)?.status === 'committed';
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
    onMutate: beginOwnReleaseWrite,
    onError: (_err, _input, own) => {
      if (own?.failed()) qc.invalidateQueries({ queryKey: ['releases'] });
    },
    onSuccess: (_created, _input, own) => {
      own?.succeeded();
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
    onMutate: beginOwnReleaseWrite,
    onError: (_err, _params, own) => {
      if (own?.failed()) qc.invalidateQueries({ queryKey: ['releases'] });
    },
    onSuccess: (updated, params, own) => {
      own?.succeeded();
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
      }
    },
  });
}

/**
 * 2.1.11: drop every query keyed by a release name that no longer exists (after
 * a rename): the detail, the snapshot and any diff naming it on
 * either side. A later visit to the old address then fetches afresh and behaves
 * like any unknown name. Call it once nothing on screen observes the old name.
 */
export function forgetReleaseName(qc: QueryClient, oldName: string): void {
  qc.removeQueries({ queryKey: ['release', oldName], exact: true });
  qc.removeQueries({ queryKey: ['release-snapshot', oldName], exact: true });
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
