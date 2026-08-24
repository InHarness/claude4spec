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
import { buildSkillToolsServer } from '../mcp/skill-tools.js';
import { createPatchToolsServer } from '../mcp/patch-tools.js';
import type { PatchWriteDeps } from '../services/patch-write.js';
import { buildBriefToolsServer } from '../mcp/brief-tools.js';
import { buildC4sToolsServer } from '../mcp/c4s-tools.js';
import { buildWorkspaceToolsServer } from '../mcp/workspace-tools.js';
import type { McpServerFactory } from '../../shared/plugin-host/mcp.js';
import { gateServers, pluginServerNamesFor } from '../operations/profile-gate.js';
import { BRIEF_ALLOWED_PLUGIN_MCP } from '../operations/profiles.js';
import type { ListProjectsResult } from '../workspace/list-projects.js';
import {
  buildSystemPrompt,
  subagentsFor,
  CONTEXT_TYPE_REGISTRY,
  type PeerProject,
} from '../services/chat-context.js';
import { readConfig } from '../config.js';
import {
  normalizeResumePathScope,
  resolveAgentExecutionScope,
} from '../services/agent-execution-scope.js';
import type { PlanService } from '../services/plan.js';
import type { BriefService } from '../services/brief.js';
import type { PatchService, PatchDetail } from '../services/patch.js';
import type { ReleaseService } from '../services/release.js';
import { TransagentDispatcher } from '../services/transagent-dispatcher.js';
import { buildTransagentToolsServer, TRANSAGENT_TOOL_FULL_NAME } from '../mcp/transagent-tools.js';
import type { FileVersionService } from '../services/file-version.js';
import type { SkillResolver, SkillRegistry } from '../services/skill-registry.js';
import type { Annotation, Brief, ChatMessage, ChatThread, Plan } from '../../shared/entities.js';
import type { Root } from '../../shared/types.js';
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
  /** Resolve a page-root's service by id (for root-aware current-page reads). */
  resolvePagesService?: (rootId: string) => PagesService | undefined;
  tagsService: TagsService;
  sectionsService: SectionsService;
  planService: PlanService;
  briefService: BriefService;
  patchService: PatchService;
  /** M23 `file_patch` over MCP. Optional so the hand-rolled test rigs keep compiling. */
  patchWrite?: PatchWriteDeps;
  /** 0.1.69 Transagents: dispatcher resolves "latest release" for analysis briefs. */
  releaseService: ReleaseService;
  pageVersions: FileVersionService;
  skillResolver: SkillResolver;
  /** 0.2.36: the live registry `skill-tools` reads through. Separate from the resolver
   *  because `load_skill_file` serves the WHOLE registry, not one context's listing. */
  skillRegistry: SkillRegistry;
  ws: WsEmitter;
  cwd: string;
  /** 0.1.96 multiroot: every configured page root (was the single `pagesDir` scalar).
   *  Folded into the agent's FS path scope and rendered in the `<project roots>` attr. */
  roots: Root[];
  mode: 'dev' | 'prod';
  db: Db;
  /**
   * 0.1.58: workspace name (registry identity) — the `workspace="…"` attr on the
   * `<workspace_projects>` prompt block.
   */
  workspaceName?: string;
  /**
   * 0.2.13 M31: the `list_projects` operation, as a thunk so the registry is
   * re-read per call. Renders into the tool channel as `workspace-tools`.
   * Absent ⇒ the server is not mounted (hand-built test rigs).
   */
  listWorkspaceProjects?: () => ListProjectsResult;
  /**
   * 0.1.58: workspace peers (current project excluded) for the
   * `<workspace_projects>` discovery block. Lazily read from each peer's
   * `config.json` per turn so peer-config edits surface on the next thread's
   * first turn. Absent ⇒ no peers (e.g. single-project workspace).
   */
  listWorkspacePeers?: () => PeerProject[];
}

import { ALLOWED_MODELS, type Model } from './models.js';
export { ALLOWED_MODELS, type Model };

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
/**
 * Annotate an ALREADY-BUFFERED `user_input_request` as resolved.
 *
 * The adapter hands one `AskUserQuestion` to the server over two parallel
 * channels: the `onUserInput(...)` handler (whose promise the answer resolves)
 * and a plain `user_input_request` stream event. The second one goes through
 * `emit`, and `user_input_request` is in `REPLAY_EVENT_TYPES` — so it sits in
 * `replay.events` for the rest of the turn. Nothing used to take it back out
 * once answered, and a mid-turn F5 (or a thread switch away and back) replayed
 * it verbatim: the interactive card came BACK, covered the composer, and its
 * submit answered `404 no pending input for that requestId`, because the
 * `pendingInputs` entry behind it was long gone.
 *
 * The entry is annotated rather than DELETED, and that distinction is
 * load-bearing. A mid-turn joiner restores persisted history only up to BEFORE
 * the last user message, so the `user_input_request` / `user_input_response`
 * rows of the running turn are sliced off — the current turn's transcript is
 * rebuilt from this buffer and nothing else. Dropping the event would take the
 * read-only history card down with the interactive one; annotating it lets the
 * client render `<PersistedUserInputCard />` instead.
 *
 * `response: null` means resolved-but-unanswerable (cancelled, aborted, or a
 * `pendingInputs` entry that no longer exists) — the card shows its `pending`
 * badge and stays read-only.
 *
 * Scans every active adapter rather than taking a threadId: input request ids
 * are `nanoid(12)`, and the one caller that knows the id best (`POST
 * /api/chat/user-input`) gets `threadId` only as an OPTIONAL body field.
 */
