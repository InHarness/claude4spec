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
 *   await runAgent({ message: '...', contextType: 'brief', source: 'analysis' }) // create-mode
 *
 * Dla `contextType='brief'` attach i create wykluczaja sie wzajemnie — plik
 * briefu powstaje w kroku 3, PRZED tura: `runAgent` nie startuje tury na
 * nieistniejacym artefakcie i zaden tool wewnatrz tury go nie zaklada.
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
   * briefie. Mutex z create-payloadem ponizej (attach XOR create).
   */
  briefPath?: string;

  /**
   * Create-payload — wylacznie dla `contextType='brief'`, mutex z `briefPath`.
   *
   * Piec plaskich pol opcjonalnych, symetrycznie do juz istniejacego `effort`:
   * zaden nowy wzorzec w sygnaturze. Tryb create wyzwala obecnosc
   * KTOREJKOLWIEK z nich; `source` domyslne na `'release-diff'` dziala dopiero
   * WEWNATRZ trybu create i samo trybu nie wlacza.
   *
   * Dokladnie jedno z (`briefPath`, create-payload) jest wymagane gdy
   * `contextType='brief'` i brak `threadId` — inaczej `INVALID_ARGS`.
   */

  /**
   * Trzy wartosci po tej stronie; DTO `brief-create-request` zna tylko dwie.
   * Mapowanie 3→2 (`initial` → `release-diff` + `fromReleaseName: null`) robi
   * ta warstwa, w {@link buildBriefCreateBody} — patrz tabela tamze.
   */
  source?: 'release-diff' | 'initial' | 'analysis';
  /** Wymagane dla `source='release-diff'`; zabronione dla `'initial'`; opcjonalne dla `'analysis'`. */
  fromReleaseName?: string;
  /** Wymagane dla `source='release-diff'` i `'initial'`; zabronione dla `'analysis'`. */
  toReleaseName?: string;
  /** Zakres briefu (releasable root ids). Zabronione dla `source='analysis'`. */
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
  // `resolveServer`, `--ct brief --source initial` bez `--to` konczyl sie
  // `SERVER_NOT_RUNNING` przy zgaszonym serwerze — diagnoza nie tego problemu.
  // Cala ta czesc jest offline, wiec idzie przed odkryciem serwera.
  const ct: AgentContextType = params.contextType ?? 'chat';
  /** Cialo `POST /api/briefs` policzone z gory — tu zyje walidacja per-source. */
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
      // attach XOR create — dokladnie jedno z dwojga. Walidacja mutexu mieszka
      // TUTAJ, nie w CLI: `runAgent` jest wspolna biblioteka obu transportow,
      // wiec duplikat po stronie flag dawalby dwie odpowiedzi na jedno pytanie.
      const hasCreatePayload = hasBriefCreatePayload(params);
      if (params.briefPath && hasCreatePayload) {
        throw new AgentError(
          'INVALID_ARGS',
          "contextType='brief' accepts briefPath (attach) or the create-payload " +
            '(source/fromReleaseName/toReleaseName/roots/suffix), not both',
        );
      }
      if (hasCreatePayload) {
        briefCreateBody = buildBriefCreateBody(params);
      } else if (params.briefPath) {
        briefAttach = true;
      } else {
        throw new AgentError(
          'INVALID_ARGS',
          "contextType='brief' requires briefPath (attach) or the create-payload " +
            '(source/fromReleaseName/toReleaseName/roots/suffix)',
        );
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

/** Czy wolajacy podal KTORAKOLWIEK czesc create-payloadu. */
function hasBriefCreatePayload(params: AgentParams): boolean {
  return (
    params.source !== undefined ||
    params.fromReleaseName !== undefined ||
    params.toReleaseName !== undefined ||
    params.roots !== undefined ||
    params.suffix !== undefined
  );
}

/**
 * Create-payload → cialo `POST /api/briefs`, razem z mapowaniem 3-wartosciowego
 * `source` na 2-wartosciowe pole DTO. Tabela:
 *
 * | `source`       | body                                                                  |
 * |----------------|-----------------------------------------------------------------------|
 * | `release-diff` | `release-diff`, `from=<fromReleaseName>`, `to=<toReleaseName>` (oba wymagane) |
 * | `initial`      | `release-diff`, `from=null`, `to=<toReleaseName>` (`from` zabroniony)  |
 * | `analysis`     | `analysis`, `from=<fromReleaseName ?? latest>`, `to=null` (`roots` zabroniony) |
 *
 * `initial` NIE jest wartoscia pola `source` w DTO — to `release-diff`
 * z `fromReleaseName: null`.
 */
function buildBriefCreateBody(params: AgentParams): Record<string, unknown> {
  const source = params.source ?? 'release-diff';
  const { fromReleaseName, toReleaseName, roots, suffix } = params;

  if (source === 'release-diff') {
    if (!fromReleaseName || !toReleaseName) {
      throw new AgentError(
        'INVALID_ARGS',
        "source 'release-diff' requires both fromReleaseName and toReleaseName",
      );
    }
    return { source, fromReleaseName, toReleaseName, roots, suffix };
  }

  if (source === 'initial') {
    if (!toReleaseName) {
      throw new AgentError('INVALID_ARGS', "source 'initial' requires toReleaseName");
    }
    if (fromReleaseName !== undefined) {
      throw new AgentError(
        'INVALID_ARGS',
        "source 'initial' does not accept fromReleaseName (it is always null)",
      );
    }
    return { source: 'release-diff', fromReleaseName: null, toReleaseName, roots, suffix };
  }

  if (source === 'analysis') {
    if (toReleaseName !== undefined) {
      throw new AgentError(
        'INVALID_ARGS',
        "source 'analysis' does not accept toReleaseName (it is always null)",
      );
    }
    if (roots !== undefined) {
      throw new AgentError('INVALID_ARGS', "source 'analysis' does not accept roots");
    }
    // `fromReleaseName` opcjonalny — serwer domysla latest release w `createBrief`.
    return { source, fromReleaseName: fromReleaseName ?? null, toReleaseName: null, suffix };
  }

  throw new AgentError(
    'INVALID_ARGS',
    `source must be release-diff|initial|analysis (got '${String(source)}')`,
  );
}
