import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveWorkspaceProject, WorkspaceResolveError } from '../workspace/resolve.js';

/**
 * `runAgent(...)` — single source of truth for the headless turn flow.
 *
 * Wolany przez dwa transporty: CLI binarke (`src/bin/c4s/commands/agent.ts`
 * + jej alias `ask.ts`) i in-process MCP server (`src/server/mcp/c4s-tools.ts`).
 * Cztery deterministyczne kroki: resolve project → health-check tozsamosci
 * serwera → create-thread (context-specific) → run-turn.
 *
 *   await runAgent({ message: '...', contextType: 'chat' })
 *   await runAgent({ message: '...', contextType: 'ask' })          // read-only peer consult
 *   await runAgent({ message: '...', server: 'http://other:4501', threadId: '...' })
 *   await runAgent({ message: '...', contextType: 'brief', briefPath: '...' })       // attach-mode
 *   await runAgent({ message: '...', contextType: 'brief', briefCreate: {...} })    // create-mode (0.1.104)
 */

export type AgentContextType = 'chat' | 'brief' | 'patch' | 'ask';

/** Default model resolved here so every transport shares one source of truth. */
const DEFAULT_MODEL = 'opus-4.8';

/** Default reasoning level resolved here — single source of truth, jak `DEFAULT_MODEL`. */
const DEFAULT_EFFORT = 'medium';

export interface AgentParams {
  message: string;
  /** Local path do `.claude4spec/` peera; mutex z `server`. */
  project?: string;
  /** M31: workspace selector — required when the project is in N workspaces. */
  workspace?: string;
  /** Override discovery URL serwera peera; gdy podany razem z `project` — `server` wygrywa. */
  server?: string;
  /** Default `'chat'`. Ignorowany gdy podano `threadId`. */
  contextType?: AgentContextType;
  /** Kontynuacja istniejacego watku u peera; pomija create-thread. */
  threadId?: string;
  /** Attach-mode dla `contextType='brief'` — otwiera watek na istniejacym briefie. Mutex z `briefCreate`. */
  briefPath?: string;
  /**
   * 0.1.104 create-mode dla `contextType='brief'` — mintuje nowy brief przez
   * `POST /api/briefs` (plik + initial thread), potem run-turn jak zwykle.
   * Mutex z `briefPath`. Dokladnie jedno z (`briefPath`, `briefCreate`) wymagane
   * gdy `contextType='brief'` i brak `threadId`.
   */
  briefCreate?: {
    source: 'release-diff' | 'analysis';
    /** `null` = initial brief (no previous release). */
    fromReleaseName: string | null;
    /** `null` = analysis brief (state relative to HEAD); required unless `source='analysis'`. */
    toReleaseName: string | null;
    roots?: string[];
    suffix?: string;
  };
  /** Model tury; domyslnie `'opus-4.8'` (rozwiazywany tutaj). */
  model?: string;
  /** Poziom reasoning tury; domyslnie `'medium'` (rozwiazywany tutaj). */
  effort?: 'low' | 'medium' | 'high';
  /**
   * `'final'` (default) → terse `{ threadId, answer }` (ostatnia wiadomosc asystenta).
   * `'full'` → dodatkowo `messages: AgentMessage[]` — wszystkie wiadomosci tury
   * (+ reasoning), zebrane w jednym batchu PO turze (nie live; ten sam
   * niestreamingowy endpoint `/ask`).
   */
  output?: 'final' | 'full';
}

/**
 * Pojedyncza wiadomosc tury — strukturalny podzbior `chat_message` zwracanego
 * przez `POST /api/threads/:id/ask`. Wypelniany tylko dla `output: 'full'`.
 */
export interface AgentMessage {
  role: string;
  content: string;
  toolName?: string | null;
  subagentTaskId?: string | null;
}

export interface AgentResult {
  threadId: string;
  answer: string;
  /** Populated only when `output === 'full'`. */
  messages?: AgentMessage[];
}

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
  // 0.1.106 `c4s mark-brief-implemented` (`PATCH /api/briefs/:path/frontmatter`).
  | 'BRIEF_NOT_FOUND'
  | 'BRIEF_FRONTMATTER_IMMUTABLE';

