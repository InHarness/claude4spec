import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WsEvent } from '../../shared/types.js';
import { createInvalidationBatcher } from '../lib/wsBatcher.js';
import { useFileEventsStore } from '../state/fileEvents.js';

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
            const key =
              data.entityType === 'endpoint'
                ? 'endpoints'
                : data.entityType === 'dto'
                  ? 'dtos'
                  : 'database-tables';
            batcher.queue([key]);
            batcher.queue([data.entityType, data.slug]);
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
