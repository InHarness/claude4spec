import { Agent } from 'undici';
import { ASK_TURN_TIMEOUT_MS } from '../../shared/agent-turn.js';
import {
  AgentError,
  encodeArtifactPath,
  healthCheck,
  patchJson,
  postJson,
  resolveServer,
} from './http.js';

/**
 * 0.2.13 — address resolution, the health-check and the JSON verbs moved to
 * `./http.ts`. They are no longer agent-specific: every `server-delegating`
 * command uses them. Re-exported here so the two transports that import them
 * from this module (`src/bin/c4s/commands/agent.ts`, `src/server/mcp/c4s-tools.ts`)
 * keep working, and so `AgentError` stays one class rather than two.
 */
export {
  AgentError,
  encodeArtifactPath,
  healthCheck,
  patchJson,
  postJson,
  resolveServer,
} from './http.js';
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
 *   await runAgent({ message: '...', contextType: 'brief', briefPath: '...' })   // attach-mode
 *   await runAgent({ message: '...', contextType: 'brief' })                     // create-mode
 *
 * Dla `contextType='brief'` tryb rozstrzyga `briefPath`: podany → attach, brak
 * → create. Plik briefu powstaje w kroku 3, PRZED tura: `runAgent` nie startuje
 * tury na nieistniejacym artefakcie i zaden tool wewnatrz tury go nie zaklada.
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
  /**
   * Attach-mode dla `contextType='brief'` — otwiera watek na istniejacym
   * briefie; jego OBECNOSC rozstrzyga tryb (podany → attach, brak → create).
   */
  briefPath?: string;

  /**
   * Create-payload — wylacznie dla `contextType='brief'`. W CALOSCI opcjonalny,
   * symetrycznie do `effort`: trybu nie wlacza zadne z tych pol, tylko BRAK
   * `briefPath`. `runAgent({ message, contextType: 'brief' })` bez niczego
   * wiecej jest poprawnym wywolaniem — brief wobec stanu biezacego.
   *
   * Selektora proweniencji nie ma: proweniencja to ksztalt okna, ktory te dwa
   * konce opisuja same — patrz tabela w {@link buildBriefCreateBody}.
   */

  /** Poczatek okna. Pominiete → serwer rozwija do ostatniego release'u. */
  fromReleaseName?: string;
  /** Koniec okna. Pominiete → okno otwarte do stanu biezacego (`to = null`). */
  toReleaseName?: string;
  /** Zakres briefu (releasable root ids). Zabroniony przy otwartym `to`. */
  roots?: string[];
  suffix?: string;
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

  // --- walidacja argumentow — PRZED discovery -----------------------------
  // Blad argumentow musi wrocic jako blad argumentow. Gdy ta walidacja stala za
  // `resolveServer`, `--ct brief --brief <p> --from <r>` konczyl sie
  // `SERVER_NOT_RUNNING` przy zgaszonym serwerze — diagnoza nie tego problemu.
  // Cala ta czesc jest offline, wiec idzie przed odkryciem serwera.
  const ct: AgentContextType = params.contextType ?? 'chat';
  /** Cialo `POST /api/briefs` policzone z gory — tu zyje walidacja okna. */
  let briefCreateBody: Record<string, unknown> | undefined;
  let briefAttach = false;
  if (!params.threadId) {
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
      // Predykat trybu ma JEDEN warunek: `briefPath` podany → attach, brak →
      // create. Zadne pole create-payloadu nie jest wymagane, wiec nie ma
      // mutexu do pilnowania — `briefPath` razem z flaga okna to po prostu
      // sprzecznosc argumentow. Walidacja mieszka TUTAJ, nie w CLI: `runAgent`
      // jest wspolna biblioteka obu transportow.
      if (params.briefPath) {
        const windowFlags = briefWindowFlagsPresent(params);
        if (windowFlags.length > 0) {
          throw new AgentError(
            'INVALID_ARGS',
            `briefPath (attach) does not go with the window arguments (${windowFlags.join('/')})`,
          );
        }
        briefAttach = true;
      } else {
        briefCreateBody = buildBriefCreateBody(params);
      }
    }
  }

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
  } else if (briefCreateBody) {
    // Create-mode: mint a new brief (file + initial thread) in one call.
    const created = await postJson(`${apiBase}/briefs`, briefCreateBody);
    threadId = pickCreatedBriefThreadId(created);
    mintedBriefPath = typeof created.path === 'string' ? created.path : undefined;
  } else if (briefAttach) {
    // M36: watki briefu zyja w generycznej rodzinie artefaktow. `encodeArtifactPath`
    // zamiast recznego split/encode — samo `encodeURIComponent` przepuszcza `..`,
    // ktore URL resolution sklada zanim request opusci proces (patrz http.ts).
    const encoded = encodeArtifactPath(params.briefPath as string);
    const created = await postJson(`${apiBase}/artifacts/brief/${encoded}/threads`, {});
    threadId = pickThreadId(created);
  } else {
    // 'chat' + 'ask' share the generic create-thread route; the server
    // validates `context_type` (only 'chat'/'ask' accepted on this path).
    const created = await postJson(`${apiBase}/threads`, { context_type: ct });
    threadId = pickThreadId(created);
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
  // `POST /api/threads` → `{ id }`; `POST /api/artifacts/brief/.../threads` → `{ threadId }`.
  const id = created.threadId ?? created.id;
  if (typeof id !== 'string' || !id) {
    throw new AgentError('AGENT_ERROR', 'create-thread response had no thread id');
  }
  return id;
}

