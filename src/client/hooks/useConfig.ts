import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { configApi, type ConfigPatch } from '../lib/api.js';
import { PROJECT_ID } from '../lib/api-core.js';
import type { Root } from '../../shared/types.js';
import type { ElementsMenuEntry } from '../../shared/elements-menu.js';
import { recordRootRename } from '../state/rootRenames.js';

/**
 * M31: fields that rebuild the project context server-side (the PATCH handler
 * invalidates the cached ProjectContext; the next request gets a fresh one).
 * Every cached query may be stale after such a rebuild — blanket invalidate.
 * "Restart required" (M26) is gone: nothing needs a process restart anymore.
 */
const CONTEXT_DEFINING_FIELDS = [
  // Must mirror the server's `context-rebuild` fields (the field registry's
  // `contextRebuildKeys()`, `src/server/settings/registry.ts`). 2.1.8: the
  // `*Dir` keys are gone — the system roots are fixed in code.
  'roots',
  'entities',
] as const satisfies readonly (keyof ConfigPatch)[];

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => configApi.get(),
    // The project shell is the reader; a workspace document (PROJECT_ID='',
    // M50 `1bd92aq2`) mounts the workspace frame instead. The window hosts sit
    // beside BOTH frames, though, so a window reading the config there must not
    // fire a request with no `/api/projects/<id>` prefix to build.
    enabled: !!PROJECT_ID,
  });
}

/**
 * 0.1.96 multiroot: selector for the configured page roots. Empty until the
 * config query resolves.
 */
export function useRoots(): Root[] {
  const { data } = useConfig();
  return data?.roots ?? [];
}

/**
 * 2.1.50 (M13 `m13ui000`, M50 `8h2a734u`) — the ELEMENTS layout the page's
 * sidebar is composed from: the `elementsMenu` of the FIRST `['config']` read
 * this page sees, kept for the page's life (one seed per query cache, i.e. per
 * page load). A later refetch of the config — another tab's save, a hand edit of
 * `config.json`, a WS-driven invalidation — does not rearrange the sidebar until
 * the page reloads, the same rule as activation saved elsewhere.
 *
 * `ready` is false only while the first read is in flight, so the section does
 * not flash the default order before the team's layout; a failed read falls
 * back to the default order (`layout` undefined). Its only reader is the
 * project sidebar, so it always runs in a project document.
 *
 * The one exception is THIS tab's own save of the key (Settings → Entities →
 * Sidebar menu, M13 `lbqrd6xh`): `usePatchConfig` replaces the seed with the
 * saved layout before the new config lands in the cache, so the sidebar shows
 * it at once, without a reload.
 */
interface ElementsMenuSeed {
  layout: ElementsMenuEntry[] | undefined;
}
const elementsMenuSeeds = new WeakMap<QueryClient, ElementsMenuSeed>();
const elementsMenuSeedListeners = new WeakMap<QueryClient, Set<() => void>>();

/** Replaces the page's layout seed and re-renders every sidebar reading it. */
function replaceElementsMenuSeed(qc: QueryClient, layout: ElementsMenuEntry[] | undefined): void {
  elementsMenuSeeds.set(qc, { layout });
  for (const listener of elementsMenuSeedListeners.get(qc) ?? []) listener();
}

export function useElementsMenuLayout(): { ready: boolean; layout: ElementsMenuEntry[] | undefined } {
  const qc = useQueryClient();
  const { data, isError } = useConfig();
  const subscribe = useCallback(
    (listener: () => void) => {
      let listeners = elementsMenuSeedListeners.get(qc);
      if (!listeners) {
        listeners = new Set();
        elementsMenuSeedListeners.set(qc, listeners);
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    [qc],
  );
  const getSnapshot = useCallback(() => elementsMenuSeeds.get(qc), [qc]);
  const stored = useSyncExternalStore(subscribe, getSnapshot);
  // The first read seeds the page: derived here, persisted after commit — never
  // written during render. The rendered layout is the persisted one, so no
  // listener needs a notification.
  const seed = stored ?? (data ? { layout: data.elementsMenu } : undefined);
  useEffect(() => {
    if (seed && !elementsMenuSeeds.has(qc)) elementsMenuSeeds.set(qc, seed);
  }, [qc, seed]);
  if (seed) return { ready: true, layout: seed.layout };
  return { ready: isError, layout: undefined };
}

export function usePatchConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConfigPatch) => configApi.patch(input),
    onSuccess: (data, variables) => {
      // Own-tab save of the ELEMENTS layout: the sidebar follows at once.
      if ('elementsMenu' in variables) replaceElementsMenuSeed(qc, data.elementsMenu);
      qc.setQueryData(['config'], data);
      if ('writingStyle' in variables) {
        qc.invalidateQueries({ queryKey: ['writing-styles'] });
      }
      if (CONTEXT_DEFINING_FIELDS.some((k) => k in variables)) {
        qc.invalidateQueries();
      }
    },
  });
}

/**
 * 0.2.101 — the BASE page root: the single entry carrying `builtin: true`.
 *
 * `undefined` until the config query resolves. Every consumer that used to fall back to the literal
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
