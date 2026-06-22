import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api-core.js';
import type { ChatThreadMeta } from '../../shared/entities.js';

interface Envelope<T> {
  data: T;
}

const PAGE_SIZE = 20;

export function useThreadList(serverUrl = '') {
  const [threads, setThreads] = useState<ChatThreadMeta[]>([]);
  const [loading, setLoading] = useState(false);
  // "more pages exist" — inferred from the last page being full (data.length === PAGE_SIZE).
  const [hasMore, setHasMore] = useState(true);
  // Reactive flag for the dropdown's bottom spinner while a next page is fetching.
  const [loadingMore, setLoadingMore] = useState(false);
  // In-flight dedup: concurrent callers (a single shared instance still gets its
  // mount effect double-invoked under StrictMode, plus overlapping refresh effects)
  // share one request instead of each firing its own GET /api/threads.
  const inFlight = useRef<Promise<void> | null>(null);
  // Number of loaded rows == next offset. Kept in a ref so loadMore reads it
  // without a stale closure and without re-creating the callback each render.
  const countRef = useRef(0);
  // Synchronous concurrency guard (the state above is for rendering only).
  const loadingMoreRef = useRef(false);

  const fetchPage = useCallback(
    async (offset: number): Promise<ChatThreadMeta[]> => {
      const res = await apiFetch(`${serverUrl}/api/threads?limit=${PAGE_SIZE}&offset=${offset}`);
      if (!res.ok) return [];
      const body = (await res.json()) as Envelope<ChatThreadMeta[]>;
      return body.data ?? [];
    },
    [serverUrl],
  );

  // Reload page 0 (replaces the list). Deduped: collapses the burst of mount/effect
  // calls into one request. A real invalidation (create/delete/rename) is a fresh call.
  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    setLoading(true);
    const run = (async () => {
      try {
        const page = await fetchPage(0);
        setThreads(page);
        countRef.current = page.length;
        setHasMore(page.length === PAGE_SIZE);
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [fetchPage]);

  // Append the next page (infinite scroll). Serialized via loadingMore; skipped
  // while a page-0 refresh is in flight (it would reset the offset anyway).
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || inFlight.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchPage(countRef.current);
      setThreads((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        const merged = [...prev, ...page.filter((t) => !seen.has(t.id))];
        countRef.current = merged.length;
        return merged;
      });
      setHasMore(page.length === PAGE_SIZE);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [fetchPage, hasMore]);

  const createThread = useCallback(async (): Promise<ChatThreadMeta | null> => {
    const res = await apiFetch(`${serverUrl}/api/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Envelope<ChatThreadMeta>;
    await refresh();
    return body.data;
  }, [serverUrl, refresh]);

  const deleteThread = useCallback(
    async (id: string) => {
      const res = await apiFetch(`${serverUrl}/api/threads/${id}`, { method: 'DELETE' });
      if (res.ok) await refresh();
    },
    [serverUrl, refresh],
  );

  const renameThread = useCallback(
    async (id: string, title: string) => {
      const res = await apiFetch(`${serverUrl}/api/threads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (res.ok) await refresh();
    },
    [serverUrl, refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { threads, loading, hasMore, loadingMore, refresh, loadMore, createThread, deleteThread, renameThread };
}
