import fs from 'node:fs';
import path from 'node:path';
import type { ParsedArgs } from '../args.js';
import { optionalString } from '../args.js';
import { CliError, type CliErrorCode } from '../errors.js';
import { resolveProjectByConfig } from '../project.js';

/**
 * `c4s ask` — synchroniczny kanal Q&A z agentem specyfikacji (M11).
 *
 * Jedyna komenda `c4s` wymagajaca dzialajacego serwera `npx claude4spec`:
 * nie uruchamia agenta sama, tylko deleguje ture do `POST /api/threads/:id/ask`
 * i kolapsuje ja do `{ threadId, answer }`.
 *
 *   c4s ask "<msg>" --ct chat
 *   c4s ask "<msg>" --ct brief --brief <path>
 *   c4s ask "<msg>" --thread <id>
 */
export async function runAsk(args: ParsedArgs): Promise<void> {
  const message = args.positional[0];
  if (!message || !message.trim()) {
    throw new CliError('INVALID_ARGS', 'message is required: c4s ask "<msg>" --ct chat');
  }

  const threadFlag = optionalString(args, 'thread');
  const ct = optionalString(args, 'ct');
  const briefFlag = optionalString(args, 'brief');
  const serverOverride = optionalString(args, 'server');

  // --- discovery: adres serwera -------------------------------------------
  // `--server` nadpisuje resolve projektu + budowanie URL z config.json.
  let baseUrl: string;
  if (serverOverride) {
    baseUrl = serverOverride.replace(/\/+$/, '');
  } else {
    const projectDir = resolveProjectByConfig(args.project);
    baseUrl = `http://localhost:${readConfigPort(projectDir)}`;
  }

  // --- health-check tozsamosci --------------------------------------------
  await healthCheck(baseUrl);

  // --- create-thread (context-specific) — pomijany dla --thread -----------
  let threadId: string;
  if (threadFlag) {
    threadId = threadFlag;
  } else {
    if (ct !== 'chat' && ct !== 'brief' && ct !== 'patch') {
      throw new CliError(
        'INVALID_ARGS',
        '--ct must be chat|brief|patch (or pass --thread <id> to continue a thread)',
      );
    }
    if (ct === 'patch') {
      // Watki patch nie maja CLI route create-thread — tylko kontynuacja.
      throw new CliError(
        'INVALID_ARGS',
        'c4s ask cannot create a patch thread; pass --thread <id> to continue one',
      );
    }
    if (ct === 'brief') {
      if (!briefFlag) {
        throw new CliError('INVALID_ARGS', '--ct brief requires --brief <path>');
      }
      const encoded = briefFlag.split('/').map(encodeURIComponent).join('/');
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

  // --- output --------------------------------------------------------------
  if (args.format === 'text') {
    process.stdout.write(answer + '\n');
    // threadId na stderr — hint do kontynuacji wątku.
    process.stderr.write(`thread: ${outThreadId} (continue: c4s ask "..." --thread ${outThreadId})\n`);
  } else {
    process.stdout.write(JSON.stringify({ threadId: outThreadId, answer }, null, 2) + '\n');
  }
}

/** Czyta `.claude4spec/config.json` i zwraca `port`. */
function readConfigPort(projectDir: string): number {
  const file = path.join(projectDir, '.claude4spec', 'config.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new CliError('PROJECT_NOT_FOUND', `cannot read ${file}: ${(err as Error).message}`);
  }
  const port = (parsed as { port?: unknown }).port;
  if (typeof port !== 'number') {
    throw new CliError('PROJECT_NOT_FOUND', `config.json has no numeric "port" (${file})`);
  }
  return port;
}

/**
 * Health-check tozsamosci: `GET /api/config` musi zwrocic kształt configu
 * claude4spec. Trzy rozlaczne wyniki: connection refused → SERVER_NOT_RUNNING;
 * odpowiedz spoza configu → SERVER_NOT_RECOGNIZED; poprawny config → OK.
 */
async function healthCheck(baseUrl: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/config`);
  } catch {
    throw new CliError(
      'SERVER_NOT_RUNNING',
      `no claude4spec server responding at ${baseUrl}`,
      'start it with `npx claude4spec` in the project',
    );
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new CliError(
      'SERVER_NOT_RECOGNIZED',
      `process at ${baseUrl} responded but not with a claude4spec config`,
    );
  }
  if (!isConfigShape(body)) {
    throw new CliError(
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
    throw new CliError('SERVER_NOT_RUNNING', `request to ${url} failed (connection refused)`);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* puste/nie-JSON body — obsluzone nizej przez !res.ok */
  }
  if (!res.ok) {
    const err = (body.error ?? {}) as { code?: string; message?: string };
    throw new CliError(
      (err.code as CliErrorCode) ?? 'AGENT_ERROR',
      err.message ?? `request to ${url} failed with HTTP ${res.status}`,
    );
  }
  // create-thread zwraca `{ data: {...} }`; run-turn zwraca obiekt wprost.
  return (body.data as Record<string, unknown>) ?? body;
}

function pickThreadId(created: Record<string, unknown>): string {
  // `POST /api/threads` → `{ id }`; `POST /api/briefs/.../threads` → `{ threadId }`.
  const id = created.threadId ?? created.id;
  if (typeof id !== 'string' || !id) {
    throw new CliError('AGENT_ERROR', 'create-thread response had no thread id');
  }
  return id;
}
