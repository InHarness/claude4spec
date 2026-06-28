import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';
import {
  architectureCapabilities,
  createAdapter,
  observeStream,
  AdapterAbortError,
  AdapterInitError,
  AdapterTimeoutError,
  type RuntimeAdapter,
  type StreamObserver,
  type UsageStats,
  type UserInputHandler,
  type UserInputResponse,
  type McpServerConfig,
} from '@inharness-ai/agent-adapters';
import type { ChatService } from '../services/chat.js';
import type { AgentCredentialService } from '../services/agent-credential.js';
import type { PagesService } from '../services/pages.js';
import type { TagsService } from '../services/tags.js';
import type { SectionsService } from '../services/sections.js';
import { buildPlanToolsServer } from '../mcp/plan-tools.js';
import { buildBriefToolsServer } from '../mcp/brief-tools.js';
import { buildC4sToolsServer } from '../mcp/c4s-tools.js';
import {
  buildSystemPrompt,
  subagentsFor,
  CONTEXT_TYPE_REGISTRY,
  type PeerProject,
} from '../services/chat-context.js';
import { readConfig } from '../config.js';
import type { PlanService } from '../services/plan.js';
import type { BriefService } from '../services/brief.js';
import type { PatchService } from '../services/patch.js';
import type { ReleaseService } from '../services/release.js';
import { TransagentDispatcher } from '../services/transagent-dispatcher.js';
import { buildTransagentToolsServer, TRANSAGENT_TOOL_FULL_NAME } from '../mcp/transagent-tools.js';
import type { PageVersionService } from '../services/page-version.js';
import type { SkillResolver, SkillRegistry } from '../services/skill-registry.js';
import type { Annotation, Brief, ChatMessage, ChatThread, PatchResponse } from '../../shared/entities.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { Db } from '../db/index.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

/** Deps potrzebne do uruchomienia tury agenta. Wspolne dla `POST /api/chat`
 *  (SSE) i `POST /api/threads/:id/ask` (headless). */
export interface AgentTurnDeps {
  /** M31: per-project host — MCP factories + entity counts come from here. */
  pluginHost: ProjectPluginHost;
  /** M31: per-project adapter registry (was module-global) — keyed by threadId. */
  activeAdapters: Map<string, ActiveAdapter>;
  /** M31: per-project pending user-input registry (was module-global). */
  pendingInputs: Map<string, PendingInput>;
  /**
   * M31: pinged in the turn's `finally` — the context cache uses it to retry
   * disposing retired/evicted contexts once they go idle.
   */
  onTurnFinished?: () => void;
  chatService: ChatService;
  /** M05 0.1.62: user's own ANTHROPIC API key, injected per-turn into custom_env. */
  agentCredentialService: AgentCredentialService;
  pagesService: PagesService;
  tagsService: TagsService;
  sectionsService: SectionsService;
  planService: PlanService;
  briefService: BriefService;
  patchService: PatchService;
  /** 0.1.69 Transagents: dispatcher resolves "latest release" for analysis briefs. */
  releaseService: ReleaseService;
  pageVersions: PageVersionService;
  skillResolver: SkillResolver;
  skillRegistry: SkillRegistry;
  ws: WsEmitter;
  cwd: string;
  pagesDir: string;
  mode: 'dev' | 'prod';
  db: Db;
  /**
   * 0.1.58: workspace name (registry identity) — the `workspace="…"` attr on the
   * `<workspace_projects>` prompt block.
   */
  workspaceName?: string;
  /**
   * 0.1.58: workspace peers (current project excluded) for the
   * `<workspace_projects>` discovery block. Lazily read from each peer's
   * `config.json` per turn so peer-config edits surface on the next thread's
   * first turn. Absent ⇒ no peers (e.g. single-project workspace).
   */
  listWorkspacePeers?: () => PeerProject[];
}

/** M21 m05ctxreg: tools whitelist per context_type. Brief threads get only
 *  brief-tools (per-thread, mounted below) + release-tools (read-only).
 *  All other plugin servers (endpoint-tools, dto-tools, ui-view-tools,
 *  database-table-tools, plan-tools, reference-tools) are NOT mounted. */
const BRIEF_ALLOWED_PLUGIN_MCP = new Set(['release-tools']);

export const ALLOWED_MODELS = ['fable-5', 'sonnet-4.6', 'opus-4.8', 'haiku-4.5'] as const;
export type Model = (typeof ALLOWED_MODELS)[number];

export interface PendingInput {
  resolve: (response: UserInputResponse) => void;
  reject: (reason: unknown) => void;
  requestIdsForRequest: string;
}

