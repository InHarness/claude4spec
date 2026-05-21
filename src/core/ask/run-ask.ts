import fs from 'node:fs';
import path from 'node:path';

/**
 * `runAsk(...)` — single source of truth for the `c4s ask` flow.
 *
 * Wolany przez dwa transporty: CLI binarke (`src/bin/c4s/commands/ask.ts`)
 * i in-process MCP server (`src/server/mcp/c4s-tools.ts`). Cztery
 * deterministyczne kroki: resolve project → health-check tozsamosci serwera →
 * create-thread (context-specific) → run-turn.
 *
 *   await runAsk({ message: '...', contextType: 'chat' })
 *   await runAsk({ message: '...', server: 'http://other:4501', threadId: '...' })
 *   await runAsk({ message: '...', contextType: 'brief', briefPath: '...' })
 */

export type AskContextType = 'chat' | 'brief' | 'patch';

export interface AskParams {
  message: string;
  /** Local path do `.claude4spec/` peera; mutex z `server`. */
  project?: string;
  /** Override discovery URL serwera peera; gdy podany razem z `project` — `server` wygrywa. */
  server?: string;
  /** Default `'chat'`. Ignorowany gdy podano `threadId`. */
  contextType?: AskContextType;
  /** Kontynuacja istniejacego watku u peera; pomija create-thread. */
  threadId?: string;
  /** Wymagane dla `contextType='brief'` (gdy brak `threadId`). */
  briefPath?: string;
}

export interface AskResult {
  threadId: string;
  answer: string;
}

export type AskErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'SERVER_NOT_RUNNING'
  | 'SERVER_NOT_RECOGNIZED'
  | 'NOT_FOUND'
  | 'STREAM_IN_PROGRESS'
  | 'AGENT_UNAVAILABLE'
  | 'AGENT_ERROR'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'INVALID_ARGS';

export class AskError extends Error {
  constructor(public code: AskErrorCode, message: string, public hint?: string) {
    super(message);
    this.name = 'AskError';
  }
}

export async function runAsk(params: AskParams): Promise<AskResult> {
  const message = params.message;
  if (!message || !message.trim()) {
    throw new AskError('INVALID_ARGS', 'message is required');
  }

  // --- discovery: adres serwera -------------------------------------------
  // `server` wygrywa nad `project`; oba undefined → walk-up od cwd.
  let baseUrl: string;
  if (params.server) {
    baseUrl = params.server.replace(/\/+$/, '');
  } else {
    const projectDir = resolveProjectByConfig(params.project);
    baseUrl = `http://localhost:${readConfigPort(projectDir)}`;
  }

  // --- health-check tozsamosci --------------------------------------------
  await healthCheck(baseUrl);

  // --- create-thread (context-specific) — pomijany dla threadId ----------
  let threadId: string;
  if (params.threadId) {
    threadId = params.threadId;
  } else {
    const ct: AskContextType = params.contextType ?? 'chat';
    if (ct !== 'chat' && ct !== 'brief' && ct !== 'patch') {
      throw new AskError(
        'INVALID_ARGS',
        `contextType must be chat|brief|patch (got '${ct}')`,
      );
    }
    if (ct === 'patch') {
      // Watki patch nie maja route create-thread — tylko kontynuacja.
      throw new AskError(
        'INVALID_ARGS',
        'cannot create a patch thread via ask; pass threadId to continue one',
      );
    }
    if (ct === 'brief') {
      if (!params.briefPath) {
        throw new AskError('INVALID_ARGS', "contextType='brief' requires briefPath");
      }
      const encoded = params.briefPath.split('/').map(encodeURIComponent).join('/');
      const created = await postJson(`${baseUrl}/api/briefs/${encoded}/threads`, {});
      threadId = pickThreadId(created);
    } else {
      const created = await postJson(`${baseUrl}/api/threads`, {});
      threadId = pickThreadId(created);
    }
  }

  // --- run-turn (generyczny po context_type) ------------------------------
  const result = await postJson(`${baseUrl}/api/threads/${encodeURIComponent(threadId)}/ask`, {
    message,
  });
  const answer = typeof result.answer === 'string' ? result.answer : '';
  const outThreadId = typeof result.threadId === 'string' ? result.threadId : threadId;
  return { threadId: outThreadId, answer };
}

