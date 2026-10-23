import { partialMatchKey, type InvalidateQueryFilters, type QueryClient, type QueryKey } from '@tanstack/react-query';

/** A filter that is nothing but a key prefix (no predicate, no other narrowing). */
function isBarePrefix(filters: InvalidateQueryFilters): filters is { queryKey: QueryKey } {
  return filters.queryKey !== undefined && Object.keys(filters).length === 1;
}

/**
 * `cover` invalidates everything `filters` does: a bare prefix of its key that
 * is either strictly shorter or `filters` narrows it further (a predicate).
 */
function covers(cover: InvalidateQueryFilters, filters: InvalidateQueryFilters): boolean {
  if (cover === filters || !isBarePrefix(cover) || filters.queryKey === undefined) return false;
  if (!partialMatchKey(filters.queryKey, cover.queryKey)) return false;
  return !isBarePrefix(filters) || cover.queryKey.length < filters.queryKey.length;
}

export interface InvalidationBatcher {
  queue(queryKey: QueryKey): void;
  /** Queue an invalidation narrower than a key prefix; `id` dedupes it in the window. */
  queueFilters(id: string, filters: InvalidateQueryFilters): void;
  flushNow(): void;
  dispose(): void;
}

export function createInvalidationBatcher(
  qc: QueryClient,
  windowMs = 500,
): InvalidationBatcher {
  const pending = new Map<string, InvalidateQueryFilters>();
  let timer: number | null = null;

  function flush() {
    // One window, one refetch per query: an entry another pending bare prefix
    // already covers is not invalidated a second time (a second
    // `invalidateQueries` would cancel and restart the first one's refetch).
    const all = [...pending.values()];
    for (const filters of all) {
      if (all.some((cover) => covers(cover, filters))) continue;
      qc.invalidateQueries(filters);
    }
    pending.clear();
    timer = null;
  }

  function add(id: string, filters: InvalidateQueryFilters) {
    if (pending.has(id)) return;
    pending.set(id, filters);
    if (timer === null) {
      timer = window.setTimeout(flush, windowMs);
    }
  }

  return {
    queue(queryKey) {
      add(JSON.stringify(queryKey), { queryKey });
    },
    queueFilters(id, filters) {
      // A prefix `id` cannot collide with a JSON-encoded key (always `[…]`).
      add(`filters:${id}`, filters);
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
