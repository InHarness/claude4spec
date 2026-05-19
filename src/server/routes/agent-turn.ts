import { EventEmitter } from 'node:events';
import {
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
import type { PagesService } from '../services/pages.js';
import type { TagsService } from '../services/tags.js';
import type { SectionsService } from '../services/sections.js';
import { buildPlanToolsServer } from '../mcp/plan-tools.js';
import { buildBriefToolsServer } from '../mcp/brief-tools.js';
import { buildSystemPrompt } from '../services/chat-context.js';
import { readConfig } from '../config.js';
import type { PlanService } from '../services/plan.js';
import type { BriefService } from '../services/brief.js';
import type { PatchService } from '../services/patch.js';
import type { PageVersionService } from '../services/page-version.js';
import type { SkillResolver, SkillRegistry } from '../services/skill-registry.js';
import type { Annotation, Brief, ChatThread, PatchResponse } from '../../shared/entities.js';
import type { WsGateway } from '../ws/gateway.js';
import type { Db } from '../db/index.js';
import { pluginHost } from '../core/plugin-host/host.js';

/** Deps potrzebne do uruchomienia tury agenta. Wspolne dla `POST /api/chat`
 *  (SSE) i `POST /api/threads/:id/ask` (headless). */
export interface AgentTurnDeps {
  chatService: ChatService;
  pagesService: PagesService;
  tagsService: TagsService;
  sectionsService: SectionsService;
  planService: PlanService;
  briefService: BriefService;
  patchService: PatchService;
  pageVersions: PageVersionService;
  skillResolver: SkillResolver;
  skillRegistry: SkillRegistry;
  ws: WsGateway;
  cwd: string;
  pagesDir: string;
  mode: 'dev' | 'prod';
  db: Db;
}

/** M21 m05ctxreg: tools whitelist per context_type. Brief threads get only
 *  brief-tools (per-thread, mounted below) + release-tools (read-only).
 *  All other plugin servers (endpoint-tools, dto-tools, ui-view-tools,
 *  database-table-tools, plan-tools, reference-tools) are NOT mounted. */
const BRIEF_ALLOWED_PLUGIN_MCP = new Set(['release-tools']);

export const ALLOWED_MODELS = ['sonnet-4.6', 'opus-4.7', 'haiku-4.5'] as const;
export type Model = (typeof ALLOWED_MODELS)[number];

interface PendingInput {
  resolve: (response: UserInputResponse) => void;
  reject: (reason: unknown) => void;
  requestIdsForRequest: string;
}

export interface ActiveAdapter {
  requestId: string;
  adapter: RuntimeAdapter;
  emitter: EventEmitter;
}

// Wspoldzielone rejestry — keyed by threadId, jeden aktywny adapter per watek.
// `POST /api/chat` i `POST /api/threads/:id/ask` importuja te same instancje:
// drugi POST/ask na ten sam watek dostaje 409, a GET /api/chat/stream/:threadId
// dolacza do zywego streamu niezaleznie od tego, ktory endpoint go uruchomil.
export const activeAdapters = new Map<string, ActiveAdapter>();
export const pendingInputs = new Map<string, PendingInput>();

export function cancelPendingForRequest(requestId: string): void {
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
  const planMode = thread.planMode;

  const adapter = createAdapter('claude-code');
  const emitter = new EventEmitter();
  activeAdapters.set(thread.id, { requestId, adapter, emitter });

  // `onEvent` to transport callera; `emitter` zasila GET /api/chat/stream/:threadId.
  const emit = (event: TurnEvent) => {
    input.onEvent(event);
    emitter.emit('event', event);
  };
  emit({ type: 'connected', requestId, threadId: thread.id });

  let assistantBuf = '';
  let thinkingBuf = '';
  // Skolapsowana odpowiedz tury — wszystkie main-agent `text_delta` zlaczone.
  // Nie resetowane przy flush; zwracane jako `answer` po terminalnym evencie.
  let answerBuf = '';
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

    const isBrief = thread.contextType === 'brief';
    // M23: patch threads keep the FULL spec-editing toolset (isBrief stays
    // false) — their job is to edit the spec. Only the system prompt differs.
    const isPatch = thread.contextType === 'patch';

    // M21: dla brief context czytamy aktualny snapshot brief'u (frontmatter+body+hash)
    // i wkladamy do system promptu. Skip kosztownych obliczen pageCount/entityCounts.
    let briefSnapshot: Brief | null = null;
    if (isBrief && thread.briefPath) {
      try {
        briefSnapshot = await deps.briefService.getBrief(thread.briefPath);
      } catch (err) {
        console.warn(`[chat] brief read failed for ${thread.briefPath}:`, (err as Error).message);
      }
    }

    // M23: dla patch context czytamy snapshot patcha i wkladamy do system promptu.
    let patchSnapshot: PatchResponse | null = null;
    if (isPatch && thread.patchPath) {
      try {
        patchSnapshot = await deps.patchService.getPatch(thread.patchPath);
      } catch (err) {
        console.warn(`[chat] patch read failed for ${thread.patchPath}:`, (err as Error).message);
      }
    }

    let currentPageBody: string | null = null;
    if (!isBrief && currentPage) {
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
    const stalePlanReminder = isBrief ? null : deps.planService.getStalePlanReminder(thread.id);
    const currentPlan = isBrief ? null : deps.planService.getByThread(thread.id);

    // Skill resolution: writing-style (config.writingStyle, M15) ladowany
    // niezaleznie od kontekstu. Dla brief context dokladamy bundled `brief-author`.
    const writingStyleSkills = deps.skillResolver.resolve();
    const writingStyle = writingStyleSkills[0]
      ? {
          slug: writingStyleSkills[0].name,
          title: String(writingStyleSkills[0].metadata?.title ?? writingStyleSkills[0].name),
        }
      : null;
    const inlineSkills = [...writingStyleSkills];
    if (isBrief && deps.skillRegistry.has('brief-author')) {
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

    const pageCount = isBrief ? 0 : countPages(await deps.pagesService.listTree());
    const systemPrompt = buildSystemPrompt({
      projectName: readConfig(deps.cwd).name,
      cwd: deps.cwd,
      pagesDir: deps.pagesDir,
      currentPagePath: currentPage,
      currentPageBody,
      pageCount,
      entityCounts: isBrief ? {} : pluginHost.computeEntityCounts(deps.db.handle),
      tagCount: isBrief ? 0 : deps.tagsService.list().length,
      sectionCount: isBrief ? 0 : deps.sectionsService.count(),
      annotations,
      planMode,
      currentPlan,
      planToolsAvailable: !isBrief,
      writingStyle,
      contextType: thread.contextType,
      brief: briefSnapshot,
      patch: patchSnapshot,
    });

    // claude-code CLI po resumeSessionId ignoruje kolejne systemPrompty —
    // wiążący dla audytu jest tylko pierwszy. UPDATE idempotentny (no-op na 2.+ turze).
    deps.chatService.setInitialSystemPrompt(thread.id, systemPrompt);

    if (isFirstTurn && currentPlan) {
      deps.planService.markPlanSeenByThread(thread.id);
    }

    // M21 m05ctxreg: per-thread MCP servers depend on context_type.
    const planTools = isBrief
      ? null
      : buildPlanToolsServer({
          threadId: thread.id,
          planService: deps.planService,
        });
    const briefTools = isBrief && thread.briefPath
      ? buildBriefToolsServer({
          threadId: thread.id,
          briefPath: thread.briefPath,
          briefService: deps.briefService,
          pageVersions: deps.pageVersions,
        })
      : null;

    const pluginMcpEntries = pluginHost
      .listMcpServers()
      .filter(({ name }) => (isBrief ? BRIEF_ALLOWED_PLUGIN_MCP.has(name) : true))
      .map(({ name, server }) => [name, server.config] as const);
    const mcpServers: Record<string, McpServerConfig> = Object.fromEntries(pluginMcpEntries);
    if (planTools) mcpServers['plan-tools'] = planTools.config;
    if (briefTools) mcpServers['brief-tools'] = briefTools.config;

    const effectivePrompt = stalePlanReminder ? `${stalePlanReminder}\n\n${prompt}` : prompt;
    const stream = adapter.execute({
      prompt: effectivePrompt,
      systemPrompt,
      model: input.model,
      cwd: deps.cwd,
      mcpServers,
      skills: inlineSkills,
      resumeSessionId: thread.lastSessionId ?? undefined,
      architectureConfig: input.architectureConfig,
      planMode,
      onUserInput: input.onUserInput,
    });
    const observed = input.consoleObserver
      ? observeStream(stream, [input.consoleObserver])
      : stream;
    for await (const event of observed) {
      emit(event as unknown as TurnEvent);

      switch (event.type) {
        case 'text_delta':
          if (event.isSubagent && event.subagentTaskId) {
            getSubBuf(event.subagentTaskId).text += event.text;
          } else if (!event.isSubagent) {
            assistantBuf += event.text;
            answerBuf += event.text;
          }
          break;
        case 'thinking':
          if (event.isSubagent && event.subagentTaskId) {
            getSubBuf(event.subagentTaskId).thinking += event.text;
          } else if (!event.isSubagent) {
            thinkingBuf += event.text;
          }
          break;
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
          if (event.sessionId) deps.chatService.setLastSessionId(thread.id, event.sessionId);
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
    input.onEvent({ type: 'error', code: turnErr.code, error: turnErr.message });
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
    activeAdapters.delete(thread.id);
    cancelPendingForRequest(requestId);
  }

  return { threadId: thread.id, answer: answerBuf.trim() };
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
