import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Dispatcher } from 'undici';
import { resolveWorkspaceProject, WorkspaceResolveError } from '../workspace/resolve.js';

/**
 * The `c4s` process talking to a claude4spec server: address resolution, the
 * identity health-check, and JSON verbs.
 *
 * ## Why this is its own module as of 0.2.13
 *
 * All of it used to live inside `run-agent.ts`, because for two releases the
 * only thing the CLI sent over HTTP was an agent turn. Everything else read
 * SQLite in-process. Item 22 ends that: **execution of a catalog operation
 * belongs to the server**, so every read command is now an HTTP call, and
 * `c4s catalog` importing `postJson` from a module called `run-agent` would be
 * a lie about what the CLI is.
 *
 * Nothing here knows about agents, operations, or commands. It answers three
 * questions and no others: which server, is it the right one, and what did it
 * say.
 *
 * ## The one rule worth restating
 *
 * A non-2xx carrying a claude4spec error envelope propagates the SERVER'S code,
 * message and hint. The CLI re-frames those into its own exit codes; it never
 * invents a diagnosis. That is what makes "the four channels answer with the
 * same codes" true rather than aspirational.
 */

/**
 * Codes the agent flow documents. Not exhaustive for the transport — a
 * `server-delegating` read command propagates whatever the operation answered
 * (`INVALID_TYPE`, `ENTITY_NOT_FOUND`, `PAGE_NOT_FOUND`, …), which is why
 * `AgentError.code` is a plain string.
 */
export type AgentErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'AMBIGUOUS_WORKSPACE'
  | 'PROJECT_SLUG_NOT_FOUND'
  | 'AMBIGUOUS_PROJECT'
  | 'PROJECT_NOT_IN_WORKSPACE'
  | 'SERVER_NOT_RUNNING'
  | 'SERVER_NOT_RECOGNIZED'
  | 'PROJECT_BUILD_FAILED'
  | 'NOT_FOUND'
  | 'STREAM_IN_PROGRESS'
  | 'AGENT_UNAVAILABLE'
  | 'AGENT_ERROR'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'INVALID_ARGS'
  // 0.1.104 create-mode (`POST /api/briefs`) error propagation.
  | 'VALIDATION'
  | 'BRIEF_SAME_RELEASE'
  | 'RELEASE_NOT_FOUND'
  // 0.1.106 `c4s mark-brief-implemented` (M36: `PATCH /api/artifacts/brief/:path/frontmatter`).
  | 'BRIEF_NOT_FOUND'
  | 'IMMUTABLE_FIELD';

/**
 * A failure carrying the code the SERVER used.
 *
 * `code` is a plain string rather than {@link AgentErrorCode}: since 0.2.13 the
 * same transport carries every catalog operation, and narrowing the field would
 * force each new operation's codes into this union — the exact "declare it in
 * two places" pattern the release exists to remove. {@link AgentErrorCode}
 * stays as the documented set for the agent flow.
 */
