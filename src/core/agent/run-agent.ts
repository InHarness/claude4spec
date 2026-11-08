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
import { DEFAULT_MODEL } from './models.js';

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
 *   await runAgent({ message: '...', planPath: 'auth-refactor.md' })             // attach planu
 *   await runAgent({ message: '...', contextType: 'patch', patchPath: 'v1-to-v2-drift.md' }) // attach patcha
 *
 * Dla `contextType='brief'` tryb rozstrzyga `briefPath`: podany → attach, brak
 * → create. Plik briefu powstaje w kroku 3, PRZED tura: `runAgent` nie startuje
 * tury na nieistniejacym artefakcie i zaden tool wewnatrz tury go nie zaklada.
 */

export type AgentContextType = 'chat' | 'brief' | 'patch' | 'ask';

/**
 * Default model resolved here so every transport shares one source of truth.
 *
 * Defined in `./models.ts` next to the selectable list and re-exported, because the
 * HTTP handlers behind `/api/chat` and `/api/threads/:id/ask` import it from here: one
 * literal, imported by the routes — no handler quietly inventing a second default.
 */
export { DEFAULT_MODEL };

/** Default reasoning level resolved here — single source of truth, jak `DEFAULT_MODEL`. */
const DEFAULT_EFFORT = 'medium';