/** Bufor odtworzeniowy bieżącej tury — pozwala klientowi wznawiającemu (F5 /
 *  switch wątku) odtworzyć turę przez `useEventStream.joinStream`: serwer wysyła
 *  `turn_start`, replay `events` (w kolejności), a potem leci na żywo z emittera.
 *  Reducer `@inharness-ai/agent-chat` po `turn_start` re-aktywuje wiadomość
 *  asystenta i renderuje delty płynnie. `events` koalescuje kolejne `text_delta`
 *  z tej samej ramki, więc nie rośnie liniowo z liczbą tokenów. */
export interface TurnReplay {
  turnStart: TurnEvent;
  events: TurnEvent[];
}

export interface ActiveAdapter {
  requestId: string;
  adapter: RuntimeAdapter;
  emitter: EventEmitter;
  replay: TurnReplay;
  /**
   * 0.1.69 Transagents: parent thread id of a child banka turn (NULL/undefined
   * for top-level turns). The abort cascade in routes/chat.ts uses this to find
   * and abort children when their parent is consciously aborted.
   */
  parentThreadId?: string | null;
  /**
   * M05 queue: fan-out for events originating OUTSIDE the turn's stream loop
   * (queue mutations from `POST/DELETE /api/chat/queue/...`). Reaches the
   * original POST client (via the turn's `onEvent`) AND live-join clients (via
   * the emitter) — the same closure the turn uses for its own events.
   */
  emit: (event: TurnEvent) => void;
}

// M31: rejestry przeniesione z module-scope do ProjectContext (agentDeps) —
// keyed by threadId, jeden aktywny adapter per watek. `POST /chat` i
// `POST /threads/:id/ask` dostaja te same instancje przez wspolne agentDeps:
// drugi POST/ask na ten sam watek dostaje 409, a GET /chat/stream/:threadId
// dolacza do zywego streamu niezaleznie od tego, ktory endpoint go uruchomil.
export function cancelPendingForRequest(
  pendingInputs: Map<string, PendingInput>,
  requestId: string,
): void {
  for (const [inputId, pending] of pendingInputs) {
    if (pending.requestIdsForRequest === requestId) {
      pending.reject(new Error('stream aborted'));
      pendingInputs.delete(inputId);
    }
  }
}

/** Typed blad tury — pozwala konsumentom (headless `ask`) zmapowac powod
 *  zakonczenia na status HTTP. Te same kody co SSE `event: error`. */
export class AgentTurnError extends Error {
  constructor(
    public code: 'ABORTED' | 'TIMEOUT' | 'AGENT_UNAVAILABLE' | 'AGENT_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'AgentTurnError';
  }
}

type TurnEvent = { type: string } & Record<string, unknown>;

export interface AgentTurnInput {
  /** Watek juz rozwiazany przez callera (+ planMode zaaplikowany). */
  thread: ChatThread;
  prompt: string;
  annotations?: Annotation[];
  model: Model;
  currentPage?: string | null;
  architectureConfig: Record<string, unknown>;
  requestId: string;
  consoleObserver: StreamObserver | null;
  /** Transport callera — SSE forwarder dla `POST /api/chat`, no-op dla `ask`. */
  onEvent: (event: TurnEvent) => void;
  /** Interaktywny kanal user-input. Brak = headless (np. `ask`). */
  onUserInput?: UserInputHandler;
}

export interface AgentTurnResult {
  threadId: string;
  answer: string;
  /**
   * 0.1.79: every chat_message persisted during THIS turn (user + assistant +
   * reasoning + tool rows), in id order. Sliced from `chat_message`, returned in
   * one batch after the turn. Feeds `runAgent({ output: 'full' })` / `c4s agent`;
   * `output: 'final'` callers ignore it.
   */
  messages: ChatMessage[];
}

/**
 * Uruchamia jedna ture agenta dla istniejacego watku: wstawia wiadomosc user,
 * buduje runtime przez rejestr `context_type`, wykonuje `adapter.execute(...)`,
 * persystuje eventy mapperem `UnifiedEvent → chat_message`. Caller wybiera
 * transport przez `onEvent` (SSE vs collapse). Zwraca `{ threadId, answer }`,
 * gdzie `answer` to skolapsowany tekst assistant tej tury.
 *
 * Pre-flight `activeAdapters.has` (→ 409) NALEZY do callera; ta funkcja
 * rejestruje adapter w `activeAdapters` i zwalnia go w `finally`.
 */