/** Walk-up do `.claude4spec/config.json`; `ask` nie czyta encji, wystarczy port. */
function resolveProjectByConfig(override?: string): string {
  const hasConfig = (dir: string) =>
    fs.existsSync(path.join(dir, '.claude4spec', 'config.json'));
  if (override) {
    const abs = path.resolve(process.cwd(), override);
    if (!hasConfig(abs)) {
      throw new AskError(
        'PROJECT_NOT_FOUND',
        `no claude4spec project at ${abs}`,
        'check the path or run `npx claude4spec` there first',
      );
    }
    return abs;
  }
  let dir = process.cwd();
  while (true) {
    if (hasConfig(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new AskError(
        'PROJECT_NOT_FOUND',
        'no claude4spec project found in current directory or any parent',
        'run `npx claude4spec` first or pass project path',
      );
    }
    dir = parent;
  }
}

function readConfigPort(projectDir: string): number {
  const file = path.join(projectDir, '.claude4spec', 'config.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new AskError('PROJECT_NOT_FOUND', `cannot read ${file}: ${(err as Error).message}`);
  }
  const port = (parsed as { port?: unknown }).port;
  if (typeof port !== 'number') {
    throw new AskError('PROJECT_NOT_FOUND', `config.json has no numeric "port" (${file})`);
  }
  return port;
}

/**
 * Health-check tozsamosci: `GET /api/config` musi zwrocic ksztalt configu
 * claude4spec. Trzy rozlaczne wyniki: connection refused → SERVER_NOT_RUNNING;
 * odpowiedz spoza configu → SERVER_NOT_RECOGNIZED; poprawny config → OK.
 */
async function healthCheck(baseUrl: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/config`);
  } catch {
    throw new AskError(
      'SERVER_NOT_RUNNING',
      `no claude4spec server responding at ${baseUrl}`,
      'start it with `npx claude4spec` in the project',
    );
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new AskError(
      'SERVER_NOT_RECOGNIZED',
      `process at ${baseUrl} responded but not with a claude4spec config`,
    );
  }
  if (!isConfigShape(body)) {
    throw new AskError(
      'SERVER_NOT_RECOGNIZED',
      `process at ${baseUrl} is not a claude4spec server (unexpected GET /api/config shape)`,
    );
  }
}

function isConfigShape(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const c = body as Record<string, unknown>;
  return (
    typeof c.name === 'string' &&
    typeof c.port === 'number' &&
    typeof c.pagesDir === 'string' &&
    typeof c.mode === 'string' &&
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
    throw new AskError('SERVER_NOT_RUNNING', `request to ${url} failed (connection refused)`);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* puste/nie-JSON body — obsluzone nizej przez !res.ok */
  }
  if (!res.ok) {
    const err = (body.error ?? {}) as { code?: string; message?: string; hint?: string };
    throw new AskError(
      (err.code as AskErrorCode) ?? 'AGENT_ERROR',
      err.message ?? `request to ${url} failed with HTTP ${res.status}`,
      err.hint,
    );
  }
  return (body.data as Record<string, unknown>) ?? body;
}

function pickThreadId(created: Record<string, unknown>): string {
  // `POST /api/threads` → `{ id }`; `POST /api/briefs/.../threads` → `{ threadId }`.
  const id = created.threadId ?? created.id;
  if (typeof id !== 'string' || !id) {
    throw new AskError('AGENT_ERROR', 'create-thread response had no thread id');
  }
  return id;
}