export class AgentError extends Error {
  constructor(public code: AgentErrorCode, message: string, public hint?: string) {
    super(message);
    this.name = 'AgentError';
  }
}

/**
 * Discovery: resuwa `baseUrl` + `projectId` z `--server`/`--project`/`--workspace`.
 * M31: discovery przez rejestr workspace'ow (`defaultPort`), nie przez
 * config.json (port wyprowadzil sie z configu w v3). Kazdy URL dostaje
 * prefiks `/api/projects/<id>` — peer servuje N projektow.
 *
 * Wyodrebnione z `runAgent` (0.1.106) tak, by `c4s mark-brief-implemented`
 * (ktore nie odpala tury agenta, tylko pojedynczy PATCH) mogl reuzyc dokladnie
 * to samo resolve+health-check bez duplikowania logiki.
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
    // `--server` bez resolvable projektu → wymagaj `--project` (id liczy sie
    // z absolutnej sciezki projektu, tak jak rejestruje go peer).
    try {
      const resolved = resolveWorkspaceProject({ project: params.project, workspace: params.workspace });
      projectId = resolved.projectId;
    } catch (err) {
      if (err instanceof WorkspaceResolveError && (err.code === 'AMBIGUOUS_WORKSPACE' || err.code === 'AMBIGUOUS_PROJECT')) {
        // Real ambiguity (2+ local matches) — surface it rather than silently
        // hashing the value as a path; the caller needs to disambiguate with
        // --workspace, not get routed to an arbitrary bogus projectId.
        throw new AgentError(err.code, err.message, err.hint);
      } else if (err instanceof WorkspaceResolveError && params.project) {
        // Sciezka/slug podana wprost, ale nieznana lokalnemu rejestrowi (zdalny
        // peer) — id wyprowadzamy z samej sciezki.
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

export async function runAgent(params: AgentParams): Promise<AgentResult> {
  const message = params.message;
  if (!message || !message.trim()) {
    throw new AgentError('INVALID_ARGS', 'message is required');
  }
  const model = params.model ?? DEFAULT_MODEL;
  const effort = params.effort ?? DEFAULT_EFFORT;
  const output: 'final' | 'full' = params.output ?? 'final';

  // --- discovery + health-check tozsamosci --------------------------------
  const { baseUrl, apiBase } = await resolveServer({
    project: params.project,
    workspace: params.workspace,
    server: params.server,
  });
  await healthCheck(baseUrl, apiBase);

  // --- create-thread (context-specific) — pomijany dla threadId ----------
  let threadId: string;
  if (params.threadId) {
    threadId = params.threadId;
  } else {
    const ct: AgentContextType = params.contextType ?? 'chat';
    if (ct !== 'chat' && ct !== 'brief' && ct !== 'patch' && ct !== 'ask') {
      throw new AgentError(
        'INVALID_ARGS',
        `contextType must be chat|brief|patch|ask (got '${ct}')`,
      );
    }
    if (ct === 'patch') {
      // Watki patch nie maja route create-thread — tylko kontynuacja.
      throw new AgentError(
        'INVALID_ARGS',
        'cannot create a patch thread via agent; pass threadId to continue one',
      );
    }
    if (ct === 'brief') {
      if (params.briefPath && params.briefCreate) {
        throw new AgentError(
          'INVALID_ARGS',
          "contextType='brief' accepts briefPath (attach) or briefCreate (create), not both",
        );
      }
      if (params.briefCreate) {
        // 0.1.104 create-mode: mint a new brief (file + initial thread) in one call.
        const created = await postJson(`${apiBase}/briefs`, {
          source: params.briefCreate.source,
          fromReleaseName: params.briefCreate.fromReleaseName,
          toReleaseName: params.briefCreate.toReleaseName,
          roots: params.briefCreate.roots,
          suffix: params.briefCreate.suffix,
        });
        threadId = pickThreadId(created);
      } else if (params.briefPath) {
        const encoded = params.briefPath.split('/').map(encodeURIComponent).join('/');
        const created = await postJson(`${apiBase}/briefs/${encoded}/threads`, {});
        threadId = pickThreadId(created);
      } else {
        throw new AgentError(
          'INVALID_ARGS',
          "contextType='brief' requires briefPath (attach) or briefCreate (create)",
        );
      }
    } else {
      // 'chat' + 'ask' share the generic create-thread route; the server
      // validates `context_type` (only 'chat'/'ask' accepted on this path).
      const created = await postJson(`${apiBase}/threads`, { context_type: ct });
      threadId = pickThreadId(created);
    }
  }

  // --- run-turn (generyczny po context_type) ------------------------------
  const result = await postJson(`${apiBase}/threads/${encodeURIComponent(threadId)}/ask`, {
    message,
    model,
    effort,
  });
  const answer = typeof result.answer === 'string' ? result.answer : '';
  const outThreadId = typeof result.threadId === 'string' ? result.threadId : threadId;
  const out: AgentResult = { threadId: outThreadId, answer };
  if (output === 'full') {
    out.messages = Array.isArray(result.messages) ? (result.messages as AgentMessage[]) : [];
  }
  return out;
}

/** M31: project id = sha1(abs path).slice(0,12) — same derivation as the registry. */
function projectIdForPath(project: string): string {
  // Lazy import-free copy of projectIdForCwd to keep run-agent dependency-light:
  // resolveWorkspaceProject already covers the registry path; this branch only
  // serves `--server` + explicit `--project` for a remote peer.
  return createHashHex(path.resolve(process.cwd(), project)).slice(0, 12);
}

