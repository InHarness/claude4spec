import { kindHasFacade, systemRootKindOf } from '../../shared/root-kinds.js';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WsEvent } from '../../shared/types.js';
import { createInvalidationBatcher } from '../lib/wsBatcher.js';
import { handleGitStatusChanged, handleLiveUpdateReconnected } from '../lib/git-ws.js';
import { handleProjectDisposed } from '../lib/project-disposed.js';
import { PROJECT_ID } from '../lib/api-core.js';
import { useFileEventsStore } from '../state/fileEvents.js';
import { isHtmlPreviewPath, useHtmlViewerStore } from '../state/htmlViewer.js';
import { artifactVersionsKey } from './useArtifactVersions.js';
import { reloadFrontendPlugins } from '../runtime/boot-plugins.js';
import { entityChangeKeys, tagChangeKeys } from '../lib/entity-invalidation.js';
import { releaseDiffInvalidationFor, shadowDiffInvalidationFor } from '../lib/release-diff-invalidation.js';
import { absorbOwnEcho, resetOwnWrites } from '../lib/own-writes.js';

/**
 * M33 phase 3: window event dispatched once a plugin reload has re-pinned the
 * registry. Editors do NOT listen for it — they follow the registry's schema
 * version directly (`tiptap/useEditorSchema.ts`), which also covers the initial
 * non-blocking boot. Kept for any non-editor consumer.
 */
export const PLUGINS_RELOADED_EVENT = 'c4s:plugins-reloaded';