export async function runAgentTurn(
  deps: AgentTurnDeps,
  input: AgentTurnInput,
): Promise<AgentTurnResult> {
  const { thread, prompt, requestId } = input;
  const annotations = input.annotations ?? [];
  const currentPage = input.currentPage ?? null;
  // 0.1.79: snapshot the highest message id BEFORE this turn inserts anything, so
  // we can slice exactly this turn's messages at the end (for `output: 'full'`).
  const turnStartMessageId = deps.chatService.latestMessageId(thread.id);
  // M05 m05ctxreg: the context-type registry is the single source of truth for this
  // thread's five dispatch dimensions (skill / MCP set / chrome / subagent / posture).
  const ctx = CONTEXT_TYPE_REGISTRY[thread.contextType];
  // Builtin posture (dim 5): `force-plan` pins read-only plan-mode EVERY turn regardless
  // of the thread's stored plan_mode flag (→ READONLY_BUILTINS + disallowedTools =
  // MUTATING_BUILTINS). One site, so it covers both POST /api/threads/:id/ask and
  // POST /api/chat. (Today only `ask` forces; the rest follow the thread flag.)
  const planMode = ctx.builtinPosture === 'force-plan' ? true : thread.planMode;

  const adapter = createAdapter('claude-code');
  const emitter = new EventEmitter();
  // `turn_start` jest syntetyzowany serwerowo wyłącznie dla wznawiających klientów
  // (`joinStream` → reducer re-aktywuje wiadomość asystenta). NIE jest wysyłany do
  // oryginalnego klienta POST — ten ma już aktywną wiadomość z `sendUserMessage`.
  const turnStart: TurnEvent = {
    type: 'turn_start',
    userMessageId: nanoid(12),
    assistantMessageId: nanoid(12),
    prompt,
    timestamp: new Date().toISOString(),
  };
  const replay: TurnReplay = { turnStart, events: [] };

  // Zdarzenia istotne dla reducera (replay buduje stan bieżącej tury u joinera).
  const REPLAY_EVENT_TYPES = new Set([
    'text_delta',
    'thinking',
    'tool_use',
    'tool_result',
    'subagent_started',
    'subagent_progress',
    'subagent_completed',
    'todo_list_updated',
    'user_input_request',
    // 0.1.69 Transagents: bracket markers so reload/joiners reconstruct the
    // nested child panel.
    'transagent_started',
    'transagent_completed',
    'result',
    'error',
  ]);
  const bufferForReplay = (event: TurnEvent) => {
    if (!REPLAY_EVENT_TYPES.has(event.type)) return;
    // Koalescuj kolejne `text_delta` z tej samej ramki (main vs subagent) — replay
    // jednym deltą daje identyczny wynik w reducerze, a bufor nie rośnie z tokenami.
    if (event.type === 'text_delta') {
      const last = replay.events[replay.events.length - 1];
      if (
        last &&
        last.type === 'text_delta' &&
        Boolean(last.isSubagent) === Boolean(event.isSubagent) &&
        last.subagentTaskId === event.subagentTaskId
      ) {
        last.text = String(last.text ?? '') + String(event.text ?? '');
        return;
      }
      // Kopia — kolejne koalescje mutują bufor, nie obiekt już wysłany na żywo.
      replay.events.push({ ...event });
      return;
    }
    replay.events.push(event);
  };

  // `onEvent` to transport callera; `emitter` zasila GET /api/chat/stream/:threadId.
  const emit = (event: TurnEvent) => {
    input.onEvent(event);
    emitter.emit('event', event);
    bufferForReplay(event);
  };
  // Rejestracja PO zdefiniowaniu `emit` — kolejka (out-of-band `POST/DELETE
  // /api/chat/queue/...`) używa go do broadcastu `queue_updated`/`queue_cleared`.
  deps.activeAdapters.set(thread.id, {
    requestId,
    adapter,
    emitter,
    replay,
    emit,
    // 0.1.69 Transagents: lets the abort cascade find this turn's children (when
    // this turn IS a child, parentThreadId is set from the row).
    parentThreadId: thread.parentThreadId,
  });
  emit({ type: 'connected', requestId, threadId: thread.id });

  // 0.1.69 Transagents: race-free correlation between the SDK's
  // `tool_use(runTransagent)` id and the dispatcher. The loop pushes the id when
  // it observes the tool_use event; the dispatcher (invoked from the MCP handler)
  // takes it. Queue + waiter handles either interleaving.
  const transagentToolUseQueue: string[] = [];
  const transagentWaiters: Array<(id: string) => void> = [];
  const pushTransagentToolUse = (id: string) => {
    const waiter = transagentWaiters.shift();
    if (waiter) waiter(id);
    else transagentToolUseQueue.push(id);
  };
  const takeTransagentToolUse = (): Promise<string> => {
    const queued = transagentToolUseQueue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise<string>((resolve) => transagentWaiters.push(resolve));
  };

  let assistantBuf = '';
  let thinkingBuf = '';
  // 0.1.58: `answer` = treść OSTATNIEJ wiadomości assistant tury (finalne
  // podsumowanie po terminalnym evencie `result`), NIE konkatenacja wszystkich
  // bloków. `flushMainBuf` nadpisuje to każdym wypchniętym main-assistant
  // blokiem; po `result` zostaje wyłącznie końcowy. Pośrednie wpisy nadal lądują
  // w `chat_message` (źródło prawdy, dostępne przez GET /api/threads/:id).
  let lastAssistantText = '';
  const subagentBuffers = new Map<string, { text: string; thinking: string }>();
  let lastMainAssistantRowId: number | null = null;
  let lastToolResultRowId: number | null = null;
  let lastTurnUsage: UsageStats | null = null;

  const getSubBuf = (taskId: string) => {
    let buf = subagentBuffers.get(taskId);
    if (!buf) {
      buf = { text: '', thinking: '' };
      subagentBuffers.set(taskId, buf);
    }
    return buf;
  };
  const flushSubBuf = (taskId: string) => {
    const buf = subagentBuffers.get(taskId);
    if (!buf) return;
    if (buf.text) {
      deps.chatService.addMessage(
        thread.id,
        'assistant',
        JSON.stringify({ text: buf.text }),
        null,
        null,
        taskId,
      );
      buf.text = '';
    }
    if (buf.thinking) {
      deps.chatService.addMessage(
        thread.id,
        'assistant',
        JSON.stringify({ text: buf.thinking, thinking: true }),
        null,
        null,
        taskId,
      );
      buf.thinking = '';
    }
  };
  const flushMainBuf = () => {
    if (assistantBuf) {
      const row = deps.chatService.addMessage(
        thread.id,
        'assistant',
        JSON.stringify({ text: assistantBuf }),
      );
      lastMainAssistantRowId = row.id;
      // 0.1.58: capture the last persisted main-assistant block; the final
      // flush (on `result`) leaves the turn's closing summary here.
      lastAssistantText = assistantBuf;
      assistantBuf = '';
    }
    if (thinkingBuf) {
      deps.chatService.addMessage(
        thread.id,
        'assistant',
        JSON.stringify({ text: thinkingBuf, thinking: true }),
      );
      thinkingBuf = '';
    }
  };

  try {
    deps.chatService.addMessage(
      thread.id,
      'user',
      JSON.stringify({ text: prompt, annotations }),
      null,
      null,
      null,
      planMode,
    );
    if (!thread.title) {
      const title = prompt.slice(0, 60) + (prompt.length > 60 ? '...' : '');
      deps.chatService.updateTitle(thread.id, title || '(annotations only)');
    }

    // M05 m05ctxreg: the brief frame (uiChrome='brief-detail') is the only one with a
    // narrow toolset + reduced prompt — it skips entity counters, plan tools, pages, and
    // the current-page block. Every brief-frame cheap-skip below reads this one flag.
    const isBriefFrame = ctx.uiChrome === 'brief-detail';

    // M21: dla brief context czytamy aktualny snapshot brief'u (frontmatter+body+hash)
    // i wkladamy do system promptu. Skip kosztownych obliczen pageCount/entityCounts.
    // Gated on the registry's brief-tools dimension (brief is the only briefTools row).
    let briefSnapshot: Brief | null = null;
    if (ctx.mcp.briefTools && thread.briefPath) {
      try {
        briefSnapshot = await deps.briefService.getBrief(thread.briefPath);
      } catch (err) {
        console.warn(`[chat] brief read failed for ${thread.briefPath}:`, (err as Error).message);
      }
    }

    // M23: patch threads keep the FULL spec-editing toolset — their job is to edit the
    // spec; only the system prompt differs (the patch snapshot is injected). `patch_path`
    // is set iff context_type='patch' (chat.ts invariant), so its presence IS the gate.
    let patchSnapshot: PatchResponse | null = null;
    if (thread.patchPath) {
      try {
        patchSnapshot = await deps.patchService.getPatch(thread.patchPath);
      } catch (err) {
        console.warn(`[chat] patch read failed for ${thread.patchPath}:`, (err as Error).message);
      }
    }

    let currentPageBody: string | null = null;
    if (!isBriefFrame && currentPage) {
      try {
        const page = await deps.pagesService.read(currentPage);
        currentPageBody = page.body;
      } catch {
        currentPageBody = null;
      }
    }

    // Stale-plan reminder MUSI byc sprawdzony PRZED markPlanSeenByThread —
    // ten ostatni bumpuje last_seen_plan_version i zapodaje sygnal "synced".
    const isFirstTurn = !thread.hasSystemPrompt;
    const stalePlanReminder = isBriefFrame ? null : deps.planService.getStalePlanReminder(thread.id);
    const currentPlan = isBriefFrame ? null : deps.planService.getByThread(thread.id);

    // Skill resolution: writing-style (config.writingStyle, M15) ladowany
    // niezaleznie od kontekstu. Dla brief context dokladamy bundled `brief-author`.
    const writingStyleSkills = deps.skillResolver.resolve();
    const writingStyle = writingStyleSkills[0]
      ? {
          slug: writingStyleSkills[0].name,
          title: String(writingStyleSkills[0].metadata?.title ?? writingStyleSkills[0].name),
        }
      : null;
    // M05 m05ctxreg dim 1: the registry's bundled skill (beyond config.writingStyle).
    // Only the brief row carries `brief-author`; chat/patch/ask carry null.
    const inlineSkills = [...writingStyleSkills];
    if (ctx.bundledSkill === 'brief-author' && deps.skillRegistry.has('brief-author')) {
      const skill = deps.skillRegistry.resolve('brief-author');
      inlineSkills.push({
        name: skill.metadata.slug,
        description: skill.metadata.description,
        content: skill.content,
        files: skill.files,
        metadata: {
          version: skill.metadata.version,
          language: skill.metadata.language,
          title: skill.metadata.title,
        },
      });
    }

    const pageCount = isBriefFrame ? 0 : countPages(await deps.pagesService.listTree());
    // 0.1.51: language directives travel the same path as writingStyle — read from
    // config per-turn here, NOT via architectureConfig. Effective only from the first
    // turn of a new thread (the prompt is persisted once by setInitialSystemPrompt).
    const cfg = readConfig(deps.cwd);
    const systemPrompt = buildSystemPrompt({
      host: deps.pluginHost,
      projectName: cfg.name,
      cwd: deps.cwd,
      pagesDir: deps.pagesDir,
      currentPagePath: currentPage,
      currentPageBody,
      pageCount,
      entityCounts: isBriefFrame ? {} : deps.pluginHost.computeEntityCounts(deps.db.handle),
      tagCount: isBriefFrame ? 0 : deps.tagsService.list().length,
      sectionCount: isBriefFrame ? 0 : deps.sectionsService.count(),
      annotations,
      planMode,
      currentPlan,
      // M05 m05ctxreg dim 2: prompt-side tooling flags mirror the registry's MCP set
      // (the <tooling>/usage blocks must match what is actually mounted below).
      planToolsAvailable: ctx.mcp.planTools,
      // c4s-tools excluded for brief (narrow toolset) and `ask` (recursion guard) — the
      // registry encodes this; dropping it also drops the <c4s_tools_usage> +
      // peer-discovery prompt blocks.
      c4sToolsAvailable: ctx.mcp.c4sTools,
      // 0.1.58: peer-discovery block. Gated on the same c4s-tools dimension; skip the
      // disk reads when c4s-tools is absent (the block would be gated out anyway).
      workspaceProjects: ctx.mcp.c4sTools ? (deps.listWorkspacePeers?.() ?? []) : [],
      workspaceName: deps.workspaceName,
      writingStyle,
      specLanguage: cfg.language ?? undefined,
      conversationalLanguage: cfg.agent?.conversationalLanguage ?? undefined,
      contextType: thread.contextType,
      brief: briefSnapshot,
      patch: patchSnapshot,
    });

    // claude-code CLI po resumeSessionId ignoruje kolejne systemPrompty —
    // wiążący dla audytu jest tylko pierwszy. UPDATE idempotentny (no-op na 2.+ turze).
    deps.chatService.setInitialSystemPrompt(thread.id, systemPrompt);

    // M05 session-lock: snapshot { model, architectureConfig } pierwszej tury — punkt
    // odniesienia dla guarda RESUME_CONFIG_LOCKED w routes. Idempotentny (no-op na 2.+ turze).
    // 0.1.62: `custom_env` jest wyłączane ze snapshotu — niesie odszyfrowany ANTHROPIC_API_KEY,
    // który nie może trafić do plaintextowego `db.sqlite` (to obeszłoby szyfrowanie at-rest);
    // nie jest też polem RESUME_CONFIG_LOCKED, więc snapshot go nie potrzebuje.
    const { custom_env: _customEnv, ...snapshotArchitectureConfig } = input.architectureConfig;
    deps.chatService.setInitialArchitectureConfig(thread.id, {
      model: input.model,
      architectureConfig: snapshotArchitectureConfig,
    });

    if (isFirstTurn && currentPlan) {
      deps.planService.markPlanSeenByThread(thread.id);
    }

    // M05 m05ctxreg dim 2: per-thread MCP servers are dispatched from the registry's
    // `mcp` descriptor — each server mounts iff its registry flag is set.
    const planTools = ctx.mcp.planTools
      ? buildPlanToolsServer({
          threadId: thread.id,
          planService: deps.planService,
        })
      : null;
    const briefTools = ctx.mcp.briefTools && thread.briefPath
      ? buildBriefToolsServer({
          threadId: thread.id,
          briefPath: thread.briefPath,
          briefService: deps.briefService,
        })
      : null;
    // M24 c4s-tools: cross-cutting MCP exposing the peer-consult flow. Fresh factory
    // per request; closes over `deps.workspaceName` so `ask` defaults to the caller's
    // workspace (fixes AMBIGUOUS_WORKSPACE when the project lives in N>1 workspaces).
    // Registry-gated: chat + patch only (brief is intentionally narrow; `ask` is
    // excluded — a consulted peer cannot consult another).
    const c4sTools = ctx.mcp.c4sTools ? buildC4sToolsServer(deps.workspaceName) : null;

    // 0.1.69 transagent-tools: delegate work to a hidden child banka. Two guards:
    //   - registry dimension `transagentTools` (chat + patch only — never brief/`ask`).
    //   - recursion depth 1: never inside a child banka (parentThreadId != null), so a
    //     banka cannot spawn a banka. This guard is orthogonal to the registry (it depends
    //     on the thread's lineage, not its context_type), so it stays at the call site.
    const isChildBanka = thread.parentThreadId != null;
    const transagentTools = ctx.mcp.transagentTools && !isChildBanka
      ? buildTransagentToolsServer({
          parentThreadId: thread.id,
          dispatcher: new TransagentDispatcher(deps, {
            model: input.model,
            architectureConfig: input.architectureConfig,
            takeToolUseId: takeTransagentToolUse,
            runTurn: (childInput) => runAgentTurn(deps, childInput),
          }),
        })
      : null;

    // Registry `pluginServers`: 'all' mounts every entity-plugin server; 'release-only'
    // narrows to the BRIEF_ALLOWED_PLUGIN_MCP whitelist (read-only release-tools).
    const pluginMcpEntries = deps.pluginHost
      .buildMcpServers()
      .filter(({ name }) =>
        ctx.mcp.pluginServers === 'release-only' ? BRIEF_ALLOWED_PLUGIN_MCP.has(name) : true,
      )
      .map(({ name, server }) => [name, server.config] as const);
    const mcpServers: Record<string, McpServerConfig> = Object.fromEntries(pluginMcpEntries);
    if (planTools) mcpServers['plan-tools'] = planTools.config;
    if (briefTools) mcpServers['brief-tools'] = briefTools.config;
    if (c4sTools) mcpServers['c4s-tools'] = c4sTools.config;
    if (transagentTools) mcpServers['transagent-tools'] = transagentTools.config;

    // M05 queue: streaming-input keeps the SDK input channel open across turns so
    // queued messages can be pushed into the LIVE turn (`adapter.pushMessage`).
    // Opt-in per architecture capability; one-shot path unchanged for the rest.
    const streamingInput = architectureCapabilities('claude-code').midTurnPush;
    const baseExecuteArgs = {
      systemPrompt,
      model: input.model,
      cwd: deps.cwd,
      mcpServers,
      skills: inlineSkills,
      // 0.1.67 m05ctxreg: inject the per-context read-only explorer subagent. Mapped onto the
      // SDK's `options.agents`; does NOT narrow the parent's toolset (no allowedTools).
      subagents: subagentsFor(thread.contextType, deps.pluginHost),
      architectureConfig: input.architectureConfig,
      planMode,
      onUserInput: input.onUserInput,
      ...(streamingInput ? { streamingInput: true } : {}),
    };
    // Resume anchor threaded across turns of THIS request (merged dispatch resumes
    // the just-finished session). `setLastSessionId` only writes the DB, so we
    // track the latest id in-memory too.
    let currentSessionId: string | undefined = thread.lastSessionId ?? undefined;

    const consume = async (execPrompt: string): Promise<void> => {
      const stream = adapter.execute({
        ...baseExecuteArgs,
        prompt: execPrompt,
        resumeSessionId: currentSessionId,
      });
      const observed = input.consoleObserver
        ? observeStream(stream, [input.consoleObserver])
        : stream;
      for await (const event of observed) {
        // Mid-turn `user_message` carries an epoch-ms `timestamp` (number); map to
        // ISO on the wire so it matches `turn_start.timestamp`.
        if (event.type === 'user_message') {
          emit({
            type: 'user_message',
            text: event.text,
            timestamp: new Date(event.timestamp).toISOString(),
          });
        } else {
          emit(event as unknown as TurnEvent);
        }

        switch (event.type) {
          case 'text_delta':
            if (event.isSubagent && event.subagentTaskId) {
              getSubBuf(event.subagentTaskId).text += event.text;
            } else if (!event.isSubagent) {
              assistantBuf += event.text;
            }
            break;
          case 'thinking':
            if (event.isSubagent && event.subagentTaskId) {
              getSubBuf(event.subagentTaskId).thinking += event.text;
            } else if (!event.isSubagent) {
              thinkingBuf += event.text;
            }
            break;
          case 'user_message': {
            // A queued message was pushed into the live session. Close the current
            // assistant segment and persist the injected user message; subsequent
            // `text_delta`s start a fresh assistant block. The row was already
            // removed from the queue by the enqueue handler on a successful push.
            flushMainBuf();
            deps.chatService.addMessage(
              thread.id,
              'user',
              JSON.stringify({ text: event.text }),
              null,
              null,
              null,
              planMode,
            );
            break;
          }
          case 'assistant_message': {
            if (!event.message.subagentTaskId && event.message.usage) {
              lastTurnUsage = event.message.usage;
              deps.chatService.setLastUsage(thread.id, event.message.usage);
            }
            break;
          }
          case 'tool_use': {
            const taskId = event.subagentTaskId ?? null;
            if (taskId) flushSubBuf(taskId);
            else flushMainBuf();
            // 0.1.69 Transagents: feed the dispatcher the real tool_use id so the
            // child stores it as spawned_by_tool_use_id (F5 reconstruction key).
            if (event.toolName === TRANSAGENT_TOOL_FULL_NAME && event.toolUseId) {
              pushTransagentToolUse(event.toolUseId);
            }
            deps.chatService.addMessage(
              thread.id,
              'tool_use',
              JSON.stringify({ input: event.input }),
              event.toolName,
              event.toolUseId,
              taskId,
              planMode,
              'streaming',
            );
            break;
          }
          case 'tool_result': {
            const taskId = event.subagentTaskId ?? null;
            deps.chatService.markToolUseComplete(thread.id, event.toolUseId);
            const row = deps.chatService.addMessage(
              thread.id,
              'tool_result',
              JSON.stringify({ summary: event.summary, isError: event.isError }),
              null,
              event.toolUseId,
              taskId,
            );
            if (taskId === null) lastToolResultRowId = row.id;
            break;
          }
          case 'subagent_started':
            flushMainBuf();
            deps.chatService.startSubagentTask(
              thread.id,
              event.taskId,
              event.description,
              event.toolUseId ?? null,
            );
            break;
          case 'subagent_progress':
            deps.chatService.updateSubagentTaskProgress(thread.id, event.taskId, event.description);
            break;
          case 'subagent_completed':
            flushSubBuf(event.taskId);
            deps.chatService.completeSubagentTask(
              thread.id,
              event.taskId,
              event.status,
              event.summary ?? null,
            );
            break;
          case 'result': {
            flushMainBuf();
            for (const tid of Array.from(subagentBuffers.keys())) flushSubBuf(tid);
            if (event.sessionId) {
              currentSessionId = event.sessionId;
              deps.chatService.setLastSessionId(thread.id, event.sessionId);
            }
            const turnAnchor = lastMainAssistantRowId ?? lastToolResultRowId;
            if (lastTurnUsage) {
              deps.chatService.setLastUsage(thread.id, lastTurnUsage);
              if (turnAnchor !== null) {
                deps.chatService.attachTurnUsage(thread.id, turnAnchor, lastTurnUsage);
              }
            }
            if (typeof event.contextSize === 'number') {
              deps.chatService.setLastContextSize(thread.id, event.contextSize);
              if (turnAnchor !== null) {
                deps.chatService.attachTurnContextSize(thread.id, turnAnchor, event.contextSize);
              }
            }
            break;
          }
          case 'todo_list_updated':
            if (!event.isSubagent) {
              deps.chatService.updateCurrentTodoItems(thread.id, event.items);
            }
            break;
          case 'warning':
            console.warn('[agent warning]', event.message);
            break;
        }
      }
    };

    const effectivePrompt = stalePlanReminder ? `${stalePlanReminder}\n\n${prompt}` : prompt;
    await consume(effectivePrompt);

    // After-turn merged dispatch: whatever piled up in the queue while the turn
    // ran (push declined, or a non-streaming architecture) is delivered now as a
    // single merged turn that resumes the just-finished session — same SSE
    // response. Loop until the queue drains.
    let batch = deps.chatService.popAllQueued(thread.id);
    while (batch.length > 0) {
      emit({ type: 'queue_updated', queued: [] });
      const merged = batch.map((b) => b.prompt).join('\n\n---\n\n');
      // Persist the merged user message and re-seed the replay so a late joiner
      // sees the current turn (not the original prompt).
      deps.chatService.addMessage(
        thread.id,
        'user',
        JSON.stringify({ text: merged }),
        null,
        null,
        null,
        planMode,
      );
      const mergedTurnStart: TurnEvent = {
        type: 'turn_start',
        userMessageId: nanoid(12),
        assistantMessageId: nanoid(12),
        prompt: merged,
        timestamp: new Date().toISOString(),
      };
      replay.turnStart = mergedTurnStart;
      replay.events = [];
      emit(mergedTurnStart);
      // Stale-plan reminder is applied at DISPATCH (here), not at enqueue.
      const mergedReminder = isBriefFrame ? null : deps.planService.getStalePlanReminder(thread.id);
      await consume(mergedReminder ? `${mergedReminder}\n\n${merged}` : merged);
      batch = deps.chatService.popAllQueued(thread.id);
    }

    // Terminal `done`/`error` ida tylko transportem callera (`onEvent`).
    // Emitter dla GET /stream/:threadId dostaje `done` raz, w `finally`.
    input.onEvent({ type: 'done' });
  } catch (err) {
    // Mapuj na typed blad — `onEvent` dostaje `event: error` (parytet z SSE),
    // a caller (headless `ask`) lapie `AgentTurnError` i mapuje na status HTTP.
    let turnErr: AgentTurnError;
    if (err instanceof AdapterAbortError) {
      turnErr = new AgentTurnError('ABORTED', 'Aborted by user');
    } else if (err instanceof AdapterTimeoutError) {
      turnErr = new AgentTurnError('TIMEOUT', 'Agent took too long to respond');
    } else if (err instanceof AdapterInitError) {
      turnErr = new AgentTurnError(
        'AGENT_UNAVAILABLE',
        'Claude CLI not found or not logged in. Run `claude login` first.',
      );
    } else {
      turnErr = new AgentTurnError('AGENT_ERROR', err instanceof Error ? err.message : String(err));
    }
    // `emit` (nie samo `input.onEvent`) — error musi trafić też do emittera/bufora,
    // żeby klient wznawiający przez `joinStream` sfinalizował turę (reducer: isStreaming=false).
    emit({ type: 'error', code: turnErr.code, error: turnErr.message });
    throw turnErr;
  } finally {
    try {
      flushMainBuf();
      for (const tid of Array.from(subagentBuffers.keys())) flushSubBuf(tid);
    } catch (flushErr) {
      console.error('[chat] final flush failed', flushErr);
    }
    try {
      deps.chatService.finalizeStreamingRows(thread.id);
    } catch (finalizeErr) {
      console.error('[chat] finalizeStreamingRows failed', finalizeErr);
    }
    emitter.emit('event', { type: 'done' });
    deps.activeAdapters.delete(thread.id);
    cancelPendingForRequest(deps.pendingInputs, requestId);
    deps.onTurnFinished?.();
  }

  // 0.1.79: slice the messages this turn persisted (id > pre-turn snapshot).
  const messages = deps.chatService
    .getMessages(thread.id)
    .filter((m) => m.id > turnStartMessageId);
  return { threadId: thread.id, answer: lastAssistantText.trim(), messages };
}

export function countPages(tree: Array<{ type: string; children?: unknown[] }>): number {
  let n = 0;
  for (const node of tree) {
    if (node.type === 'file') n++;
    else if (Array.isArray(node.children))
      n += countPages(node.children as Array<{ type: string; children?: unknown[] }>);
  }
  return n;
}
