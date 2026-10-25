/**
 * 2.1.48 (M21/M23/M10) — this tab's own artifact writes, so the global watcher
 * (`useFileWatcher`) can tell the WS echo of its own save from somebody else's
 * write of the same file.
 *
 * Why it exists: a brief's, patch's or plan's detail query holds the WHOLE file
 * (the artifact detail route's default projection), so the echo the server
 * broadcasts for this tab's own write must not refetch it:
 *   - a brief content save (`briefs:changed`, `origin: 'server'`, always): the
 *     mutation writes the cache itself (sent content + the PUT's hash). A
 *     refetch would re-download the whole file on every debounced autosave,
 *     and if it started before a later save landed, its older answer would put
 *     the older hash back → the next autosave sends a stale `expectedHash` → a
 *     spurious 409;
 *   - a plan Save (`plan:updated` with `threadId: null`, always:
 *     `PlanService.updateContent`): the mutation writes the cache itself, as for
 *     a brief. A `plan:updated` naming a thread is an agent's write, never this
 *     echo, so the watcher does not offer it to the ledger. `threadId: null`
 *     does NOT mean "own": the REST frontmatter PATCH (another tab renaming the
 *     plan or flipping `applied`) and an explicitly addressed `update_plan`
 *     broadcast it too. Taking such an event for the echo is still safe, because
 *     every plan write holds the same per-path lock: a foreign write that lands
 *     before this PUT makes it fail with 409 (and `failed()` hands the event
 *     back), and one that lands after it is broadcast after this tab's echo;
 *   - a patch's `applied` flip (`patches:changed`): the mutation already
 *     refetches the detail once; the echo would add a second whole-file read.
 * A patch CONTENT save takes no token: the editor keeps the frontmatter block
 * byte-identical, so the save broadcasts nothing and there is no echo — a token
 * could only swallow another writer's `patches:changed`.
 *
 * What it must NOT do: swallow anyone else's write. `origin: 'server'` labels
 * every write the app performs — an agent's MCP tool, another tab — and an open
 * screen must still refresh on those. So a write absorbs AT MOST ONE artifact
 * event of its own path, and only one that can be its echo:
 *   - an event arriving while the write is in flight (the server broadcasts it
 *     before it answers the PUT);
 *   - for a write whose echo is guaranteed (`lateEcho` — a brief content save
 *     or a plan Save, whose `updateContent` always broadcasts), the first event after
 *     the PUT answered, if none came during the flight: the WS frame and the
 *     HTTP response travel on different sockets.
 * The base `file:changed` is never absorbed: the record store writes briefs,
 * patches and plans with `chain: false` under the primitive's suppress token, so an own
 * save broadcasts no `file:changed` — one that arrives is another writer.
 *
 * A failed write hands back whether it absorbed an event (`failed()` → true):
 * that event may have been the foreign write that made it fail, so the caller
 * invalidates the detail exactly as the watcher would have.
 *
 * A reconnect of the live-update socket drops the ledger (`resetOwnWrites`):
 * frames sent while it was down are gone, and a token waiting for a lost echo
 * would otherwise swallow the next foreign event.
 */

/** The system root whose artifact event (`briefs:changed` / `patches:changed` / `plan:updated`) carries the echo. */
export type OwnWriteRoot = 'briefs' | 'patches' | 'plans';

export interface OwnWrite {
  /** The PUT answered 2xx. */
  succeeded(): void;
  /** The PUT failed; true when an event of the path was absorbed meanwhile. */
  failed(): boolean;
}

interface Token {
  key: string;
  lateEcho: boolean;
  /** One event of the path was attributed to this write. */
  seen: boolean;
  /** The PUT answered 2xx. */
  done: boolean;
}

const tokens = new Map<string, Token[]>();

const keyOf = (root: OwnWriteRoot, path: string): string => `${root}\u001f${path}`;

function drop(token: Token): void {
  const list = tokens.get(token.key);
  if (!list) return;
  const rest = list.filter((t) => t !== token);
  if (rest.length > 0) tokens.set(token.key, rest);
  else tokens.delete(token.key);
}

/** Register a write of this tab BEFORE its request is sent. */
export function beginOwnWrite(root: OwnWriteRoot, path: string, opts: { lateEcho: boolean }): OwnWrite {
  const token: Token = { key: keyOf(root, path), lateEcho: opts.lateEcho, seen: false, done: false };
  const list = tokens.get(token.key);
  if (list) list.push(token);
  else tokens.set(token.key, [token]);
  return {
    succeeded() {
      token.done = true;
      if (token.seen || !token.lateEcho) drop(token);
    },
    failed() {
      drop(token);
      return token.seen;
    },
  };
}

/**
 * Called by the watcher for an artifact event of `path` that is not
 * `origin: 'external'`. True → it is this tab's own echo: the detail cache
 * already holds what it announces, so the detail is not refetched.
 */
export function absorbOwnEcho(root: OwnWriteRoot, path: string): boolean {
  const list = tokens.get(keyOf(root, path));
  // In-flight writes first, oldest first; then a settled write still owed its echo.
  const token = list?.find((t) => !t.seen && !t.done) ?? list?.find((t) => !t.seen);
  if (!token) return false;
  token.seen = true;
  if (token.done) drop(token);
  return true;
}

/** The live-update socket reconnected: every pending echo may have been lost. */
export function resetOwnWrites(): void {
  tokens.clear();
}