export function markUserInputResolvedInReplay(
  activeAdapters: Map<string, ActiveAdapter>,
  inputRequestId: string,
  response: UserInputResponse | null,
): void {
  for (const active of activeAdapters.values()) {
    const events = active.replay.events;
    for (let i = 0; i < events.length; i++) {
      const current = events[i];
      if (!current || current.type !== 'user_input_request') continue;
      const request = (current as { request?: { requestId?: string } }).request;
      if (request?.requestId !== inputRequestId) continue;
      // A COPY, not a mutation: the very same object was already handed to
      // `input.onEvent` and the emitter. Those consumers serialized it long ago,
      // but mutating shared state that other code holds a reference to is how
      // the next reader of this buffer gets surprised.
      events[i] = { ...current, resolved: true, response };
    }
  }
}

export function cancelPendingForRequest(
  pendingInputs: Map<string, PendingInput>,
  requestId: string,
  /**
   * Optional so the pure-`pendingInputs` callers keep working, but every caller
   * that HAS the adapter map should pass it: a cancelled request must not
   * survive in the replay buffer any more than an answered one does.
   */
  activeAdapters?: Map<string, ActiveAdapter>,
): void {
  for (const [inputId, pending] of pendingInputs) {
    if (pending.requestIdsForRequest === requestId) {
      pending.reject(new Error('stream aborted'));
      pendingInputs.delete(inputId);
      if (activeAdapters) markUserInputResolvedInReplay(activeAdapters, inputId, null);
    }
  }
}

/**
 * Typed blad tury. The class moved to `shared/agent-turn.ts` when
 * `runTransagent` had to narrow on it too — re-exported here so the many
 * existing `from './agent-turn.js'` importers keep working.
 */
import { AgentTurnError } from '../../shared/agent-turn.js';
export { AgentTurnError, type AgentTurnErrorCode } from '../../shared/agent-turn.js';

/** Every MCP tool the model sees is namespaced `mcp__<server>__<tool>`. */
const MCP_TOOL_PREFIX = 'mcp__';

/**
 * Is this `tool_result` the synthesized "no output at all" placeholder?
 *
 * Matched by SHAPE, deliberately narrowly. The placeholder is produced above the
 * adapter, verbatim from the production row this release is built on:
 * `"(mcp__brief-tools__update_brief completed with no output)"`.
 *
 * A blank or absent summary is NOT enough. `UnifiedEvent.tool_result.summary`
 * carries the tool's full content, and a `tool_use_summary`-derived event can
 * legitimately arrive with none — so treating empty as "no output" would arm a
 * fatal check on healthy turns. Only the placeholder means "the handler never
 * ran and there is nothing at all to show".
 */
export function isNoOutputSummary(summary: string | undefined | null): boolean {
  if (summary == null) return false;
  return /^\(.*\bcompleted with no output\b.*\)$/i.test(summary.trim());
}

/** `mcp__<server>__<tool>` → `<server>`, or null if it is not an MCP tool. */
export function mcpServerOfTool(toolName: string | undefined | null): string | null {
  if (!toolName?.startsWith('mcp__')) return null;
  const rest = toolName.slice('mcp__'.length);
  const sep = rest.indexOf('__');
  return sep > 0 ? rest.slice(0, sep) : null;
}

type TurnEvent = { type: string } & Record<string, unknown>;

export interface AgentTurnInput {
  /** Watek juz rozwiazany przez callera (+ planMode zaaplikowany). */
  thread: ChatThread;
  prompt: string;
  annotations?: Annotation[];
  model: Model;
  currentPage?: string | null;
  /** Root the `currentPage` path belongs to; resolves which PagesService reads it. */
  currentPageRootId?: string | null;
  architectureConfig: Record<string, unknown>;
  requestId: string;
  consoleObserver: StreamObserver | null;
  /** Transport callera — SSE forwarder dla `POST /api/chat`, no-op dla `ask`. */
  onEvent: (event: TurnEvent) => void;
  /** Interaktywny kanal user-input. Brak = headless (np. `ask`). */
  onUserInput?: UserInputHandler;
  /**
   * Bounds this turn's `adapter.execute()` call so the documented `TIMEOUT`
   * code is actually enforced/emitted, instead of the turn running unbounded.
   * Caller-supplied, NOT defaulted here: only the headless `ask` route passes
   * one (see `ASK_TURN_TIMEOUT_MS`, shared with the client-side run-turn fetch
   * dispatcher in `run-agent.ts`) — interactive `POST /api/chat` turns can
   * legitimately pause for a long time on `onUserInput` and must stay unbounded.
   */
  timeoutMs?: number;
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
  const currentPageRootId = input.currentPageRootId ?? null;
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
    // M17: engine-backgrounded tasks (shell/monitor/workflow) — a reload or
    // late-joining client rebuilds the background-task panel from history.
    'background_task_started',
    'background_task_progress',
    'background_task_completed',
    'todo_list_updated',
    'user_input_request',
    // 0.1.69 Transagents: bracket markers so reload/joiners reconstruct the
    // nested child panel.
    'transagent_started',
    'transagent_completed',
    'result',
    'error',
    // C21: the adapter's ONLY channel for "a runtime guarantee just got weaker"
    // — a filesystem scope degraded from a hard OS sandbox to a soft one, an
    // execute param the architecture ignores. It is forwarded over SSE, so
    // leaving it out of the replay meant a reload or a late join silently
    // dropped a SECURITY notice. A warning nobody sees is no warning.
    'warning',
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

