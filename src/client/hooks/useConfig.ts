import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { configApi, type ConfigPatch } from '../lib/api.js';
import { PROJECT_ID } from '../lib/api-core.js';
import type { Root } from '../../shared/types.js';
import { recordRootRename } from '../state/rootRenames.js';

/**
 * M31: fields that rebuild the project context server-side (the PATCH handler
 * invalidates the cached ProjectContext; the next request gets a fresh one).
 * Every cached query may be stale after such a rebuild — blanket invalidate.
 * "Restart required" (M26) is gone: nothing needs a process restart anymore.
 */
const CONTEXT_DEFINING_FIELDS = [
  'roots',
  'briefsDir',
  'patchesDir',
  'plansDir',
  'entitiesDir',
  // Must mirror CONTEXT_DEFINING_FIELDS in src/server/routes/config.ts. Missing
  // here, a `releasesDir`-only write rebuilt the context server-side while the
  // client kept serving every cached query against the old one.
  'releasesDir',
  'entities',
] as const satisfies readonly (keyof ConfigPatch)[];

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => configApi.get(),
    // Decision #11: `/welcome` runs project-less (PROJECT_ID=''), where there is
    // no project-scoped `/api/config` to read — skip the doomed request.
    enabled: !!PROJECT_ID,
  });
}

/**
 * 0.1.96 multiroot: selector for the configured page roots. Empty until the
 * config query resolves (or project-less `/welcome`, where there is no config).
 */
export function useRoots(): Root[] {
  const { data } = useConfig();
  return data?.roots ?? [];
}

export function usePatchConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConfigPatch) => configApi.patch(input),
    onSuccess: (data, variables) => {
      qc.setQueryData(['config'], data);
      if ('writingStyle' in variables) {
        qc.invalidateQueries({ queryKey: ['writing-styles'] });
      }
      if ('remoteProjectId' in variables) {
        qc.invalidateQueries({ queryKey: ['remote-project'] });
      }
      // M33 phase 3: a `plugins` write always refreshes the config cache (above,
      // via setQueryData). An `executive` field additionally rebuilds the
      // context server-side (`pluginsPatchIsExecutive` in routes/config.ts); the
      // result surfaces on the next request, so a blanket invalidate keeps the
      // client coherent. Only the server can tell executive from `hot-reload`,
      // so every `plugins` write invalidates — over-invalidating a hot-reload
      // write costs a refetch, under-invalidating an executive one leaves every
      // cached query answering against a context that no longer exists.
      if (CONTEXT_DEFINING_FIELDS.some((k) => k in variables) || 'plugins' in variables) {
        qc.invalidateQueries();
      }
    },
  });
}

/**
 * 0.2.101 — the BASE page root: the single entry carrying `builtin: true`.
 *
 * `undefined` until the config query resolves (and on the project-less
 * `/welcome` route). Every consumer that used to fall back to the literal
 * `'pages'` asks this instead: that value is now just the default identifier a
 * new project starts with, and a project may have renamed it away.
 */
export function useBaseRoot(): Root | undefined {
  return useRoots().find((r) => r.builtin);
}

/** The base root's identifier, or `null` while the config is still loading. */
export function useBaseRootId(): string | null {
  return useBaseRoot()?.id ?? null;
}

/**
 * 0.2.101 — `POST /api/config/roots/:rootId/rename`.
 *
 * On success every cached query is dropped, deliberately and bluntly: entries
 * under the old `rootId` (`['page', oldId, path]`, `['pages', oldId]`, …) are
 * ABANDONED, not rewritten. The space is rebuilt under its new key server-side,
 * so refetching is the honest move — a client-side key migration would have to
 * guess which cached bodies survived the rebuild.
 *
 * The same reasoning covers the persisted UI state keyed by root id
 * (`c4s:sidebar:pages-open`, `c4s:m02:last-page`): the entry under the old id
 * simply stops being read, and the space starts collapsed under the new one.
 * Expansion state is a preference, so a rename invalidates it rather than
 * migrating it.
 */
export function useRenameRoot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { rootId: string; newId: string; expectedConfigHash: string }) =>
      configApi.renameRoot(input.rootId, {
        newId: input.newId,
        expectedConfigHash: input.expectedConfigHash,
      }),
    onSuccess: (result, input) => {
      // 0.2.113: an editor open on the old address follows to the new one.
      if (result.rootId !== input.rootId) recordRootRename(input.rootId, result.rootId);
      // Entries keyed by the OLD id are never refetched: that id now answers
      // like any unknown root, so refetching them (the sidebar's page tree,
      // still mounted until the new config re-renders it) would only produce
      // 404s. They go inactive once the screens re-key onto the new id and are
      // garbage-collected from there. Everything else refetches.
      //
      // Not awaited, on purpose: `mutateAsync` resolves only after onSuccess
      // does, and waiting on every active query's refetch would hold the
      // caller's post-rename navigation hostage to the slowest one.
      const underOldId = (q: { queryKey: readonly unknown[] }) => q.queryKey.includes(input.rootId);
      void qc.invalidateQueries({ predicate: (q) => !underOldId(q) });
    },
  });
}