/**
 * M31 health-check tozsamosci: `GET /api/projects/<id>/config` musi zwrocic
 * ksztalt configu claude4spec v3. Piec rozlacznych wynikow:
 *   connection refused           → SERVER_NOT_RUNNING
 *   nie-c4s ksztalt               → SERVER_NOT_RECOGNIZED
 *   404 z koperta c4s             → PROJECT_NOT_IN_WORKSPACE
 *   inny nie-2xx z koperta c4s    → kod z koperty (np. PROJECT_BUILD_FAILED)
 *   200 config                    → OK
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
      (err.code as AgentErrorCode) ?? 'PROJECT_BUILD_FAILED',
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

/** POST JSON; przy nie-2xx propaguje `{ error: { code, message } }` endpointu. */
async function postJson(url: string, payload: unknown): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new AgentError('SERVER_NOT_RUNNING', `request to ${url} failed (connection refused)`);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* puste/nie-JSON body — obsluzone nizej przez !res.ok */
  }
  if (!res.ok) {
    const err = (body.error ?? {}) as { code?: string; message?: string; hint?: string };
    throw new AgentError(
      (err.code as AgentErrorCode) ?? 'AGENT_ERROR',
      err.message ?? `request to ${url} failed with HTTP ${res.status}`,
      err.hint,
    );
  }
  return (body.data as Record<string, unknown>) ?? body;
}

/** PATCH JSON; przy nie-2xx propaguje `{ error: { code, message } }` endpointu — mirror of `postJson`. */
export async function patchJson(url: string, payload: unknown): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new AgentError('SERVER_NOT_RUNNING', `request to ${url} failed (connection refused)`);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* puste/nie-JSON body — obsluzone nizej przez !res.ok */
  }
  if (!res.ok) {
    const err = (body.error ?? {}) as { code?: string; message?: string; hint?: string };
    throw new AgentError(
      (err.code as AgentErrorCode) ?? 'AGENT_ERROR',
      err.message ?? `request to ${url} failed with HTTP ${res.status}`,
      err.hint,
    );
  }
  return (body.data as Record<string, unknown>) ?? body;
}

function pickThreadId(created: Record<string, unknown>): string {
  // `POST /api/threads` → `{ id }`; `POST /api/briefs/.../threads` → `{ threadId }`;
  // `POST /api/briefs` (create-mode) → `{ briefPath, initialThreadId }`.
  const id = created.threadId ?? created.id ?? created.initialThreadId;
  if (typeof id !== 'string' || !id) {
    throw new AgentError('AGENT_ERROR', 'create-thread response had no thread id');
  }
  return id;
}

function createHashHex(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}
