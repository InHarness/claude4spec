import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import type { PageContent } from '../../shared/types.js';

// 0.1.96: page queries/mutations are keyed by (rootId, path).
export function usePage(rootId: string, path: string | null) {
  return useQuery({
    queryKey: ['page', rootId, path],
    queryFn: () => api.read(rootId, path as string),
    enabled: Boolean(path),
    staleTime: 0,
  });
}

/**
 * A save updates the cache from what it SENT, not from what came back.
 *
 * This used to seed `['page', …]` with the write's own response, which worked
 * only because the response echoed the whole `PageContent` — and `body` in it
 * was `input.body`, byte for byte. That echo is gone, so the seed has to come
 * from `vars`, which is the same bytes from the same place.
 *
 * Re-reading instead (invalidate, let the GET refill it) is the obvious move and
 * is wrong here. The refetched body is `matter(fileOnDisk).content`, which is
 * NOT what the editor sent: `matter.stringify` leaves a trailing newline on any
 * page with frontmatter, and the write-back phase injects `<!-- anchor: … -->`
 * lines for new headings. `Editor`'s "this is the echo of my own write, don't
 * overwrite" guard compares against exactly the string it saved, so every such
 * save would miss the guard, fall through to `setContent`, and rebuild the
 * ProseMirror document — dropping the caret mid-typing, and with it any
 * keystroke landing in the window before `isDirtyRef` is re-read.
 *
 * So the cache keeps holding the client's own bytes, exactly as before; what
 * changed is only that the server no longer has to send them back to say so.
 * The key comes from `vars` too — the answer no longer carries a path.
 */
export interface PageWriteVars {
  rootId: string;
  path: string;
  body: string;
  frontmatter?: Record<string, unknown>;
}

/** Exported for the regression test — the rule above is the load-bearing part. */
export function applyPageWriteToCache(qc: QueryClient, vars: PageWriteVars): void {
  qc.setQueryData(['page', vars.rootId, vars.path], (prev: PageContent | undefined) =>
    prev
      ? { ...prev, body: vars.body, ...(vars.frontmatter !== undefined ? { frontmatter: vars.frontmatter } : {}) }
      : prev,
  );
  qc.invalidateQueries({ queryKey: ['pages', vars.rootId] });
}

export function useWritePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: PageWriteVars) => api.write(args.rootId, args.path, args.body, args.frontmatter),
    onSuccess: (_ack, vars) => applyPageWriteToCache(qc, vars),
  });
}

export function useDeletePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { rootId: string; path: string }) => api.remove(args.rootId, args.path),
    onSuccess: (_data, vars) => {
      qc.removeQueries({ queryKey: ['page', vars.rootId, vars.path] });
      qc.invalidateQueries({ queryKey: ['pages', vars.rootId] });
    },
  });
}