export function useFileWatcher() {
  const qc = useQueryClient();

  useEffect(() => {
    const batcher = createInvalidationBatcher(qc, 500);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // M31: WS rooms are per-project — the server refuses a missing ?project.
    const url = `${proto}//${location.host}/ws?project=${encodeURIComponent(PROJECT_ID)}`;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closed = false;

    let opened = false;

    const connect = () => {
      ws = new WebSocket(url);
      ws.onopen = () => {
        // 2.1.47: frames broadcast while the socket was down are gone.
        if (opened) {
          handleLiveUpdateReconnected();
          // 2.1.48: an own save's echo may have been among the lost frames.
          resetOwnWrites();
        }
        opened = true;
      };
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as WsEvent;
          // 2.1.9: a system root WITH A FACADE (`skills`, M52) is a page tree like
          // any user root — it takes the page branch below, keyed by its rootId.
          const systemRootKind = data.kind === 'file:changed' ? systemRootKindOf(data.rootId) : undefined;
          const systemKind = systemRootKind && !kindHasFacade(systemRootKind) ? systemRootKind : undefined;
          // 2.1.45 (M17 m17ui001): the release diff — Compare tab and the
          // unreleased counter — refreshes on its own event list, before the
          // per-kind branches below (some of its events have no branch there).
          // Content events reach only the diffs against `current`; a file of a
          // system root without a facade is not diff content (entities have
          // `entity:changed`, releases their lifecycle events).
          const releaseDiff = systemKind ? null : releaseDiffInvalidationFor(data.kind);
          if (releaseDiff) batcher.queueFilters(releaseDiff.id, releaseDiff.filters);
          // 2.1.46 (M17 m17ui001): the Shadows tab's delta moves with HEAD and the shadow refs.
          const shadowDiff = shadowDiffInvalidationFor(data.kind);
          if (shadowDiff) batcher.queue([...shadowDiff]);
          if (data.kind === 'file:changed' && systemKind) {
            // 2.1.8: the base `file:changed` fires for EVERY registry root. A
            // system root is routed by its KIND (asked of the registry), never
            // by its id. Briefs keep their reload-or-confirm flow; plans and
            // patches refetch; entities and releases have their own projection
            // events (`entity:indexed`, release cache).
            if (systemKind === 'briefs') {
              batcher.queue(['briefs', 'list']);
              batcher.queue(['briefs', 'versions', data.path]);
              if (data.origin === 'external') useFileEventsStore.getState().notifyBriefExternalChange(data.path);
              else batcher.queue(['briefs', 'detail', data.path]);
            } else if (systemKind === 'plans') {
              batcher.queue(['plans-list']);
              batcher.queue(['plan', 'detail', data.path]);
              batcher.queue(artifactVersionsKey('plan', data.path));
            } else if (systemKind === 'patches') {
              // 2.1.48: never an own save's echo — the record store writes a
              // patch with `chain: false` under its suppress token, so this is
              // another writer (an agent's tool, a chain-running service) and
              // the open detail must refresh (see `lib/own-writes.ts`).
              batcher.queue(['patches', 'list']);
              batcher.queue(['patches', 'detail', data.path]);
            } else if (systemKind === 'releases') {
              batcher.queue(['releases']);
            }
          } else if (data.kind === 'file:changed') {
            // 0.1.96 multiroot: page trees + documents are keyed by rootId.
            batcher.queue(['pages', data.rootId]);
            if (isHtmlPreviewPath(data.path, data.rootId)) {
              // M30: a raw entry is a read-only preview — no editor, no reload
              // dialog; the open iframe just reloads. 2.1.8: on the base
              // `file:changed` (M30 has no reaction of its own), narrowed to the
              // raw entries of the root kind's file map (2.1.23).
              useHtmlViewerStore.getState().notifyChanged(data.rootId, data.path);
            } else if (data.origin === 'external') {
              useFileEventsStore.getState().notifyExternalChange(data.rootId, data.path);
            } else {
              batcher.queue(['page', data.rootId, data.path]);
            }
          } else if (data.kind === 'sidebar:accordions-changed') {
            // 2.1.9 (M02): a root's accordion array changed (a reducer root
            // recomputed, or the context rebuilt) — one key, the whole array.
            batcher.queue(['sidebar-accordions']);
          } else if (data.kind === 'entity:changed') {
            // 2.1.19 (M13 m13ui000): the host's own list/detail map — see
            // `entity-invalidation.ts`. Version history is not on it.
            for (const key of entityChangeKeys(data.entityType, data.slug)) batcher.queue(key);
          } else if (data.kind === 'entity:indexed') {
            // M29: a file-watch reindex (external edit / git pull). Invalidate
            // the same React Query keys as a write-API change — idempotent.
            for (const key of entityChangeKeys(data.type, data.slug)) batcher.queue(key);
          } else if (data.kind === 'tag:changed') {
            // 0.2.11: every active type, not three hardcoded ones. A tag
            // change alters the tag chips on every entity list, but this
            // invalidated only endpoints/dtos/database-tables -- so ui-view,
            // ac, design-system, diagram and all plugin lists kept rendering
            // the old tags.
            for (const key of tagChangeKeys()) batcher.queue(key);
          } else if (data.kind === 'section:indexed') {
            batcher.queue(['sections']);
          } else if (data.kind === 'todos:changed') {
            batcher.queue(['todos']);
          } else if (data.kind === 'pageLinks:changed') {
            batcher.queue(['pageLinks']);
          } else if (data.kind === 'plan:updated') {
            /**
             * 0.2.15 — invalidation keys off `planPath` and ONLY off `planPath`.
             * `threadId` names the author of the write, not the owner of the
             * plan (a plan has no owning thread — several may attach), and it is
             * null for a write made outside any thread. The `by-thread` entry
             * below is a cache keyed by thread, so it is refreshed only when the
             * event actually names one.
             */
            batcher.queue(['plan', 'detail', data.planPath]);
            batcher.queue(artifactVersionsKey('plan', data.planPath));
            if (data.threadId) batcher.queue(['plan', 'by-thread', data.threadId]);
            batcher.queue(['plans-list']);
            batcher.queue(['threads']);
          } else if (data.kind === 'index:status-changed') {
            /**
             * 0.2.77 — a projection changed freshness, in either direction.
             * Invalidating the card's key is the whole client-side mechanism:
             * there is no polling loop, and none is wanted. The banner, the
             * sidebar indicator and the settings card all render off this one key.
             */
            batcher.queue(['index-status']);
          } else if (data.kind === 'git:status-changed') {
            // 2.1.10 (M28): the module's WS → query map — refetch the git
            // status; a HEAD change from another client reloads the route.
            handleGitStatusChanged(data, batcher);
          } else if (data.kind === 'plugin:reloaded') {
            // M33 (`m33l7pln` step 5): a plugin in the pool was installed/
            // removed/edited. Refetch this project's manifest, import newly
            // announced frontends, re-pin editor extensions + commands, then
            // invalidate the plugin-derived caches. A rebuilt frontend this tab
            // already imported is not re-imported: the document reloads once
            // no editor holds unsaved changes (2.1.22, `m33l5man`).
            void reloadFrontendPlugins({ name: data.name, tier: data.tier }).finally(() => {
              window.dispatchEvent(new CustomEvent(PLUGINS_RELOADED_EVENT, { detail: data }));
            });
            batcher.queue(['plugins-meta']);
            batcher.queue(['meta-entities']);
            batcher.queue(['config']);
            batcher.queue(['entities']);
          } else if (data.kind === 'briefs:changed') {
            batcher.queue(['briefs', 'list']);
            if (data.path) {
              batcher.queue(['briefs', 'versions', data.path]);
              if (data.origin === 'external') {
                // Agent / on-disk edit — route through externalChange so the open
                // BriefEditor can reload (clean) or confirm (dirty), like pages.
                useFileEventsStore.getState().notifyBriefExternalChange(data.path);
              } else if (!absorbOwnEcho('briefs', data.path)) {
                // Another non-external writer (another tab, a server write) —
                // silently reconcile. 2.1.48: the echo of THIS tab's save is
                // absorbed — its mutation already wrote the whole-file detail
                // cache, and a refetch would re-download it (`lib/own-writes.ts`).
                batcher.queue(['briefs', 'detail', data.path]);
              }
            }
          } else if (data.kind === 'patches:changed') {
            // 2.1.4: the patch thread's agent flips `applied` itself
            // (`mark_patch_applied`). The frontmatter projection broadcasts this
            // on every real change, so an open `/patches/:path` refreshes instead
            // of showing the old flag until something else refetches.
            // 2.1.48: except the echo of THIS tab's own `applied` flip — its
            // mutation already refetches the detail (`lib/own-writes.ts`). A
            // content save broadcasts nothing, so it has no echo here.
            batcher.queue(['patches', 'list']);
            if (data.path && !absorbOwnEcho('patches', data.path)) batcher.queue(['patches', 'detail', data.path]);
          } else if (data.kind === 'plans:changed') {
            // v0.1.129 fix: previously unhandled — parsed then silently
            // dropped, so a plan title/frontmatter change or an external edit
            // (via project-context.ts's watcher fan-out) never invalidated
            // the plans list or that plan's detail/versions queries in any
            // OTHER open tab. Mirrors `briefs:changed`, minus the
            // reload-or-confirm dialog flow (plans don't have one).
            batcher.queue(['plans-list']);
            if (data.path) {
              batcher.queue(['plan', 'detail', data.path]);
              batcher.queue(artifactVersionsKey('plan', data.path));
            }
          } else if (data.kind === 'project:disposed') {
            // M31: this project's ProjectContext was invalidated (config
            // change, workspace detach, or 0.1.123 a branch checkout in
            // ANOTHER tab) and the room is about to close. Every cached query
            // now points at a stale/about-to-be-torn-down context — reload
            // rather than let this tab keep reading/writing stale state.
            // 2.1.16: except an activation change (`reason`) — see
            // `handleProjectDisposed`.
            handleProjectDisposed(data, {
              reload: () => window.location.reload(),
              invalidateAll: () => void qc.invalidateQueries(),
            });
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (closed) return;
        reconnectTimer = window.setTimeout(connect, 1000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      batcher.dispose();
    };
  }, [qc]);
}