export class AgentError extends Error {
  constructor(
    public code: string,
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

/**
 * Encode an artifact path for a URL path segment, refusing traversal FIRST.
 *
 * ## Why this is one function rather than an encode at each call site
 *
 * A relative artifact path (a brief under `briefsDir`, a plan under `plansDir`)
 * used to be read in this process, where `assertSafeRelPath` refused `..` before
 * anything opened. Once the read moved to the server, the obvious translation —
 * `p.split('/').map(encodeURIComponent).join('/')` — looks like it carries the
 * path verbatim and does not:
 *
 *   - `encodeURIComponent` leaves `..` alone. It is not a reserved character,
 *     so there is nothing for it to escape.
 *   - WHATWG URL resolution, inside `fetch`, then COLLAPSES the dot segments
 *     before the request goes out.
 *
 * So `../../config` appended to `/api/projects/<id>/artifacts/brief/` is sent as
 * `/api/projects/<id>/config` — a different, existing endpoint that answers 200.
 * The command prints an object with none of the fields it expected and exits 0.
 * The traversal is not refused by the server because the server never sees it.
 *
 * An absolute path is refused for the same reason: a leading `/` resets the
 * resolution to the origin.
 */
export function encodeArtifactPath(p: string): string {
  const segments = p.split('/');
  if (p.startsWith('/') || segments.some((s) => s === '..' || s === '.')) {
    throw new AgentError(
      'INVALID_ARGS',
      `path '${p}' escapes the artifact directory`,
      'give a path relative to the artifact directory, with no `..` segments',
    );
  }
  return segments.map(encodeURIComponent).join('/');
}

/**
 * Resolve `baseUrl` + `projectId` from `--server`/`--project`/`--workspace`.
 *
 * M31: discovery goes through the workspace registry (`defaultPort`), not
 * through `config.json` — the port stopped coming from the config in v3. Every
 * URL is prefixed `/api/projects/<id>`, because a peer serves N projects.
 *
 * These are the ONLY files the `c4s` process reads locally as of 0.2.13:
 * `.claude4spec/config.json` (the marker), `~/.claude4spec/workspaces.json` and
 * its `defaultPort`. They serve to FIND the server, never to read content.
 */
export async function resolveServer(params: {
  project?: string;
  workspace?: string;
  server?: string;
}): Promise<{ baseUrl: string; apiBase: string; projectId: string }> {
  let baseUrl: string;
  let projectId: string;
  if (params.server) {
    baseUrl = params.server.replace(/\/+$/, '');
    // `--server` with no resolvable project → require `--project` (the id is
    // computed from the project's absolute path, the way the peer registers it).
    try {
      const resolved = resolveWorkspaceProject({ project: params.project, workspace: params.workspace });
      projectId = resolved.projectId;
    } catch (err) {
      if (
        err instanceof WorkspaceResolveError &&
        (err.code === 'AMBIGUOUS_WORKSPACE' || err.code === 'AMBIGUOUS_PROJECT')
      ) {
        // Real ambiguity (2+ local matches) — surface it rather than silently
        // hashing the value as a path; the caller needs to disambiguate with
        // --workspace, not get routed to an arbitrary bogus projectId.
        throw new AgentError(err.code, err.message, err.hint);
      } else if (err instanceof WorkspaceResolveError && params.project) {
        // Path/slug given explicitly but unknown to the local registry (a remote
        // peer) — derive the id from the path itself.
        projectId = projectIdForPath(params.project);
      } else if (err instanceof WorkspaceResolveError) {
        throw new AgentError(
          'INVALID_ARGS',
          '--server requires --project <path> when no local workspace owns the current directory',
          'the project id in the URL prefix derives from the project path',
        );
      } else {
        throw err;
      }
    }
  } else {
    let resolved;
    try {
      resolved = resolveWorkspaceProject({ project: params.project, workspace: params.workspace });
    } catch (err) {
      if (err instanceof WorkspaceResolveError) {
        throw new AgentError(err.code, err.message, err.hint);
      }
      throw err;
    }
    baseUrl = `http://localhost:${resolved.defaultPort}`;
    projectId = resolved.projectId;
  }
  const apiBase = `${baseUrl}/api/projects/${projectId}`;
  return { baseUrl, apiBase, projectId };
}

/** M31: project id = sha1(abs path).slice(0,12) — same derivation as the registry. */
function projectIdForPath(project: string): string {
  return createHash('sha1').update(path.resolve(process.cwd(), project)).digest('hex').slice(0, 12);
}

/**
 * M31 identity health-check: `GET /api/projects/<id>/config` must answer with a
 * claude4spec v3 config shape. Five disjoint outcomes:
 *   connection refused              → SERVER_NOT_RUNNING
 *   not a c4s shape                 → SERVER_NOT_RECOGNIZED
 *   404 with a c4s envelope         → PROJECT_NOT_IN_WORKSPACE
 *   other non-2xx with an envelope  → the envelope's code (e.g. PROJECT_BUILD_FAILED)
 *   200 config                      → OK
 *
 * 0.2.13 item 24 runs this before EVERY `server-delegating` operation, not only
 * before an agent turn. The reason is the same one that made it worth having at
 * all: without it, "no server" and "wrong server" and "project not registered
 * here" all arrive as an unreadable failure from whatever call happened to go
 * first, and only one of the three is fixed by starting a server.
 */
export async function healthCheck(baseUrl: string, apiBase: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${apiBase}/config`);
  } catch {
    throw new AgentError(
      'SERVER_NOT_RUNNING',
      `no claude4spec server responding at ${baseUrl}`,
      'start it with `npx @inharness-ai/claude4spec` in the project',
    );
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new AgentError(
      'SERVER_NOT_RECOGNIZED',
      `process at ${baseUrl} responded but not with a claude4spec config`,
    );
  }
  if (res.status === 404 && isC4sErrorEnvelope(body)) {
    const err = (body as { error: { code?: string; message?: string } }).error;
    throw new AgentError(
      'PROJECT_NOT_IN_WORKSPACE',
      err.message ?? `project not registered in the workspace served at ${baseUrl}`,
      'register it: POST /api/workspace/projects or run `npx @inharness-ai/claude4spec` in the project',
    );
  }
  // A non-2xx carrying a c4s error envelope means the server IS claude4spec but
  // this project failed to build (e.g. 500 PROJECT_BUILD_FAILED). Surface its own
  // code/message instead of masking it as "not a claude4spec server" — otherwise a
  // bad config.json (e.g. an unselectable writingStyle) looks like a missing server.
  if (!res.ok && isC4sErrorEnvelope(body)) {
    const err = (body as { error: { code?: string; message?: string; hint?: string } }).error;
    throw new AgentError(
      err.code ?? 'PROJECT_BUILD_FAILED',
      err.message ?? `project at ${baseUrl} failed to build`,
      err.hint,
    );
  }
  if (!res.ok || !isConfigShape(body)) {
    throw new AgentError(
      'SERVER_NOT_RECOGNIZED',
      `process at ${baseUrl} is not a claude4spec server (unexpected GET ${apiBase}/config shape)`,
    );
  }
}

function isC4sErrorEnvelope(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const e = (body as { error?: unknown }).error;
  return !!e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string';
}

/** M31/0.1.96 shape — no port/mode; `roots[]` (was `pagesDir`) + entitiesDir required. */
function isConfigShape(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const c = body as Record<string, unknown>;
  return (
    typeof c.name === 'string' &&
    Array.isArray(c.roots) &&
    typeof c.entitiesDir === 'string' &&
    'writingStyle' in c &&
    !!c.onboarding &&
    typeof c.onboarding === 'object'
  );
}

/**
 * Distinguishes genuine connection-refused from other fetch failures (e.g. a
 * client-side timeout) — only the former legitimately means "not running".
 */
function throwOnFetchFailure(err: unknown, url: string): never {
  const code = (err as { cause?: { code?: string } } | undefined)?.cause?.code;
  if (code === 'ECONNREFUSED') {
    throw new AgentError('SERVER_NOT_RUNNING', `request to ${url} failed (connection refused)`);
  }
  throw err;
}

/** Read the response, propagating `{ error: { code, message, hint } }` on non-2xx. */
async function readJson(res: Response, url: string): Promise<unknown> {
  let body: unknown = {};
  try {
    body = await res.json();
  } catch {
    /* empty / non-JSON body — handled below by !res.ok */
  }
  if (!res.ok) {
    const err = ((body as { error?: unknown })?.error ?? {}) as {
      code?: string;
      message?: string;
      hint?: string;
    };
    throw new AgentError(
      err.code ?? 'AGENT_ERROR',
      err.message ?? `request to ${url} failed with HTTP ${res.status}`,
      err.hint,
    );
  }
  return body;
}

/**
 * Unwrap the `{ data }` envelope when there is one.
 *
 * REST answers are not uniform here and were not made uniform by this release:
 * `POST /api/patches` answers `{ data: … }`, while the operation renderings
 * answer the core's envelope bare (`{ items, total, hasMore }`). Unwrapping when
 * present and passing through otherwise is what lets one verb serve both without
 * each command knowing which kind it called.
 */
function unwrap(body: unknown): unknown {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return (body as Record<string, unknown>).data;
  }
  return body;
}

/**
 * GET JSON. Added in 0.2.13 — before it, nothing the CLI did was a read over
 * HTTP.
 *
 * Returns `unknown` rather than `Record<string, unknown>` because a rendered
 * operation may legitimately answer with an array (`find-references` did, for
 * one), and a signature that promised an object would push every command into a
 * cast.
 */
export async function getJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throwOnFetchFailure(err, url);
  }
  return unwrap(await readJson(res, url));
}

/** POST JSON; on non-2xx propagates the endpoint's `{ error: { code, message } }`. */
export async function postJson(
  url: string,
  payload: unknown,
  opts?: { dispatcher?: Dispatcher },
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      ...(opts?.dispatcher ? { dispatcher: opts.dispatcher } : {}),
    });
  } catch (err) {
    throwOnFetchFailure(err, url);
  }
  return (unwrap(await readJson(res, url)) ?? {}) as Record<string, unknown>;
}

/** PATCH JSON — mirror of {@link postJson}. */
export async function patchJson(url: string, payload: unknown): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throwOnFetchFailure(err, url);
  }
  return (unwrap(await readJson(res, url)) ?? {}) as Record<string, unknown>;
}
