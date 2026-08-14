import { optionalString, type ParsedArgs } from './args.js';
import { CliError, type CliErrorCode } from './errors.js';
import { AgentError, getJson, healthCheck, patchJson, postJson, resolveServer } from '../../core/agent/http.js';

/**
 * The `server-delegating` execution mode, as one function per verb.
 *
 * ## What changed in 0.2.13
 *
 * Until 0.2.12 a read command opened `~/.claude4spec/<ws>/<id>/db.sqlite`
 * `readonly: true`, built a serialization engine and a discovery core, and
 * answered from them. That made the `c4s` process a SECOND execution locus for
 * operations the server process also implemented, and the two drifted: a plugin
 * type present in one and absent in the other, a serializer version behind, a
 * root list assembled differently. Item 22 removes the locus rather than trying
 * to keep the two in step.
 *
 * So every command below the agent flow is now this: resolve the address,
 * health-check it, call the operation's route, print what came back. **The CLI
 * carries no semantics.** It does not serialize, does not iterate types, does
 * not walk roots, and does not decide what an error means — it re-frames the
 * server's code into an exit status.
 *
 * ## Health-check before every call (item 24)
 *
 * Not only before an agent turn, which is where it started. Without it, "no
 * server", "some other process on that port" and "this project is not
 * registered here" all surface as whatever the first real call happened to fail
 * with — and only one of the three is fixed by starting a server. Memoized per
 * process, because a command that pages does not become three diagnoses.
 *
 * ## What is NOT here
 *
 * There is no fallback to local execution and no starting a server in the
 * background. `SERVER_NOT_RUNNING` (exit 8) is the whole answer: it names the
 * one thing the caller has to do. A CLI that quietly started a server would put
 * a second unsupervised process on the machine; one that fell back to reading
 * the database would restore the locus this release removed.
 */

interface Target {
  baseUrl: string;
  apiBase: string;
  projectId: string;
}

/**
 * Resolved once per process.
 *
 * A command makes between one and several calls — the exhaustive sweeps page —
 * and re-resolving would re-read the registry and re-run the health-check for
 * each. Keyed by the selectors, so a test driving two different targets in one
 * process is not served a stale one.
 */
const TARGETS = new Map<string, Promise<Target>>();

/** Test seam: forget the memoized targets. */
export function __resetDelegateTargets(): void {
  TARGETS.clear();
}

export async function resolveTarget(args: ParsedArgs): Promise<Target> {
  const server = optionalString(args, 'server');
  const key = `${server ?? ''}\0${args.project ?? ''}\0${args.workspace ?? ''}`;
  const hit = TARGETS.get(key);
  if (hit) return hit;
  const pending = (async () => {
    const target = await resolveServer({
      ...(args.project !== undefined ? { project: args.project } : {}),
      ...(args.workspace !== undefined ? { workspace: args.workspace } : {}),
      ...(server !== undefined ? { server } : {}),
    });
    await healthCheck(target.baseUrl, target.apiBase);
    return target;
  })();
  TARGETS.set(key, pending);
  // A failed resolution must not be cached: the user starts the server and runs
  // the command again in the same shell, and in a test the next case is a
  // different world entirely.
  pending.catch(() => TARGETS.delete(key));
  return pending;
}

export type QueryValue = string | number | boolean | readonly string[] | undefined;

/**
 * Query string from a record, dropping absent values.
 *
 * `undefined` is dropped rather than serialized, so a command can spread an
 * optional flag straight in and the server sees the parameter as ABSENT — which
 * is what lets the core's own default stand. Arrays join with a comma, the
 * spelling every one of these routes reads.
 */
function queryString(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === false) continue;
    params.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * Map a transport failure onto the CLI's error surface.
 *
 * The code is the SERVER'S, passed through rather than translated. Both unions
 * spell these the same way on purpose: a script branching on `c4s`'s exit status
 * and one reading a REST envelope are looking at one vocabulary. A CLI that
 * renamed anything here would be the fourth surface with its own error names,
 * which is what this release exists to stop.
 */
function asCliError(err: unknown): never {
  if (err instanceof AgentError) {
    throw new CliError(err.code as CliErrorCode, err.message, err.hint);
  }
  throw err;
}

/** GET one of the operation's routes under `/api/projects/:id`. */
export async function delegateGet(
  args: ParsedArgs,
  path: string,
  query?: Record<string, QueryValue>,
): Promise<unknown> {
  const { apiBase } = await resolveTarget(args).catch(asCliError);
  return getJson(`${apiBase}${path}${queryString(query)}`).catch(asCliError);
}

/** POST — `file-patch` and the agent flow's siblings. */
export async function delegatePost(args: ParsedArgs, path: string, body: unknown): Promise<unknown> {
  const { apiBase } = await resolveTarget(args).catch(asCliError);
  return postJson(`${apiBase}${path}`, body).catch(asCliError);
}

/** PATCH — the artifact frontmatter door. */
export async function delegatePatch(args: ParsedArgs, path: string, body: unknown): Promise<unknown> {
  const { apiBase } = await resolveTarget(args).catch(asCliError);
  return patchJson(`${apiBase}${path}`, body).catch(asCliError);
}

/**
 * The batch cap `get_entities` enforces server-side.
 *
 * Duplicated as a NUMBER rather than imported, because importing it would pull
 * `server/discovery/` into the CLI process — the one thing this tier removes.
 * The architecture gate that forbids that import is what makes the duplication
 * deliberate rather than an oversight; `delegateGetEntities` asserts its own
 * behaviour against the server's refusal, so a drift in the constant surfaces as
 * a failing test rather than as a silent change of batch size.
 */
const MAX_SLUGS_PER_CALL = 50;

