import { Router, type Request, type Response } from 'express';
import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';
import {
  createAdapter,
  observeStream,
  createConsoleObserver,
  AdapterAbortError,
  AdapterInitError,
  AdapterTimeoutError,
  type RuntimeAdapter,
  type StreamObserver,
  type UsageStats,
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
import type { Annotation, Brief, PatchResponse } from '../../shared/entities.js';
import type { WsGateway } from '../ws/gateway.js';
import type { Db } from '../db/index.js';
import { pluginHost } from '../core/plugin-host/host.js';

interface ChatRouterDeps {
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

const ALLOWED_MODELS = ['sonnet-4.6', 'opus-4.7', 'haiku-4.5'] as const;
type Model = (typeof ALLOWED_MODELS)[number];

interface PendingInput {
  resolve: (response: UserInputResponse) => void;
  reject: (reason: unknown) => void;
  requestIdsForRequest: string;
}

interface ActiveAdapter {
  requestId: string;
  adapter: RuntimeAdapter;
  emitter: EventEmitter;
}

export function chatRouter(deps: ChatRouterDeps): Router {
  const router = Router();
  // Keyed by threadId — jeden aktywny adapter per watek. Umozliwia dolaczanie
  // klientow do zywego streamu przez GET /api/chat/stream/:threadId oraz
  // zwracanie 409 STREAM_IN_PROGRESS na drugi POST na ten sam watek.
  const activeAdapters = new Map<string, ActiveAdapter>();
  const pendingInputs = new Map<string, PendingInput>();

  const consoleObserver: StreamObserver | null = deps.mode === 'dev'
    ? createConsoleObserver({
        thinking: true,
        subagents: true,
        usage: true,
        showAdapterReady: true,
        compactAdapterReady: true,
        toolResultMaxLen: 20000,
        sdkConfigExclude: ['mcpServers']
      })
    : null;

  const cancelPendingForRequest = (requestId: string) => {
    for (const [inputId, pending] of pendingInputs) {
      if (pending.requestIdsForRequest === requestId) {
        pending.reject(new Error('stream aborted'));
        pendingInputs.delete(inputId);
      }
    }
  };

  // claude4spec eksponuje wylacznie architekture `claude-code` (lokalny CLI, sesja subskrypcyjna).
  // Endpoint przeniesiony z /api/config (kolizja z M01 app config) na /api/chat/config.
  router.get('/config', (_req, res) => {
    res.json({
      architectures: {
        'claude-code': {
          models: [...ALLOWED_MODELS],
          default: 'sonnet-4.6',
        },
      },
      defaultArchitecture: 'claude-code',
    });
  });

  router.post('/', async (req, res, next) => {
    try {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
      const threadId = typeof req.body?.threadId === 'string' ? req.body.threadId : undefined;
      const modelArg = typeof req.body?.model === 'string' ? req.body.model : 'sonnet-4.6';
      const model: Model = (ALLOWED_MODELS as readonly string[]).includes(modelArg) ? (modelArg as Model) : 'sonnet-4.6';
      const currentPage = typeof req.body?.currentPage === 'string' ? req.body.currentPage : null;
      const annotations = Array.isArray(req.body?.annotations) ? (req.body.annotations as Annotation[]) : [];
      // M05 / M01 `c0nf1g4a`: `claude_usePreset` jest server-driven (per-query read
      // `.claude4spec/config.json` → `agent.claudeUsePreset`, brak pola = `true`).
      // Pozostale pola `architectureConfig` (np. `claude_thinking`, `claude_effort`)
      // dalej przychodza z UI request body — merge, serwer wygrywa na `claude_usePreset`.
      const clientArchitectureConfig =
        req.body?.architectureConfig && typeof req.body.architectureConfig === 'object'
          ? (req.body.architectureConfig as Record<string, unknown>)
          : {};
      const architectureConfig: Record<string, unknown> = {
        ...clientArchitectureConfig,
        claude_usePreset: readConfig(deps.cwd).agent?.claudeUsePreset ?? true,
      };
      const planModeArg =
        typeof req.body?.planMode === 'boolean' ? (req.body.planMode as boolean) : undefined;

      if (annotations.length > 10) return res.status(400).json({ error: { code: 'VALIDATION', message: 'max 10 annotations' } });
      for (const a of annotations) {
        if (typeof a.text !== 'string' || a.text.length > 2000) return res.status(400).json({ error: { code: 'VALIDATION', message: 'annotation text too long (max 2000)' } });
        if (a.comment && a.comment.length > 1000) return res.status(400).json({ error: { code: 'VALIDATION', message: 'annotation comment too long (max 1000)' } });
      }
      if (!prompt.trim() && annotations.length === 0) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'prompt or annotations required' } });
      }

      let thread = threadId ? deps.chatService.getThreadMeta(threadId) ?? deps.chatService.createThread() : deps.chatService.createThread();

      if (planModeArg !== undefined && planModeArg !== thread.planMode) {
        thread = deps.chatService.updateThreadSettings(thread.id, { planMode: planModeArg });
      }
      const planMode = thread.planMode;

      // One-stream-per-thread guard. Klient powinien dolaczyc przez GET /api/chat/stream/:threadId
      // albo abortowac poprzedni stream przez POST /api/chat/abort.
      if (activeAdapters.has(thread.id)) {
        return res.status(409).json({
          error: { code: 'STREAM_IN_PROGRESS', message: 'Thread already streaming' },
        });
      }

      setupSse(res);
      // clientGone flag: po `req.on('close')` (np. switch wątku → disconnect SSE)
      // przestajemy pisać do res, ale pętla `for await` leci dalej — adapter musi
      // dożyć do końca, eventy persystują w DB, a kolejny GET resume po powrocie
      // na wątek znajdzie aktywny `activeAdapters[threadId]`.
      let clientGone = false;
      const send = (event: string, data: unknown) => {
        if (clientGone || res.writableEnded || res.destroyed) return;
        try {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          clientGone = true;
        }
      };

      const requestId = nanoid(12);
      const adapter = createAdapter('claude-code');
      const emitter = new EventEmitter();
      activeAdapters.set(thread.id, { requestId, adapter, emitter });
      // `res.on('close')` (NIE req) — canonical pattern z agent-chat/server/handler.ts:138.
      // req.close odpala dla request stream'a (zamknietego logicznie po express.json body parse),
      // co moglo ustawiac clientGone przedwczesnie i no-opowac wszystkie kolejne send().
      res.on('close', () => {
        clientGone = true;
      });
      send('connected', { requestId, threadId: thread.id });

      deps.chatService.addMessage(thread.id, 'user', JSON.stringify({ text: prompt, annotations }), null, null, null, planMode);
      if (!thread.title) {
        const title = prompt.slice(0, 60) + (prompt.length > 60 ? '...' : '');
        deps.chatService.updateTitle(thread.id, title || '(annotations only)');
      }

      const isBrief = thread.contextType === 'brief';
      // M23: patch threads keep the FULL spec-editing toolset (isBrief stays
      // false) — their job is to edit the spec. Only the system prompt differs.
      const isPatch = thread.contextType === 'patch';

      // M21: dla brief context czytamy aktualny snapshot brief'u (frontmatter+body+hash)
      // i wkladamy do system promptu. Skip kosztownych obliczen pageCount/entityCounts
      // (irrelewantne dla brief author).
      let briefSnapshot: Brief | null = null;
      if (isBrief && thread.briefPath) {
        try {
          briefSnapshot = await deps.briefService.getBrief(thread.briefPath);
        } catch (err) {
          // Brief plik usuniety/uszkodzony — kontynuujemy bez snapshot, agent dostanie
          // banner przez get_brief tool call.
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
      // niezaleznie od kontekstu. Dla brief context dokladamy bundled
      // `brief-author` (scope: contextual) — definiuje *gatunek* briefa,
      // writing-style dostarcza metodologie (workflows/brief.md w jego skill'u).
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

      // Pierwsza hydratacja currentPlanContext = "agent zobaczyl plan przez systemPrompt".
      // Bumpujemy last_seen_plan_version, zeby pierwsza user message tego watku nie
      // dostala stale-reminderu (currentVersion === lastSeen → no-op w kolejnych turach).
      if (isFirstTurn && currentPlan) {
        deps.planService.markPlanSeenByThread(thread.id);
      }

      let assistantBuf = '';
      let thinkingBuf = '';
      const subagentBuffers = new Map<string, { text: string; thinking: string }>();
      // Anchor dla per-turn usage snapshot (`chat_message.usage_json` na ostatnim rowsie tury).
      // Flushed assistant text to typowy target; w turach tool-only fallback na ostatni tool_result.
      let lastMainAssistantRowId: number | null = null;
      let lastToolResultRowId: number | null = null;
      // Per-response (non-cumulative) usage z ostatniego main `assistant_message`.
      // `result.usage` jest session-cumulative (suma wszystkich tur) i przy badge "context %"
      // dawalo zawyzone wartosci w dluzszych rozmowach (przekraczajac 100%).
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

      // M21 m05ctxreg: per-thread MCP servers depend on context_type.
      // chat → plan-tools; brief → brief-tools (only when briefPath exists).
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

      // Plugin MCP whitelist per context. Brief context exposes only
      // `release-tools` (read-only) from the plugin set; chat context exposes
      // everything. Both per-thread tools (plan-tools / brief-tools) merged below.
      const pluginMcpEntries = pluginHost
        .listMcpServers()
        .filter(({ name }) => (isBrief ? BRIEF_ALLOWED_PLUGIN_MCP.has(name) : true))
        .map(({ name, server }) => [name, server.config] as const);
      const mcpServers: Record<string, McpServerConfig> = Object.fromEntries(pluginMcpEntries);
      if (planTools) mcpServers['plan-tools'] = planTools.config;
      if (briefTools) mcpServers['brief-tools'] = briefTools.config;

      try {
        // Stale-plan-detection: jezeli plan zostal zaktualizowany w innym watku
        // od czasu ostatniego widzenia w tym, prepend <system-reminder> do user message.
        // NIE aktualizujemy last_seen_plan_version tutaj — robi to dopiero handler MCP get_plan
        // (zeby agent ignorujacy reminder dostal go znowu w nastepnej user message).
        const effectivePrompt = stalePlanReminder
          ? `${stalePlanReminder}\n\n${prompt}`
          : prompt;
        const stream = adapter.execute({
          prompt: effectivePrompt,
          systemPrompt,
          model,
          cwd: deps.cwd,
          mcpServers,
          skills: inlineSkills,
          resumeSessionId: thread.lastSessionId ?? undefined,
          architectureConfig,
          planMode,
          onUserInput: (input) => {
            send('user_input_request', { type: 'user_input_request', request: input });
            deps.chatService.addMessage(
              thread.id,
              'user_input_request',
              JSON.stringify(input),
              null,
              input.requestId,
            );
            return new Promise<UserInputResponse>((resolve, reject) => {
              pendingInputs.set(input.requestId, {
                resolve,
                reject,
                requestIdsForRequest: requestId,
              });
            });
          },
        });
        const observed = consoleObserver ? observeStream(stream, [consoleObserver]) : stream;
        for await (const event of observed) {
          send(event.type, event);
          emitter.emit('event', event);

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
            case 'assistant_message': {
              // Per-response (non-cumulative) usage z main agent. Subagenty maja
              // wlasna sesje SDK (osobne okno) — nie wliczamy ich w badge main.
              // Live update do DB — F5 w trakcie tury dostaje aktualny snapshot,
              // i w pelni stream'owanej turze badge progresuje miedzy assistant
              // messages bez czekania na koncowy `result`.
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
              // tool_use wstawiane jako 'streaming' — flip na 'complete' nastapi
              // przy parnym tool_result (markToolUseComplete). Finalizer w `finally`
              // zamyka orphany (tool_use bez tool_result, np. przy abortcie).
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
              // Najpierw flipuj parne tool_use na 'complete', potem insertuj result.
              // Kolejnosc nie jest krytyczna (idempotentna), ale trzymamy DB spojna w kazdej chwili.
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
              // Flush main najpierw — aktualizuje lastMainAssistantRowId; ten id
              // jest anchorem per-turn usage. Subagent bufory flushujemy
              // defensywnie po (zwykle juz flushnieto przy subagent_completed).
              flushMainBuf();
              for (const tid of Array.from(subagentBuffers.keys())) flushSubBuf(tid);
              if (event.sessionId) deps.chatService.setLastSessionId(thread.id, event.sessionId);
              // event.usage jest session-cumulative — nieuzyteczne dla badge "context %".
              // Bierzemy lastTurnUsage z ostatniego main assistant_message tej tury.
              const turnAnchor = lastMainAssistantRowId ?? lastToolResultRowId;
              if (lastTurnUsage) {
                deps.chatService.setLastUsage(thread.id, lastTurnUsage);
                // Target explicit message id — nie MAX(id), bo subagent bufor flushnal
                // jako ostatni i trafilby tam zamiast na main assistant / tool_result tej tury.
                if (turnAnchor !== null) {
                  deps.chatService.attachTurnUsage(thread.id, turnAnchor, lastTurnUsage);
                }
              }
              // agent-chat 0.1.1: `result.contextSize` to last-turn utilization okna
              // kontekstu (NIE sumować). Trzymamy je oddzielnie od billing-tokens
              // bo cumulative billing > 100% w dłuższych rozmowach.
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
        send('done', {});
      } catch (err) {
        if (err instanceof AdapterAbortError) send('error', { type: 'error', code: 'ABORTED', error: 'Aborted by user' });
        else if (err instanceof AdapterTimeoutError) send('error', { type: 'error', code: 'TIMEOUT', error: 'Agent took too long to respond' });
        else if (err instanceof AdapterInitError) send('error', { type: 'error', code: 'AGENT_UNAVAILABLE', error: 'Claude CLI not found or not logged in. Run `claude login` first.' });
        else send('error', { type: 'error', code: 'AGENT_ERROR', error: err instanceof Error ? err.message : String(err) });
      } finally {
        try {
          flushMainBuf();
          for (const tid of Array.from(subagentBuffers.keys())) flushSubBuf(tid);
        } catch (flushErr) {
          console.error('[chat] final flush failed', flushErr);
        }
        // Flipuj wszystkie wiszace rowsy (glownie orphan tool_use przy abortcie/timeoutcie)
        // na 'complete', zeby DB byla spojna niezaleznie od powodu zakonczenia streamu.
        try {
          deps.chatService.finalizeStreamingRows(thread.id);
        } catch (finalizeErr) {
          console.error('[chat] finalizeStreamingRows failed', finalizeErr);
        }
        emitter.emit('event', { type: 'done' });
        activeAdapters.delete(thread.id);
        cancelPendingForRequest(requestId);
        if (!res.writableEnded) {
          try {
            res.end();
          } catch {
            // socket already torn down by client disconnect — ignore
          }
        }
      }
    } catch (err) {
      next(err);
    }
  });

  router.post('/abort', (req, res) => {
    const requestId = req.body?.requestId;
    if (typeof requestId !== 'string') return res.status(400).json({ error: { code: 'VALIDATION', message: 'requestId required' } });
    // activeAdapters jest keyed by threadId, wiec szukamy wartosci z matching requestId.
    // O(N) po liczbie aktywnych watkow — akceptowalne na lokalnym tool.
    let found: ActiveAdapter | null = null;
    for (const entry of activeAdapters.values()) {
      if (entry.requestId === requestId) {
        found = entry;
        break;
      }
    }
    if (!found) return res.json({ data: { aborted: false } });
    cancelPendingForRequest(requestId);
    found.adapter.abort();
    res.json({ data: { aborted: true } });
  });

  // Abort per threadId — uzywany gdy klient podlaczyl sie tylko przez resume SSE
  // (po F5 albo wrocie do watku po switchu) i nie zna requestId. Jest jedna aktywna
  // tura per threadId, wiec threadId jest jednoznacznym kluczem.
  router.post('/abort/:threadId', (req, res) => {
    const { threadId } = req.params;
    const active = activeAdapters.get(threadId);
    if (!active) return res.json({ data: { aborted: false } });
    cancelPendingForRequest(active.requestId);
    active.adapter.abort();
    res.json({ data: { aborted: true } });
  });

  // GET /api/chat/stream/:threadId — dolaczenie do zywego streamu po F5 / switch watku.
  // Klient juz ma snapshot historii z GET /api/threads/:id; ten endpoint dostarcza
  // tylko LIVE eventy (bez replay rowsow jako syntetycznych eventow). Jesli adapter
  // juz nie zyje dla tego watku, od razu zwracamy `done` i klient pozostaje z final state.
  router.get('/stream/:threadId', (req, res) => {
    const threadId = req.params.threadId;
    const thread = deps.chatService.getThreadMeta(threadId);
    if (!thread) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'thread not found' } });
    }

    setupSse(res);
    // Identyczny pattern jak w POST — listener emitter'a leci w callstacku POST loopa,
    // wiec throw z res.write propagowalby do emit() i wybijal pętle for-await,
    // czyniąc cleanup w POST destrukcyjnym (finalizeStreamingRows + adapter osierocony).
    let clientGone = false;
    const send = (event: string, data: unknown) => {
      if (clientGone || res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        clientGone = true;
      }
    };

    const active = activeAdapters.get(threadId);
    send('connected', { threadId, live: Boolean(active) });
    if (!active) {
      send('done', {});
      return res.end();
    }

    const listener = (event: unknown) => {
      try {
        const ev = event as { type: string };
        send(ev.type, ev);
        if (ev.type === 'done') {
          active.emitter.off('event', listener);
          if (!res.writableEnded) {
            try { res.end(); } catch { /* socket gone */ }
          }
        }
      } catch (listenerErr) {
        // Nigdy nie pozwol propagowac do emitter.emit() w POST loopie.
        active.emitter.off('event', listener);
        clientGone = true;
        console.error('[chat] resume listener error', listenerErr);
      }
    };
    active.emitter.on('event', listener);
    // `res.on('close')` — patrz POST handler. Resume jest GET, ale dla spojnosci
    // i odpornosci uzywamy response-side sygnalu, ktory odpala dokladnie wtedy,
    // gdy klient SSE sie rozlacza.
    res.on('close', () => {
      clientGone = true;
      active.emitter.off('event', listener);
    });
  });

  router.post('/user-input', (req, res) => {
    const inputRequestId = typeof req.body?.requestId === 'string' ? req.body.requestId : null;
    const response = req.body?.response as UserInputResponse | undefined;
    if (!inputRequestId || !response || typeof response.action !== 'string') {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'requestId and response required' } });
    }
    const pending = pendingInputs.get(inputRequestId);
    if (!pending) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'no pending input for that requestId' } });
    }
    pendingInputs.delete(inputRequestId);
    const threadId = typeof req.body?.threadId === 'string' ? req.body.threadId : null;
    if (threadId) {
      try {
        deps.chatService.addMessage(
          threadId,
          'user_input_response',
          JSON.stringify(response),
          null,
          inputRequestId,
        );
      } catch {
        // thread may have been deleted; ignore persistence failure, still resolve
      }
    }
    pending.resolve(response);
    res.json({ data: { ok: true } });
  });

  return router;
}

function setupSse(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function countPages(tree: Array<{ type: string; children?: unknown[] }>): number {
  let n = 0;
  for (const node of tree) {
    if (node.type === 'file') n++;
    else if (Array.isArray(node.children)) n += countPages(node.children as Array<{ type: string; children?: unknown[] }>);
  }
  return n;
}
