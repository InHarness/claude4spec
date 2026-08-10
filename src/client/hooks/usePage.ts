import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { toast } from '../ui/events.js';
import type { PageContent, PageWriteAck } from '../../shared/types.js';

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
  /**
   * The guard, when the caller read the page OUTSIDE the query cache and so
   * holds a hash this hook cannot find (`PageLinksList` reads with `api.read`
   * to rewrite one token). Omitted, the cached hash is used — which is the
   * editor's case and the common one.
   */
  expectedHash?: string;
}

/**
 * Exported for the regression test — the rule above is the load-bearing part.
 *
 * 0.2.15 adds the second half of it: the ack's `hash` is written into the cache
 * too. `update_page` now REQUIRES `expectedHash`, and this cache entry is where
 * the next save reads it from — the deliberate no-re-read policy documented
 * above means a hash left at its read-time value would be stale from the first
 * save onward, and every subsequent one would 409.
 */
export function applyPageWriteToCache(qc: QueryClient, vars: PageWriteVars, ack?: PageWriteAck): void {
  qc.setQueryData(['page', vars.rootId, vars.path], (prev: PageContent | undefined) =>
    prev
      ? {
          ...prev,
          body: vars.body,
          ...(vars.frontmatter !== undefined ? { frontmatter: vars.frontmatter } : {}),
          ...(ack ? { hash: ack.hash } : {}),
        }
      : prev,
  );
  qc.invalidateQueries({ queryKey: ['pages', vars.rootId] });
}

/**
 * One save per page at a time, each guarded by the previous one's ACK.
 *
 * The editor debounces, it does not serialize: a save that outlives the 500 ms
 * window is still in flight when the next one is queued, and both read the same
 * hash — the one from before either landed. With the guard mandatory, the second
 * write is then refused as a conflict against a file only the first write
 * touched. That is not a conflict, it is this client racing itself, and the cost
 * fell on the user: `write.mutate` is fire-and-forget, `lastSavedBodyRef` was
 * already advanced, so the newest paragraph was dropped with nothing shown.
 *
 * So the write is chained behind whatever is already in flight for the same
 * page, and takes its guard from that write's ack — the one hash that is
 * current by construction, without a re-read. A conflict surviving this is a
 * real one: somebody else changed the file.
 */
const inFlightWrites = new Map<string, Promise<PageWriteAck>>();

function writeSerialized(qc: QueryClient, args: PageWriteVars): Promise<PageWriteAck> {
  const key = `${args.rootId}::${args.path}`;
  const prior = inFlightWrites.get(key);
  const run = (async (): Promise<PageWriteAck> => {
    let hash: string | undefined = args.expectedHash;
    if (hash === undefined && prior) {
      // A failed predecessor did not land, so its hash is not the current one —
      // fall through to the cache, which still holds what we last saw.
      hash = await prior.then((ack) => ack.hash).catch(() => undefined);
    }
    /**
     * The guard value comes from the cache, which is this client's own record
     * of what it last read or wrote — never from a read issued here. Re-reading
     * to obtain a hash and immediately writing it back would satisfy the
     * server's schema while guarding nothing: the window it is supposed to
     * close is exactly the one such a read would sit inside.
     */
    hash ??= qc.getQueryData<PageContent>(['page', args.rootId, args.path])?.hash ?? '';
    return api.write(args.rootId, args.path, args.body, args.frontmatter, hash);
  })();
  inFlightWrites.set(key, run);
  void run.catch(() => undefined).then(() => {
    if (inFlightWrites.get(key) === run) inFlightWrites.delete(key);
  });
  return run;
}

export function useWritePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: PageWriteVars) => writeSerialized(qc, args),
    onSuccess: (ack, vars) => applyPageWriteToCache(qc, vars, ack),
    /**
     * A save that fails has to say so. The editor's autosave is the one caller
     * with no `onError` of its own — it fires and forgets — so a refusal here
     * used to leave the user typing into a document that was no longer being
     * persisted, and looked identical to a document that was.
     */
    onError: (err: Error) => toast.error(`Save failed: ${err.message}`),
  });
}

/**
 * Create a page that does not exist yet — the counterpart to `useWritePage`,
 * separate for the reason spelled out on `api.create`: there is no hash to
 * guard a file that is not there.
 */
export function useCreatePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { rootId: string; path: string; content: string }) =>
      api.create(args.rootId, args.path, args.content),
    onSuccess: (_ack, vars) => {
      qc.invalidateQueries({ queryKey: ['pages', vars.rootId] });
    },
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