export interface EntityRow {
  slug: string;
  entity: unknown | null;
  truncated?: boolean;
}

/**
 * `get_entities` for a caller that wants ROWS, not the operation's raw envelope.
 *
 * This is the CLI-side successor to the deleted `getEntitiesAll`, and it exists
 * for the two reasons that helper documented. Both were lost when the tag
 * commands started calling the route directly, and neither is visible in the
 * response's shape:
 *
 *   1. **The 50-slug cap.** `get_entities` refuses a longer list outright
 *      (`INVALID_ARGUMENT`), which is right for the raw operation — the caller
 *      named the rows, so the cap is the valve. But `<element_list/>` naming 51
 *      acceptance criteria is an ordinary page, and the renderer promised to
 *      batch it. Chunked here, and the chunks are merged in input order.
 *
 *   2. **Budget-degraded rows.** Past its response budget the operation demotes
 *      a row to `{ entity: null, truncated: true }` rather than dropping it —
 *      right for an agent, which can re-ask for a smaller subset. A renderer
 *      that does not know the flag reads `entity: null` as "no such entity" and
 *      shows an existing entity as missing. Each degraded row is re-fetched
 *      ALONE, and a single-slug call cannot come back degraded (the first item
 *      is never demoted), which is what makes the retry terminate.
 */
export async function delegateGetEntities(
  args: ParsedArgs,
  type: string,
  slugs: readonly string[],
  /**
   * 0.2.22 — the projection, where the fixed `view` used to be. `undefined` is
   * the default width; `[]` is the identity skeleton, which is what a chip or a
   * list row is. The retry below carries the SAME value, or the caller would get
   * two shapes in one answer.
   */
  select?: readonly string[],
): Promise<EntityRow[]> {
  const rows: EntityRow[] = [];
  for (let i = 0; i < slugs.length; i += MAX_SLUGS_PER_CALL) {
    const chunk = slugs.slice(i, i + MAX_SLUGS_PER_CALL);
    const payload = (await delegateGet(args, `/entities/${type}/get`, { slugs: chunk, select })) as {
      results?: EntityRow[];
    };
    rows.push(...(payload.results ?? []));
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.truncated !== true) continue;
    const payload = (await delegateGet(args, `/entities/${type}/get`, {
      slugs: [rows[i]!.slug],
      select,
    })) as { results?: EntityRow[] };
    const [retried] = payload.results ?? [];
    if (retried) rows[i] = retried;
  }
  return rows;
}

/**
 * How many pages an exhaustive sweep will fetch before it gives up.
 *
 * A runaway guard, not a limit on the answer. It exists because the loop's exit
 * condition is the server's `hasMore`, and a server that answered `true`
 * forever would spin here. 500 pages at the core's default page size is far past
 * any real specification; reaching it is reported, never hidden.
 */
const MAX_SWEEP_PAGES = 1000;

/**
 * The page size a sweep asks for — the core's `MAX_LIMIT`, duplicated as a
 * number for the same reason `MAX_SLUGS_PER_CALL` is.
 *
 * Not passing it was a real regression, in both directions at once. The core
 * helpers this replaced (`listEntitiesAll`, `listTagsAll`) asked for
 * `limit: MAX_LIMIT` and looped up to `MAX_PAGES` (1000) — a ceiling around a
 * million rows. Omitting the limit here let the server apply
 * `DEFAULT_LIMITS.listEntities` (50), so with `MAX_SWEEP_PAGES` at 500 the
 * ceiling fell to 25,000 while the number of HTTP round-trips for the same
 * answer rose twentyfold: `c4s list-slugs --type ac` over 2,000 ACs went from
 * one call to forty, each serializing 50 payloads.
 *
 * The ceiling is what makes it a correctness bug rather than a slow path. These
 * are the sweeps whose whole contract is "everything", and past it they report
 * `hasMore: true` — an honest signal, but one no caller of `tagged_list` is
 * expecting to have to read.
 */
const SWEEP_PAGE_SIZE = 1000;

export interface Sweep<T> {
  items: T[];
  /** False when the guard tripped — the caller must report this, not swallow it. */
  exhausted: boolean;
}

/**
 * Page an operation to the end.
 *
 * `tagged_list`, `tagged_list_mixed` and `find-references` answer "is anything
 * still pointing at this before I rename it" and "what is tagged X" — questions
 * where a capped answer is a wrong answer that reads like a right one. In-process
 * they used the core's own `listEntitiesAll`/`findReferencesAllPaged` helpers to
 * exhaust the pages.
 *
 * Over HTTP that becomes this loop, and the move is a TRANSPORT change and
 * nothing more: the same operation, the same page size, the same rows, fetched
 * over a wire instead of a function call. What must not change is the reporting
 * contract — `exhausted: false` means the guard stopped the sweep short, and the
 * command surfaces that as `hasMore: true` rather than claiming completeness.
 */
export async function delegateGetAll<T>(
  args: ParsedArgs,
  path: string,
  query: Record<string, QueryValue> | undefined,
  pick: (payload: unknown) => { items: T[]; hasMore: boolean },
): Promise<Sweep<T>> {
  const items: T[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_SWEEP_PAGES; page++) {
    const payload = await delegateGet(args, path, { limit: SWEEP_PAGE_SIZE, ...query, offset });
    const { items: batch, hasMore } = pick(payload);
    items.push(...batch);
    if (!hasMore) return { items, exhausted: true };
    // A page that reports `hasMore` while returning nothing would loop forever
    // on a fixed offset. Treat it as the end and say the sweep did not finish.
    if (batch.length === 0) return { items, exhausted: false };
    offset += batch.length;
  }
  return { items, exhausted: false };
}
