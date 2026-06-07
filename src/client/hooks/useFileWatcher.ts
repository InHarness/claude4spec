import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WsEvent } from '../../shared/types.js';
import { createInvalidationBatcher } from '../lib/wsBatcher.js';
import { useFileEventsStore } from '../state/fileEvents.js';

/** Map an entity type → its React Query list key (plural). */
const ENTITY_LIST_KEY: Record<string, string> = {
  endpoint: 'endpoints',
  dto: 'dtos',
  'database-table': 'database-tables',
  'ui-view': 'ui-views',
  ac: 'acs',
};
function entityListKey(type: string): string {
  return ENTITY_LIST_KEY[type] ?? 'entities';
}

export function useFileWatcher() {
  const qc = useQueryClient();

  useEffect(() => {
    const batcher = createInvalidationBatcher(qc, 500);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws`;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(url);
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as WsEvent;
          if (data.kind === 'page:changed') {
            batcher.queue(['pages']);
            if (data.origin === 'external') {
              useFileEventsStore.getState().notifyExternalChange(data.path);
            } else {
              batcher.queue(['page', data.path]);
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
            batcher.queue(['tags']);
            batcher.queue(['endpoints']);
            batcher.queue(['dtos']);
            batcher.queue(['database-tables']);
          } else if (data.kind === 'section:indexed') {
            batcher.queue(['sections']);
          } else if (data.kind === 'todos:changed') {
            batcher.queue(['todos']);
          } else if (data.kind === 'pageLinks:changed') {
            batcher.queue(['pageLinks']);
          } else if (data.kind === 'plan:updated') {
            batcher.queue(['plan', 'detail', data.planId]);
            batcher.queue(['plan', 'versions', data.planId]);
            batcher.queue(['plan', 'blame', data.planId]);
            batcher.queue(['plan', 'by-thread', data.threadId]);
            batcher.queue(['plans-list']);
            batcher.queue(['threads']);
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
