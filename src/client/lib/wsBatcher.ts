import type { QueryClient, QueryKey } from '@tanstack/react-query';

export interface InvalidationBatcher {
  queue(queryKey: QueryKey): void;
  flushNow(): void;
  dispose(): void;
}

export function createInvalidationBatcher(
  qc: QueryClient,
  windowMs = 500,
): InvalidationBatcher {
  const pending = new Map<string, QueryKey>();
  let timer: number | null = null;

  function flush() {
    for (const key of pending.values()) {
      qc.invalidateQueries({ queryKey: key });
    }
    pending.clear();
    timer = null;
  }

  return {
    queue(queryKey) {
      const k = JSON.stringify(queryKey);
      if (pending.has(k)) return;
      pending.set(k, queryKey);
      if (timer === null) {
        timer = window.setTimeout(flush, windowMs);
      }
    },
    flushNow() {
      if (timer !== null) {
        clearTimeout(timer);
        flush();
      }
    },
    dispose() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending.clear();
    },
  };
}
