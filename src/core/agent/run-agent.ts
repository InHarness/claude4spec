import { Agent } from 'undici';
import { ASK_TURN_TIMEOUT_MS } from '../../shared/agent-turn.js';
import { AgentError, healthCheck, patchJson, postJson, resolveServer } from './http.js';

/**
 * 0.2.13 — address resolution, the health-check and the JSON verbs moved to
 * `./http.ts`. They are no longer agent-specific: every `server-delegating`
 * command uses them. Re-exported here so the two transports that import them
 * from this module (`src/bin/c4s/commands/agent.ts`, `src/server/mcp/c4s-tools.ts`)
 * keep working, and so `AgentError` stays one class rather than two.
 */
export { AgentError, healthCheck, patchJson, postJson, resolveServer } from './http.js';
export type { AgentErrorCode } from './http.js';

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

/**
 * Default model resolved here so every transport shares one source of truth.
 *
 * Exported rather than kept local, and that is the whole point of the constant:
 * the HTTP handlers behind `/api/chat` and `/api/threads/:id/ask` each used to
 * carry their OWN literal fallback (a retired mid-tier alias), which is how the repo ended
 * up answering a model-less call differently depending on which door it came
 * through. One literal, imported by the routes — the grep-proof property the
 * spec asks for, without a handler quietly inventing a second default.
 */
export const DEFAULT_MODEL = 'opus-5';

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
  /**
   * Model tury; claude-code: `fable-5` / `sonnet-5` / `opus-5` / `haiku-4.5`.
   * Domyslnie `'opus-5'` (rozwiazywany tutaj).
   */
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
  /** Populated only for `contextType='brief'` create-mode calls — the freshly minted brief's path. */
  briefPath?: string;
  /** Populated only when `output === 'full'`. */
  messages?: AgentMessage[];
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
  let mintedBriefPath: string | undefined;
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
        mintedBriefPath = typeof created.briefPath === 'string' ? created.briefPath : undefined;
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
  // Long peer turns are legitimate — this is the one postJson call that must
  // not be bounded by undici's default 300s headers/body timeout.
  const result = await postJson(
    `${apiBase}/threads/${encodeURIComponent(threadId)}/ask`,
    { message, model, effort },
    { dispatcher: runTurnDispatcher },
  );
  const answer = typeof result.answer === 'string' ? result.answer : '';
  const outThreadId = typeof result.threadId === 'string' ? result.threadId : threadId;
  const out: AgentResult = { threadId: outThreadId, answer };
  if (mintedBriefPath) {
    out.briefPath = mintedBriefPath;
  }
  if (output === 'full') {
    out.messages = Array.isArray(result.messages) ? (result.messages as AgentMessage[]) : [];
  }
  return out;
}

/**
 * Node's global `fetch` (undici) defaults to a 300s `headersTimeout`/`bodyTimeout`
 * — too short for the run-turn call (`POST /api/threads/:id/ask`), which blocks
 * for the entire duration of a peer's agent turn and can legitimately run for
 * many minutes. `AbortSignal.timeout()` can only *shorten* a request, not lift
 * undici's default cap, so a dedicated dispatcher is required for that one call.
 */
const runTurnDispatcher = new Agent({
  headersTimeout: ASK_TURN_TIMEOUT_MS,
  bodyTimeout: ASK_TURN_TIMEOUT_MS,
});

function pickThreadId(created: Record<string, unknown>): string {
  // `POST /api/threads` → `{ id }`; `POST /api/briefs/.../threads` → `{ threadId }`;
  // `POST /api/briefs` (create-mode) → `{ briefPath, initialThreadId }`.
  const id = created.threadId ?? created.id ?? created.initialThreadId;
  if (typeof id !== 'string' || !id) {
    throw new AgentError('AGENT_ERROR', 'create-thread response had no thread id');
  }
  return id;
}