/**
 * `POST /api/briefs` odpowiada pelnym `BriefResponse`; watek zalozony razem z
 * plikiem jest top-level (`parent_thread_id IS NULL`), wiec siedzi w `threads[0]`.
 * Banki transagenta maja rodzica i do `threads[]` nie wchodza — dlatego akurat
 * ta droga `threads[0].id` jest kontraktem, a `run_transagent` nie.
 */
function pickCreatedBriefThreadId(created: Record<string, unknown>): string {
  const threads = created.threads;
  const first = Array.isArray(threads) ? (threads[0] as { id?: unknown } | undefined) : undefined;
  const id = first?.id;
  if (typeof id !== 'string' || !id) {
    throw new AgentError(
      'AGENT_ERROR',
      'POST /api/briefs response carried no initial thread (threads[0].id)',
    );
  }
  return id;
}

/** Ktore argumenty okna podal wolajacy — nazwy do komunikatu bledu attach/create. */
function briefWindowFlagsPresent(params: AgentParams): string[] {
  const present: string[] = [];
  if (params.fromReleaseName !== undefined) present.push('fromReleaseName');
  if (params.toReleaseName !== undefined) present.push('toReleaseName');
  if (params.roots !== undefined) present.push('roots');
  if (params.suffix !== undefined) present.push('suffix');
  return present;
}

/**
 * Create-payload → cialo `POST /api/briefs`. Dyskryminatorem jest `to`:
 *
 * | wywolanie          | okno                       | body                                            |
 * |--------------------|----------------------------|-------------------------------------------------|
 * | `from` + `to`      | domkniete                  | `{from, to}`                                     |
 * | samo `to`          | otwarte od poczatku        | `{from: null, to}`                               |
 * | samo `from`        | otwarte do stanu biezacego | `{from, to: null}`                               |
 * | brak obu           | otwarte do stanu biezacego | `{to: null}` — `from` rozwija serwer do latest   |
 *
 * Zadnego mapowania etykiet tu nie ma, bo etykiet nie ma: kazdy z tych czterech
 * wierszy to ta sama para pol o innej nullowosci.
 */
function buildBriefCreateBody(params: AgentParams): Record<string, unknown> {
  const { fromReleaseName, toReleaseName, roots, suffix } = params;

  if (roots !== undefined && toReleaseName === undefined) {
    // Zawezanie przestrzeni stron nie ma sensu bez drugiego konca okna.
    throw new AgentError('INVALID_ARGS', 'roots requires toReleaseName (the window\'s `to` end)');
  }

  return {
    // `to` podane ⇒ `from` pominiete znaczy "od poczatku" (jawny null);
    // `to` pominiete ⇒ `from` pominiete zostawiamy serwerowi (→ latest).
    ...(fromReleaseName !== undefined
      ? { fromReleaseName }
      : toReleaseName !== undefined
        ? { fromReleaseName: null }
        : {}),
    toReleaseName: toReleaseName ?? null,
    ...(roots !== undefined ? { roots } : {}),
    ...(suffix !== undefined ? { suffix } : {}),
  };
}
