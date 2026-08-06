import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WsEvent } from '../../shared/types.js';
import { createInvalidationBatcher } from '../lib/wsBatcher.js';
import { PROJECT_ID } from '../lib/api-core.js';
import { useFileEventsStore } from '../state/fileEvents.js';
import { reloadFrontendPlugins } from '../runtime/boot-plugins.js';
import { clientPluginHost } from '../core/plugin-host/host.js';

/** M33 phase 3: window event a live editor listens for to re-apply extensions (no setContent). */
export const PLUGINS_RELOADED_EVENT = 'c4s:plugins-reloaded';

/**
 * An entity type → its React Query list key (plural).
 *
 * 0.2.11: derived from the type's own `pathPrefix` (last segment), the same rule
 * the release bundle uses for file names, instead of a five-entry map. The map
 * omitted `design-system` and `diagram` and every plugin type, so a change to
 * one of those invalidated only the generic `entities` key and left its own list
 * showing stale rows until something else evicted it.
 *
 * Falls back to `entities` when the type is unknown to the client host — which
 * includes the window before plugin boot settles, where answering with a
 * specific key would be a guess.
 */
function entityListKey(type: string): string {
  const prefix = clientPluginHost.getAvailable(type)?.pathPrefix;
  const base = prefix?.split('/').filter(Boolean).pop();
  return base ?? 'entities';
}

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

    const connect = () => {
      ws = new WebSocket(url);
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as WsEvent;
          if (data.kind === 'file:changed') {
            // 0.1.96 multiroot: page trees + documents are keyed by rootId.
            batcher.queue(['pages', data.rootId]);
            if (data.origin === 'external') {
              useFileEventsStore.getState().notifyExternalChange(data.rootId, data.path);
            } else {
              batcher.queue(['page', data.rootId, data.path]);
            }
          } else if (data.kind === 'entity:changed') {
            batcher.queue([entityListKey(data.entityType)]);
            batcher.queue([data.entityType, data.slug]);
            batcher.queue(['entities']);
          } else if (data.kind === 'entity:indexed') {
            // M29: a file-watch reindex (external edit / git pull). Invalidate
            // the same React Query keys as a write-API change — idempotent.
            batcher.queue([entityListKey(data.type)]);
            batcher.queue([data.type, data.slug]);
            batcher.queue(['entities']);
          } else if (data.kind === 'tag:changed') {
            // 0.2.11: every active type, not three hardcoded ones. A tag
            // change alters the tag chips on every entity list, but this
            // invalidated only endpoints/dtos/database-tables -- so ui-view,
            // ac, design-system, diagram and all plugin lists kept rendering
            // the old tags.
            batcher.queue(['tags']);
            for (const m of clientPluginHost.listEntities()) {
              batcher.queue([entityListKey(m.type)]);
            }
            batcher.queue(['entities']);
          } else if (data.kind === 'section:indexed') {
            batcher.queue(['sections']);
          } else if (data.kind === 'todos:changed') {
            batcher.queue(['todos']);
          } else if (data.kind === 'pageLinks:changed') {
            batcher.queue(['pageLinks']);
          } else if (data.kind === 'plan:updated') {
            batcher.queue(['plan', 'detail', data.planPath]);
            batcher.queue(['plan', 'versions', data.planPath]);
            batcher.queue(['plan', 'by-thread', data.threadId]);
            batcher.queue(['plans-list']);
            batcher.queue(['threads']);
          } else if (data.kind === 'plugin:reloaded') {
            // M33 phase 3: a plugin in the pool was installed/removed/edited.
            // Re-import its frontend (cache-bust), re-pin editor extensions +
            // commands, then invalidate the plugin-derived caches. NO setContent
            // — an open document survives. A live editor re-applies extensions
            // on the dispatched window event.
            void reloadFrontendPlugins().finally(() => {
              window.dispatchEvent(new CustomEvent(PLUGINS_RELOADED_EVENT, { detail: data }));
            });
            batcher.queue(['plugins-meta']);
            batcher.queue(['plugin-settings']);
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
              } else {
                // Our own save (origin 'server' / undefined) — silently reconcile.
                batcher.queue(['briefs', 'detail', data.path]);
              }
            }
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
              batcher.queue(['plan', 'versions', data.path]);
            }
          } else if (data.kind === 'project:disposed') {
            // M31: this project's ProjectContext was invalidated (config
            // change, workspace detach, or 0.1.123 a branch checkout in
            // ANOTHER tab) and the room is about to close. Every cached query
            // now points at a stale/about-to-be-torn-down context — reload
            // rather than let this tab keep reading/writing stale state.
            window.location.reload();
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