export interface AgentParams {
  message: string;
  /**
   * 2.1.0: `id` projektu z rejestru. Brak → walk-up z cwd (tylko powierzchnia
   * CLI; kanal `mcp` wymaga go zawsze). Wymagane, gdy podano `server`.
   */
  project?: string;
  /**
   * M31: workspace selector. On `cli` it disambiguates an id present in N
   * workspaces; on `mcp`/`internal` it is the workspace `project` is resolved in
   * (the caller passes its own when the tool input names none).
   */
  workspace?: string;
  /**
   * 2.1.53 — the channel the call arrived on. Default `'cli'`: the 0/1/N rule over
   * every workspace. `'mcp'`/`'internal'` resolve `project` in `workspace` only
   * and never raise PROJECT_NOT_FOUND / AMBIGUOUS_*.
   */
  channel?: 'cli' | 'mcp' | 'internal';
  /** Nadpisuje ADRES serwera peera (nie projekt); wymaga `project` (inaczej INVALID_ARGS). */
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
  planPath?: string; // attach planu (`--plan`): nowy watek chat na istniejacym planie;
                     // wyklucza threadId, briefPath i contextType inny niz 'chat';
                     // zamkniete dla narzedzia MCP c4s-tools.ask
  /**
   * 2.1.74 — attach patcha (`--patch`): nowy watek `patch` zakotwiczony w
   * istniejacym patchu. Sciezka wzgledna w korzeniu `patches` — ta sama, ktora
   * zwracaja `c4s create-patch` i `c4s list-patches`; przedrostek
   * `.claude4spec/patches/` jest zdejmowany. Wymaga `contextType='patch'`;
   * wyklucza `threadId`, `briefPath` i `planPath`.
   */
  patchPath?: string;

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
  /** Zakres briefu (`pages` root ids). Zabroniony przy otwartym `to`. */
  roots?: string[];
  suffix?: string;
  /**
   * Model tury — alias z listy wystawianej przez `GET /api/chat/config` peera
   * (kazdy projekt publikuje wlasna). Domyslnie `DEFAULT_MODEL` (rozwiazywany tutaj).
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
  /** Trasa dowiazania watku planu (bez `apiBase`), policzona z gory. */
  let planAttachPath: string | undefined;
  /** Trasa dowiazania watku patcha (bez `apiBase`), policzona z gory. */
  let patchAttachPath: string | undefined;
  if (params.patchPath !== undefined) {
    // Wykluczenia sprawdzane PRZED galezia planu i `threadId`, zeby kazda para
    // z `--patch` dostala ten sam komunikat niezaleznie od kolejnosci galezi.
    const others = [
      params.threadId ? 'threadId' : null,
      params.briefPath !== undefined ? 'briefPath' : null,
      params.planPath !== undefined ? 'planPath' : null,
    ].filter((x): x is string => x !== null);
    if (others.length > 0) {
      throw new AgentError(
        'INVALID_ARGS',
        `patchPath does not go with ${others.join('/')} (pass only one of patchPath, threadId, briefPath, planPath)`,
      );
    }
    if (params.contextType !== 'patch') {
      throw new AgentError(
        'INVALID_ARGS',
        `patchPath founds a patch thread; it requires contextType 'patch' (got '${params.contextType ?? 'chat'}')`,
      );
    }
    const windowFlags = briefWindowFlagsPresent(params);
    if (windowFlags.length > 0) {
      throw new AgentError(
        'INVALID_ARGS',
        `patchPath does not go with the brief window arguments (${windowFlags.join('/')})`,
      );
    }
    patchAttachPath = attachRoute('patch', params.patchPath);
  }
  if (params.planPath !== undefined) {
    // Tryb planu ZAWSZE zaklada nowy watek `chat` — kontynuacja, brief ani inny
    // kontekst nie maja z nim sensu. Sprawdzane przed galezia `threadId`, bo ta
    // po cichu wygrywa z reszta argumentow.
    if (params.threadId) {
      throw new AgentError('INVALID_ARGS', 'planPath does not go with threadId (a plan attach always creates a new thread)');
    }
    if (params.briefPath) {
      throw new AgentError('INVALID_ARGS', 'planPath does not go with briefPath');
    }
    if (params.contextType && params.contextType !== 'chat') {
      throw new AgentError(
        'INVALID_ARGS',
        `planPath creates a chat thread; contextType '${params.contextType}' does not go with it`,
      );
    }
    const windowFlags = briefWindowFlagsPresent(params);
    if (windowFlags.length > 0) {
      throw new AgentError(
        'INVALID_ARGS',
        `planPath does not go with the brief window arguments (${windowFlags.join('/')})`,
      );
    }
    planAttachPath = attachRoute('plan', params.planPath);
  }
  if (!params.threadId) {
    if (ct !== 'chat' && ct !== 'brief' && ct !== 'patch' && ct !== 'ask') {
      throw new AgentError(
        'INVALID_ARGS',
        `contextType must be chat|brief|patch|ask (got '${ct}')`,
      );
    }
    if (ct === 'patch' && patchAttachPath === undefined) {
      // 2.1.74: watek patcha zaklada sie wylacznie na istniejacym patchu.
      throw new AgentError(
        'INVALID_ARGS',
        'a patch thread is founded only on an existing patch: pass patchPath (or threadId to continue one)',
        'pass --patch <path>',
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
  const { baseUrl, apiBase, workspaceName } = await resolveServer({
    project: params.project,
    workspace: params.workspace,
    server: params.server,
    ...(params.channel ? { channel: params.channel } : {}),
  });
  await healthCheck(baseUrl, apiBase, workspaceName);

  // --- create-thread (context-specific) — pomijany dla threadId ----------
  let threadId: string;
  let mintedBriefPath: string | undefined;
  /** Rodzaj artefaktu, na ktorym ten przebieg zalozyl watek (`--plan`/`--patch`). */
  let attachedKind: 'plan' | 'patch' | undefined;
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
  } else if (planAttachPath !== undefined) {
    // Ta sama generyczna trasa dowiazania co brief; dla `kind=plan` serwer
    // zaklada watek `chat` (plan_mode = 0) z `plan_path`. Plan `applied: true`
    // nie jest odrzucany.
    threadId = await postAttach('plan', `${apiBase}${planAttachPath}`);
    attachedKind = 'plan';
  } else if (patchAttachPath !== undefined) {
    // Ta sama generyczna trasa dowiazania; dla `kind=patch` (binding anchor)
    // serwer zaklada NOWY watek `patch` z `patch_path`. Patch `applied: true`
    // nie jest odrzucany — trasa tego nie sprawdza i CLI tez nie.
    threadId = await postAttach('patch', `${apiBase}${patchAttachPath}`);
    attachedKind = 'patch';
  } else {
    // 'chat' + 'ask' share the generic create-thread route; the server
    // validates `context_type` (only 'chat'/'ask' accepted on this path).
    const created = await postJson(`${apiBase}/threads`, { context_type: ct });
    threadId = pickThreadId(created);
  }

  // --- run-turn (generyczny po context_type) ------------------------------
  // Long peer turns are legitimate — this is the one postJson call that must
  // not be bounded by undici's default 300s headers/body timeout.
  let result: Record<string, unknown>;
  try {
    result = await postJson(
      `${apiBase}/threads/${encodeURIComponent(threadId)}/ask`,
      { message, model, effort },
      { dispatcher: runTurnDispatcher },
    );
  } catch (err) {
    // Watek na planie/patchu juz istnieje — wznowienie to `--thread`, nie kolejne
    // `--plan`/`--patch` (to dolozyloby nastepny watek na artefakcie).
    if (attachedKind && err instanceof AgentError) {
      throw new AgentError(
        err.code,
        err.message,
        `the ${attachedKind} thread was created; resume it with: c4s agent "<msg>" --thread ${threadId}`,
        { threadId },
      );
    }
    throw err;
  }
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

/** The artifact kinds `c4s agent` attaches a new thread to by path. */
type AttachKind = 'plan' | 'patch';

/** Each kind's root prefix, stripped when given, and its not-found code. */
const ATTACH_KINDS: Record<AttachKind, { prefix: RegExp; notFound: string }> = {
  plan: { prefix: /^(\.\/)?\.claude4spec\/plans\//, notFound: 'PLAN_NOT_FOUND' },
  patch: { prefix: /^(\.\/)?\.claude4spec\/patches\//, notFound: 'PATCH_NOT_FOUND' },
};

/**
 * 2.1.74 — the attach route of a plan or patch thread, relative to the project's
 * API base: `/artifacts/<kind>/<path>/threads`. The path is relative to the
 * kind's root — exactly what the CLI's list/create commands print — and goes in
 * untransformed; only a leading `.claude4spec/plans/` (`.claude4spec/patches/`)
 * is stripped. An empty path is `INVALID_ARGS`, a traversing one too (via
 * `encodeArtifactPath`).
 */
function attachRoute(kind: AttachKind, artifactPath: string): string {
  const normalized = artifactPath.replace(ATTACH_KINDS[kind].prefix, '');
  if (!normalized.trim()) {
    throw new AgentError('INVALID_ARGS', `${kind}Path is required (got an empty value)`);
  }
  return `/artifacts/${kind}/${encodeArtifactPath(normalized)}/threads`;
}

/**
 * POSTs the attach route and answers the new thread's id. A 404 from the route
 * (the server says `PLAN_NOT_FOUND` / `PATCH_NOT_FOUND`) becomes `NOT_FOUND`,
 * the family's only code for an unknown address.
 */
async function postAttach(kind: AttachKind, url: string): Promise<string> {
  let created: Record<string, unknown>;
  try {
    created = await postJson(url, {});
  } catch (err) {
    if (err instanceof AgentError && (err.code === ATTACH_KINDS[kind].notFound || err.code === 'NOT_FOUND')) {
      throw new AgentError('NOT_FOUND', err.message, err.hint);
    }
    throw err;
  }
  return pickThreadId(created);
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
