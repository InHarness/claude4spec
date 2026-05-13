import { useCallback, useEffect, useState } from 'react';
import type { ChatThreadMeta } from '../../shared/entities.js';

interface Envelope<T> {
  data: T;
}

export function useThreadList(serverUrl = '') {
  const [threads, setThreads] = useState<ChatThreadMeta[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${serverUrl}/api/threads`);
      if (!res.ok) return;
      const body = (await res.json()) as Envelope<ChatThreadMeta[]>;
      setThreads(body.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [serverUrl]);

  const createThread = useCallback(async (): Promise<ChatThreadMeta | null> => {
    const res = await fetch(`${serverUrl}/api/threads`, {
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
      const res = await fetch(`${serverUrl}/api/threads/${id}`, { method: 'DELETE' });
      if (res.ok) await refresh();
    },
    [serverUrl, refresh],
  );

  const renameThread = useCallback(
    async (id: string, title: string) => {
      const res = await fetch(`${serverUrl}/api/threads/${id}`, {
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

  return { threads, loading, refresh, createThread, deleteThread, renameThread };
}