  /**
   * Registration lives INSIDE the try, and that placement is load-bearing.
   *
   * `finally` below is the only thing that removes this entry, so every
   * statement that can throw between the `set` and the `try` was a permanent
   * leak: the thread keeps an `activeAdapters` entry with no turn behind it, so
   * `POST /api/chat` answers 409 STREAM_IN_PROGRESS forever and
   * `hasInFlightTurn()` pins the whole `ProjectContext` against eviction — the
   * "wedged until the process restarts" state, reachable from any throw during
   * setup. Registering here makes the register/release pair span exactly one
   * try/finally.
   *
   * Still AFTER `emit` is defined — the out-of-band queue routes (`POST/DELETE
   * /api/chat/queue/...`) broadcast `queue_updated`/`queue_cleared` through it.
   */
  try {
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
    let patchSnapshot: PatchDetail | null = null;
    if (thread.patchPath) {
      try {
        patchSnapshot = await deps.patchService.getPatch(thread.patchPath);
      } catch (err) {
        console.warn(`[chat] patch read failed for ${thread.patchPath}:`, (err as Error).message);
      }
    }

    // Read the attached page from the root the user is viewing. `currentPageRootId`
    // comes from the `/space/$rootId/$` route; fall back to the built-in `pages` root
    // when absent (older clients) or unknown.
    const currentPageService =
      deps.resolvePagesService?.(currentPageRootId ?? 'pages') ?? deps.pagesService;
    let currentPageBody: string | null = null;
    if (!isBriefFrame && currentPage) {
      try {
        const page = await currentPageService.read(currentPage);
        currentPageBody = page.body;
      } catch {
        currentPageBody = null;
      }
    }

    // 0.1.127: stale-plan reminder pipeline removed along with `plan_id`/
    // `last_seen_plan_version` — plans no longer track a "last seen version"
    // per thread (see brief 0-1-126-to-0-1-127). `currentPlan` (shown in the
    // system prompt) is unrelated and stays.
    //
    // `plan`'s registry entry declares `danglingPolicy: 'graceful-degrade'` —
    // a thread can point at a plan_path whose file was deleted out-of-band, and
    // that must not fail the whole turn, so this mirrors the try/catch already
    // used above for patchSnapshot/currentPageBody instead of letting
    // getByThread's NOT_FOUND propagate uncaught.
    let currentPlan: Plan | null = null;
    if (!isBriefFrame) {
      try {
        currentPlan = await deps.planService.getByThread(thread.id);
      } catch (err) {
        console.warn(`[chat] plan read failed for thread ${thread.id}:`, (err as Error).message);
      }
    }

    /**
     * M37: per-context skill resolution — the resolver takes the context type itself
     * and unions the three sources (hardcoded contextual slugs from M05 dim 1, the
     * unconditional fan-out of plugin contextual skills, the active writing style).
     *
     * 0.2.36: it returns METADATA. `listing` becomes the `<available_skills>` block
     * and `writingStyle` the single `<project_skill>` block — the two are separate
     * fields rather than one list to classify, so nothing here has to infer which
     * entry is binding from a `scope` marker. No skill CONTENT is loaded on this
     * path at all; the model fetches it through `skill-tools` if it wants it.
     */
    const { listing: availableSkills, writingStyle: writingStyleSkill } =
      deps.skillResolver.resolveForContext(thread.contextType);

    const pageCount = isBriefFrame ? 0 : countPages(await deps.pagesService.listTree());
    // 0.1.51: language directives travel the same path as writingStyle — read from
    // config per-turn here, NOT via architectureConfig. Effective only from the first
    // turn of a new thread (the prompt is persisted once by setInitialSystemPrompt).
    const cfg = readConfig(deps.cwd);
    // 0.1.90 (M05): agent FS path scope, read per-turn (hot-reload, same as
    // conversationalLanguage). The resolver folds in the implicit base (each root
    // dir-if-outside-cwd) and normalizes everything to absolute, so the agent never
    // loses root access.
    // 0.1.130: scoping is now UNCONDITIONAL — the resolver always injects the implicit
    // artifact deny-set (plans/briefs/patches/entities/releases), so every turn is scoped
    // even when the user configured nothing. The library keeps `cwd` writable as its base
    // (deny > allow > cwd), so an empty user allow-list means "cwd writable, artifact dirs
    // denied" — the agent can still touch its own project, just never hand-edit artifacts.
    // 0.2.8 (A19): composed by the shared builder, so the AC-analysis turn gets the
    // identical deny-set from the identical code (it re-reads config itself — the extra
    // disk read is the price of a single source of truth).
    const resolvedPathScope = resolveAgentExecutionScope({ cwd: deps.cwd, roots: deps.roots });
    const systemPrompt = buildSystemPrompt({
      host: deps.pluginHost,
      projectName: cfg.name,
      cwd: deps.cwd,
      roots: deps.roots,
      // briefs/patches are NOT roots but are shown in the `<project roots>` attr so the
      // agent has a full spatial map; dirs read per-turn from config (hot-reload).
      briefsDir: cfg.briefsDir,
      patchesDir: cfg.patchesDir,
      currentPagePath: currentPage,
      // rootId of the service the page was actually read from (viewed root, or the
      // 'pages' fallback) — rendered into the `<current_page root="…">` context.
      currentPageRootId: currentPageService.rootId,
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
      writingStyleSkill,
      // 0.2.36: the prompt is now the ONLY carrier of the fact that skills exist —
      // `adapter.execute` is handed no `skills` field below.
      availableSkills,
      // M05 m05ctxreg dim 6 (0.2.19): domain rules of this interaction type, owned by
      // the genre's module and rendered verbatim as <interaction_context type="…">.
      interactionRules: ctx.interactionRules,
      specLanguage: cfg.language ?? undefined,
      conversationalLanguage: cfg.agent?.conversationalLanguage ?? undefined,
      // 0.1.90 soft layer: config-level lists drive the <agent_path_scope> block's
      // ALLOWED/DISALLOWED lines (rendered from the raw config lists). 0.1.130: the block
      // is now always emitted (non-brief) because `artifactDenyDirs` is always non-empty —
      // it carries the absolute artifact deny-set for the unconditional ALWAYS-DISALLOWED line.
      agentPathScope: {
        allowedPaths: resolvedPathScope.userAllowedPaths,
        disallowedPaths: resolvedPathScope.userDisallowedPaths,
        artifactDenyDirs: resolvedPathScope.artifactDenyDirs,
        // 0.2.13 item 28: the soft half of the page write block. The hard half is
        // `claude_sandbox.filesystem.denyWrite`, further down in the same scope object.
        pageRootDirs: resolvedPathScope.pageRootDirs,
      },
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
    // 0.2.8 (C15): the FS path scope joins the snapshot. The library declares
    // `allowedPaths`/`disallowedPaths` resume-immutable and `findResumeViolations` already
    // checks them — it just never fired, because a field absent from the snapshot counts as
    // "not changed". Normalized (deduped + sorted) on the way in, because the library
    // compares by JSON.stringify and a mere reorder must not read as a change.
    //
    // 0.2.8: the snapshot is written WITH the session id, not before `adapter.execute`.
    // The guard only engages once `lastSessionId` is set, so a snapshot persisted by a turn
    // that died before producing a session (adapter init error, timeout, abort) would become
    // a permanent reference point for a session it never created: the next turn is waved
    // through (still no session), creates the session under the CURRENT config, and every
    // turn after that is compared against the stale snapshot — an unresumable thread. The
    // write stays idempotent (`… WHERE initial_architecture_config_json IS NULL`), so it
    // still records the config of the turn that actually opened the session.
    const { custom_env: _customEnv, ...snapshotArchitectureConfig } = input.architectureConfig;
    const recordSession = (sessionId: string): void => {
      deps.chatService.setLastSessionId(thread.id, sessionId);
      deps.chatService.setInitialArchitectureConfig(thread.id, {
        model: input.model,
        architectureConfig: snapshotArchitectureConfig,
        allowedPaths: normalizeResumePathScope(resolvedPathScope.allowedPaths),
        disallowedPaths: normalizeResumePathScope(resolvedPathScope.disallowedPaths),
      });
    };

    // 0.1.69 Transagents: the dispatcher is turn-scoped, NOT execute-scoped. It is
    // itself stateless (two injected fields), but the correlation state it reaches —
    // `takeTransagentToolUse` above — belongs to the turn, and capturing
    // `input.model`/`input.architectureConfig` once keeps the child-turn posture
    // identical across every execute of this turn.
    const isChildBanka = thread.parentThreadId != null;
    const transagentDispatcher = ctx.mcp.transagentTools && !isChildBanka
      ? new TransagentDispatcher(deps, {
          model: input.model,
          architectureConfig: input.architectureConfig,
          takeToolUseId: takeTransagentToolUse,
          runTurn: (childInput) => runAgentTurn(deps, childInput),
        })
      : null;
    /**
     * Which of the mounted servers are a PLUGIN's own surface. Turn-scoped: plugin
     * activation cannot change mid-turn (a config change builds a whole new
     * `ProjectPluginHost`), so this is computed once and handed to every execute.
     */
    const pluginServerNames = pluginServerNamesFor(deps.pluginHost.listEntities().map((m) => m.type));

    /**
     * MOUNTING IS LOUD — the two guards that make a failed mount fatal.
     *
     * Everything below the SDK boundary is silent by construction:
     * `connectSdkMcpServer` does `t.connect(r).catch(o => debugLog(o))` and then
     * advertises the server regardless, so a rejected `connect()` produces a
     * tool the model can call and can never reach. The observable result is a
     * `tool_result` with no output, in the same second as the `tool_use`, with
     * the handler never entered. There is no "advertised but broken" state worth
     * keeping: a server we cannot guarantee is reachable must abort the turn.
     *
     * Since the SDK reports nothing, the failure is caught from both sides:
     *
     * 1. `assertFreshMount` — BEFORE the mount, refuse to hand the adapter an
     *    instance already mounted in this turn. Re-mounting a live instance IS
     *    the 'Already connected to a transport' rejection, and rebuilding per
     *    execute means a repeat can only be a memoizing factory. Prevention,
     *    and the only guard that can act before damage is done.
     * 2. `assertMountedServerWasReachable` — check the binding the SDK would not
     *    report on. `Protocol` exposes `get transport()`, so "advertised but
     *    unbound" is directly observable rather than inferred.
     *
     * The second one is deliberately NOT a probe at a fixed moment. sdk-type
     * servers connect lazily and are ALL unbound again after `Query.cleanup()`,
     * so "unbound" is a normal state both before the first call and after the
     * last one — probing at query start (or trusting a bare snapshot at the end)
     * turns healthy turns into fatal errors. It runs on evidence instead: an MCP
     * call that came back with no output at all, judged against whether that
     * server was ever seen bound during this query.
     *
     * Both throw from inside the turn's `try`, so the catch maps them to
     * `AgentTurnError('AGENT_ERROR')` and `emit`s an `error` event — visible on
     * the live stream, in the replay buffer for a re-joining client, and as a
     * non-2xx for headless callers.
     */
    const mountedInstances = new Set<object>();

    /** The live `McpServer` behind an adapter config, if it carries one. */
    const instanceOf = (config: McpServerConfig): object | null => {
      const candidate = (config as { instance?: unknown }).instance;
      return typeof candidate === 'object' && candidate !== null ? candidate : null;
    };

    const assertFreshMount = (servers: Record<string, McpServerConfig>): void => {
      for (const [name, config] of Object.entries(servers)) {
        const instance = instanceOf(config);
        if (!instance) continue;
        if (mountedInstances.has(instance)) {
          throw new Error(
            `MCP mount failed: server "${name}" was rebuilt as the SAME instance already mounted ` +
              `in this turn. An McpServer binds to exactly one transport, so mounting it twice ` +
              `leaves tool calls with no result at all. Its factory must return a fresh server ` +
              `per call.`,
          );
        }
        mountedInstances.add(instance);
      }
    };

    /**
     * Which servers have been SEEN bound at least once during this query.
     *
     * This set is what keeps the check honest against the SDK's own teardown.
     * `Query.cleanup()` closes every sdk transport and clears its map, and
     * `Protocol._onclose` nulls the binding — so once a query ends, EVERY
     * instance reads as unbound. Events can still be draining out of the
     * adapter at that point, so a late `tool_result` would otherwise look
     * exactly like a total mount failure and kill a turn that had already
     * succeeded. A server that was reachable earlier is not a failed mount,
     * whatever its binding says afterwards.
     */
    const everBound = new Set<string>();

    /** Records currently-live bindings. Cheap: a handful of servers. */
    const sampleBindings = (servers: Record<string, McpServerConfig>): void => {
      for (const [name, config] of Object.entries(servers)) {
        const instance = instanceOf(config);
        if (instance && (instance as { server?: { transport?: unknown } }).server?.transport != null) {
          everBound.add(name);
        }
      }
    };

    /**
     * An MCP call came back with nothing. Was its server ever actually mounted?
     *
     * Scoped to the ONE server the call named — an empty result from
     * `brief-tools` says nothing about `release-tools`, and blaming a bystander
     * was how this failure stayed unreadable in the first place. The report then
     * says whether that server alone went dark or the whole advertised set did,
     * which is the property that makes the two production signatures tell
     * themselves apart from the outside.
     *
     * Known limit: an instance shared with a CONCURRENT turn still reads as
     * bound here, because the binding it carries is the other turn's. That case
     * is caught before it happens — by `assertFreshMount` within a turn, and by
     * the host refusing a repeat instance within a composition — not here.
     */
    const assertMountedServerWasReachable = (
      servers: Record<string, McpServerConfig>,
      serverName: string,
      toolName: string,
    ): void => {
      // Reachable at some point in this query ⇒ not a mount failure. Whatever
      // emptied this particular result, it was not "advertised but unbound".
      if (everBound.has(serverName)) return;
      const config = servers[serverName];
      const instance = config ? instanceOf(config) : null;
      // Not one of ours (no live instance) — nothing to assert about.
      if (!instance) return;
      if ((instance as { server?: { transport?: unknown } }).server?.transport != null) return;

      const advertised = Object.entries(servers)
        .filter(([, c]) => instanceOf(c) != null)
        .map(([n]) => n);
      const live = advertised.filter((n) => everBound.has(n));
      const allDark = live.length === 0;
      throw new Error(
        allDark
          ? `MCP mount failed: the whole mounted set is dark — none of the ${advertised.length} ` +
            `advertised server(s) (${advertised.join(', ')}) ever bound to a transport. ` +
            `\`${toolName}\` returned no result at all, and every other MCP tool this turn ` +
            `would do the same.`
          : `MCP mount failed: server "${serverName}" is advertised but never bound to a ` +
            `transport, while ${live.length} other server(s) mounted cleanly (${live.join(', ')}). ` +
            `\`${toolName}\` returned no result at all; the rest of the tool surface is healthy.`,
      );
    };

    /**
     * ONE `McpServer` SET PER `adapter.execute` — NOT per turn.
     *
     * An MCP `McpServer` binds to exactly one transport: `Protocol.connect`
     * (@modelcontextprotocol/sdk 1.29.0) throws `'Already connected to a
     * transport'` while a binding is live, and `_onclose` both nulls the binding
     * and aborts every in-flight request handler. So an instance shared by two SDK
     * queries is a dead instance for at least one of them.
     *
     * The failure is SILENT: the Claude Agent SDK's `connectSdkMcpServer` swallows
     * the `connect()` rejection into a debug log and still advertises the server, so
     * the symptom is tool calls that complete with no `tool_result` at all — every
     * whitelisted server at once, terminal for the rest of the turn.
     *
     * `consume()` below runs once for the initial prompt AND once per iteration of
     * the merged-dispatch drain loop, so "per turn" and "per query" stopped
     * coinciding the moment that loop landed. Rebuilding is cheap — every server is
     * already registered as a zero-arg factory (`project-context.ts`) and the whole
     * set measures ~6 ms — and `RuntimeExecuteParams.mcpServers` takes only concrete
     * configs carrying a live instance, so freshness has to be arranged here.
     *
     * Nothing is disposed on the way out. The SDK closes the transports it opened,
     * an `McpServer` holds no OS resource, and closing a set ourselves would abort
     * handlers of a query that may still be live (the M17 held-result path, a
     * transagent child running inside a blocked parent handler) — i.e. reproduce
     * this very bug from the other side.
     */
    const buildMcpServersForExecute = (): Record<string, McpServerConfig> => {
      // M05 m05ctxreg dim 2: per-thread MCP servers are dispatched from the registry's
      // `mcp` descriptor — each server mounts iff its registry flag is set.
      const planTools = ctx.mcp.planTools
        ? buildPlanToolsServer({
            threadId: thread.id,
            planService: deps.planService,
            pageVersions: deps.pageVersions,
          })
        : null;
      const briefTools = ctx.mcp.briefTools && thread.briefPath
        ? buildBriefToolsServer({
            threadId: thread.id,
            briefPath: thread.briefPath,
            briefService: deps.briefService,
          })
        : null;
      /**
       * M23 `file_patch`. Same gate as the brief tools — it is a `brief`-class
       * operation — but NOT the same `thread.briefPath` condition: the brief a
       * patch is filed against is an argument, not the thread's own binding, so a
       * brief thread can report drift against any brief it names.
       */
      const patchTools = ctx.mcp.briefTools && deps.patchWrite
        ? createPatchToolsServer(deps.patchWrite)
        : null;
      // M24 c4s-tools: cross-cutting MCP exposing the peer-consult flow. Fresh factory
      // per request; closes over `deps.workspaceName` so `ask` defaults to the caller's
      // workspace (fixes AMBIGUOUS_WORKSPACE when the project lives in N>1 workspaces).
      // Registry-gated: chat + patch only (brief is intentionally narrow; `ask` is
      // excluded — a consulted peer cannot consult another).
      const c4sTools = ctx.mcp.c4sTools ? buildC4sToolsServer(deps.workspaceName) : null;

      /**
       * 0.2.36 skill-tools: `load_skill_file`, the only channel to a skill's content.
       *
       * UNCONDITIONAL, and no `ctx.mcp.*` dimension gates it — deliberately the same
       * treatment `workspace-tools` gets, for a stronger version of the same reason.
       * The writing style attaches to EVERY context type, so the operation that reads
       * its body cannot be gated by any of them; `brief` above all, since that is the
       * frame whose FS built-ins are off and which therefore has no fallback at all.
       *
       * It carries no L3 catalog row (its subject is a prompt asset, not
       * specification content). `profile-gate` passes an undeclared tool on a
       * host-owned server through for every profile, so "outside the catalog" and
       * "reachable from all four profiles" are the same fact here rather than two.
       */
      const skillTools = buildSkillToolsServer(deps.skillRegistry);

      // 0.2.13 workspace-tools: M31's `list_projects`. No registry dimension gates
      // it — see the note at its mount below. Absent only when the deps were built
      // without a workspace (the hand-rolled test rigs).
      const workspaceTools = deps.listWorkspaceProjects
        ? buildWorkspaceToolsServer(deps.listWorkspaceProjects)
        : null;

      // 0.1.69 transagent-tools: delegate work to a hidden child banka. Both guards
      // (registry dimension `transagentTools`, and recursion depth 1 — never inside a
      // child banka) are folded into `transagentDispatcher` above, which is null when
      // either says no. Only the SERVER is rebuilt here; the dispatcher is turn-scoped.
      const transagentTools = transagentDispatcher
        ? buildTransagentToolsServer({
            parentThreadId: thread.id,
            dispatcher: transagentDispatcher,
          })
        : null;

      /**
       * Two gates, coarse then fine.
       *
       * Registry `pluginServers` picks whole SERVERS: 'all' mounts every
       * entity-plugin server, 'release-only' narrows to the
       * BRIEF_ALLOWED_PLUGIN_MCP whitelist (read-only release-tools).
       *
       * 0.2.13 adds `gateServers`, which then picks TOOLS within the survivors by
       * the context profile's admitted operation classes. The coarse gate could
       * never express "this profile gets `get_page` but not `create_tag`" — both
       * live on `reference-tools` — so `ask` was handed the write tools of every
       * mounted server and held back only by forced plan mode, which does not
       * apply to MCP at all. A server left with no admitted tools is dropped
       * rather than mounted empty.
       */
      const pluginEntries = deps.pluginHost
        // `strict`: this is the mount, where a repeat instance is fatal.
        .buildMcpServers({ strict: true })
        .filter(({ name }) =>
          ctx.mcp.pluginServers === 'release-only' ? BRIEF_ALLOWED_PLUGIN_MCP.has(name) : true,
        );

      /**
       * The INLINE servers, as gate input rather than as post-gate assignments.
       *
       * They used to be written into the map after `gateServers` had run, which
       * made L3's "the profile is the only hard gate" false for half the map:
       * six servers reached the model governed solely by the coarse `ctx.mcp.*`
       * flags, with their per-tool declarations never consulted. They carry
       * `.tools` from `createMcpServer` exactly like a plugin's server does, so
       * there was never a reason they could not be gated — only an ordering.
       *
       * Nothing is expected to DROP as a result: each inline tool's catalog
       * `opClass` matches the coarse flag that mounts it (`get_brief` /
       * `update_brief` / `file_patch` are `brief`, plan tools are `plan`, `ask`
       * is `peer`, `list_projects` is `read`), and `mcpServerSetForProfile`
       * derives those flags from the same class sets the gate reads. The point
       * is that the two can no longer drift apart in silence: widen a profile
       * without widening the catalog and the gate now has the final word.
       *
       * `list_projects` (workspace-tools) stays mounted for every context type
       * for the reason it always was — it is read-class, which every profile
       * admits, and neither alternative home's gate (the peer-consultation
       * recursion guard on `c4s-tools`, the release-only narrowing of the plugin
       * pool for `brief`) has anything to do with workspace discovery. It now
       * reaches that outcome THROUGH the gate rather than around it.
       *
       * Ordering is load-bearing: inline entries come last, so a name collision
       * with a plugin server resolves to the inline one, exactly as the previous
       * overwrite-by-key assignment did.
       */
      const inlineEntries: Array<{ name: string; server: McpServerFactory }> = [];
      if (planTools) inlineEntries.push({ name: 'plan-tools', server: planTools });
      if (briefTools) inlineEntries.push({ name: 'brief-tools', server: briefTools });
      if (patchTools) inlineEntries.push({ name: 'patch-tools', server: patchTools });
      if (c4sTools) inlineEntries.push({ name: 'c4s-tools', server: c4sTools });
      if (transagentTools)
        inlineEntries.push({ name: 'transagent-tools', server: transagentTools });
      if (workspaceTools) inlineEntries.push({ name: 'workspace-tools', server: workspaceTools });
      inlineEntries.push({ name: 'skill-tools', server: skillTools });

      /**
       * ONE gate call, producing the final map. There is deliberately no second
       * place in this function where a server can enter it.
       */
      const gated = gateServers(
        thread.contextType,
        [...pluginEntries, ...inlineEntries],
        // Which of the survivors are a PLUGIN's own surface. For a profile that
        // admits no writes, an undeclared tool on one of those is denied rather
        // than waved through — the host cannot vouch for what it never wrote.
        // Inline servers are host-owned and are not in this set.
        pluginServerNames,
      );

      const mcpServers: Record<string, McpServerConfig> = Object.fromEntries(
        // 0.2.2: `McpServerFactory.config` is deliberately `unknown` — the host
        // only forwards it. THIS is the adapter boundary where it is re-widened to
        // the vendor's config type, and the only place in the host that needs to.
        gated.map(({ name, server }) => [name, server.config as McpServerConfig] as const),
      );
      assertFreshMount(mcpServers);
      return mcpServers;
    };

    // M05 queue: streaming-input keeps the SDK input channel open across turns so
    // queued messages can be pushed into the LIVE turn (`adapter.pushMessage`).
    // Opt-in per architecture capability; one-shot path unchanged for the rest.
    const streamingInput = architectureCapabilities('claude-code').midTurnPush;
    // 0.1.103: request HARD (OS-syscall) enforcement so agent-adapters' probePathScope()
    // can return strength:'hard' on hosts with bubblewrap/seatbelt — previously only the
    // soft (prompt + SDK deny-list) layer was ever requested. Built as a copy, not a
    // mutation of input.architectureConfig: that object is also read above for the
    // session-lock snapshot and passed into TransagentDispatcher for child turns, each of
    // which recomputes its own scope independently via its own runAgentTurn recursion.
    // 0.1.130: unconditional — the artifact deny-set is always present in
    // resolvedPathScope.disallowedPaths, so the sandbox is built every turn. `allowWrite`
    // may be empty (no user allow-list, roots inside cwd); the library keeps `cwd`
    // writable as its base, so empty allowWrite means "cwd writable, artifact dirs denied".
    const architectureConfigForExecute = {
      ...input.architectureConfig,
      claude_sandbox: resolvedPathScope.claudeSandbox,
    };
    const baseExecuteArgs = {
      systemPrompt,
      model: input.model,
      cwd: deps.cwd,
      // NOTE: no `mcpServers` here on purpose — see `buildMcpServersForExecute`.
      // It is the one execute argument that must NOT be shared across the turn's
      // queries, so it is built inside `consume` below rather than captured here.
      /**
       * NOTE: no `skills` here either, and its absence is the whole of 0.2.36.
       *
       * `RuntimeExecuteParams.skills` materializes each inline skill's package into
       * a library tmpdir for the model to open with the native `Skill()` tool. That
       * made the read channel a function of the sandbox: a `brief` turn runs with
       * the FS built-ins off, so a style pointing at `workflows/brief.md` could not
       * open the file it was pointing at. Nothing from the M37 registry touches disk
       * now — the prompt names skills, `skill-tools` serves them.
       */
      // 0.1.67 m05ctxreg: inject the per-context read-only explorer subagent. Mapped onto the
      // SDK's `options.agents`; does NOT narrow the parent's toolset (no allowedTools).
      subagents: subagentsFor(thread.contextType, deps.pluginHost),
      architectureConfig: architectureConfigForExecute,
      planMode,
      onUserInput: input.onUserInput,
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
      ...(streamingInput ? { streamingInput: true } : {}),
      // 0.1.90 hard layer: resolved, absolute scope handed to the native sandbox
      // every turn (hot-reload). 0.1.130: always present — disallowedPaths always carries
      // the implicit artifact deny-set, so the library's path-scope enforcement always
      // engages (its own gate is `allowed.length || disallowed.length`).
      allowedPaths: resolvedPathScope.allowedPaths,
      disallowedPaths: resolvedPathScope.disallowedPaths,
    };
    // Resume anchor threaded across turns of THIS request (merged dispatch resumes
    // the just-finished session). `setLastSessionId` only writes the DB, so we
    // track the latest id in-memory too.
    let currentSessionId: string | undefined = thread.lastSessionId ?? undefined;

    const consume = async (execPrompt: string): Promise<void> => {
      // Called HERE, per invocation — never hoisted into a variable this closure
      // captures across queries. That distinction is the entire fix. Held in a
      // local only so the binding check below can look at THIS query's set.
      const mountedForQuery = buildMcpServersForExecute();
      const stream = adapter.execute({
        ...baseExecuteArgs,
        mcpServers: mountedForQuery,
        prompt: execPrompt,
        resumeSessionId: currentSessionId,
      });
      /**
       * `tool_use` id → tool name, for THIS query's MCP calls only.
       *
       * The binding check below needs to know that an empty `tool_result`
       * belonged to an MCP tool, and the result event carries only the id.
       */
      const mcpToolUseNames = new Map<string, string>();
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
        } else if (event.type === 'result' && (event.backgroundTasks?.length ?? 0) > 0) {
          // M17 HELD RESULT — NOT end-of-run. The engine holds the session open
          // while background work (a `run_in_background` shell, a Monitor, a
          // workflow) is in flight, wakes the model when it settles, and emits a
          // further `result` (empty `backgroundTasks`) before the generator is
          // `done`. Do NOT emit or buffer this result: agent-chat's reducer sets
          // `isStreaming: false` and SUMS usage on every `result`, so a held one
          // would stop the turn UI early and double-count usage. Track sessionId
          // only, skip the switch's usage finalization, and let the `for-await`
          // continue to the genuine final result.
          if (event.sessionId) {
            currentSessionId = event.sessionId;
            recordSession(event.sessionId);
          }
          continue;
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
          case 'warning': {
            /**
             * C21. This used to be a lone `console.warn` further down the
             * switch — which is to say the ONLY channel reporting a weakened
             * runtime guarantee (an FS scope degraded from a hard OS sandbox to
             * a soft one, an ignored execute param) ended in a server log the
             * user never reads. It now also becomes a transcript row.
             *
             * A point event, not a stream: one row, `status: 'complete'`, no
             * streaming phase to close. Flushed first so the warning lands in
             * the transcript where it happened rather than after whatever the
             * assistant went on to say.
             */
            console.warn('[agent warning]', event.message);
            flushMainBuf();
            deps.chatService.addMessage(thread.id, 'warning', JSON.stringify({ message: event.message }));
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
            if (event.toolName?.startsWith(MCP_TOOL_PREFIX) && event.toolUseId) {
              mcpToolUseNames.set(event.toolUseId, event.toolName);
              // Sampled HERE because this is the moment a healthy server is
              // necessarily bound: the model is calling it. What this records is
              // what the check below trusts.
              sampleBindings(mountedForQuery);
            }
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
            /**
             * THE SIGNATURE, caught at the only moment it is actually visible.
             *
             * An MCP call that comes back with no output at all is the symptom
             * this release exists to end: same-second `tool_use`/`tool_result`,
             * handler never entered, nobody told. Checking the bindings HERE —
             * rather than speculatively at query start — is what keeps the guard
             * honest: the SDK connects its sdk-type servers lazily, so "not yet
             * bound" is a normal state right up until a call has to reach one.
             * By the time an empty result exists, a live binding was required.
             *
             * If the bindings are live the call failed somewhere else and this
             * says nothing (per-call observability is deliberately out of scope,
             * being specified separately). If they are not, the turn dies loudly
             * and names whether one server or the whole set went dark.
             */
            const mcpToolName = mcpToolUseNames.get(event.toolUseId);
            const mcpServerName = mcpServerOfTool(mcpToolName);
            if (mcpServerName && mcpToolName && isNoOutputSummary(event.summary)) {
              assertMountedServerWasReachable(mountedForQuery, mcpServerName, mcpToolName);
            }
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
          // M17: engine-backgrounded tasks. Persist (emission is automatic via the
          // `emit` above); the client renders them in a distinct panel — a
          // backgrounded shell/monitor/workflow is NOT a subagent. `taskType` is
          // stored by name so a future SDK kind is observable, not dropped.
          case 'background_task_started':
            flushMainBuf();
            deps.chatService.startBackgroundTask(
              thread.id,
              event.taskId,
              event.taskType,
              event.description,
            );
            break;
          case 'background_task_progress':
            deps.chatService.updateBackgroundTaskProgress(
              thread.id,
              event.taskId,
              event.taskType,
              event.description ?? null,
              event.status ?? null,
              event.outputFile ?? null,
            );
            break;
          case 'background_task_completed':
            deps.chatService.completeBackgroundTask(
              thread.id,
              event.taskId,
              event.taskType,
              event.status,
              event.outputFile ?? null,
              event.summary ?? null,
            );
            break;
          case 'result': {
            flushMainBuf();
            for (const tid of Array.from(subagentBuffers.keys())) flushSubBuf(tid);
            if (event.sessionId) {
              currentSessionId = event.sessionId;
              recordSession(event.sessionId);
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
        }
      }
    };

    await consume(prompt);

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
      await consume(merged);
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
    // Sweep BEFORE the entry is dropped — `cancelPendingForRequest` reaches the
    // replay buffer through `activeAdapters`, so the other order would leave
    // every still-unanswered request of this turn un-annotated.
    cancelPendingForRequest(deps.pendingInputs, requestId, deps.activeAdapters);
    deps.activeAdapters.delete(thread.id);
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
