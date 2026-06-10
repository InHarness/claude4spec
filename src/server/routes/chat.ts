import { Router, type Response } from 'express';
import { nanoid } from 'nanoid';
import {
  createConsoleObserver,
  findResumeViolations,
  getSessionResumeConstraints,
  type StreamObserver,
  type UserInputRequest,
  type UserInputResponse,
} from '@inharness-ai/agent-adapters';
import { readConfig } from '../config.js';
import type { Annotation } from '../../shared/entities.js';
import {
  cancelPendingForRequest,
  runAgentTurn,
  ALLOWED_MODELS,
  type Model,
  type ActiveAdapter,
  type AgentTurnDeps,
} from './agent-turn.js';

export function chatRouter(deps: AgentTurnDeps): Router {
  const router = Router();
  // M31: per-project registries arrive via agentDeps (one pair per context).
  const { activeAdapters, pendingInputs } = deps;

  const consoleObserver: StreamObserver | null = deps.mode === 'dev'
    ? createConsoleObserver({
        thinking: true,
        subagents: true,
        usage: true,
        showAdapterReady: true,
        compactAdapterReady: true,
        toolResultMaxLen: 20000,
        sdkConfigExclude: ['mcpServers'],
      })
    : null;

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
      // M05 session-lock: fields frozen for the lifetime of a session. Sourced from the
      // adapter helper so the UI lock is NOT hardcoded — new immutable fields in the package
      // propagate automatically. Server-side because the package's main entry pulls the agent
      // runtime (not browser-safe), so the client reads the declared list from here.
      sessionResumeConstraints: getSessionResumeConstraints('claude-code'),
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

      // M05 session-lock: na turze wznawiajacej (`lastSessionId != null`) model i pola
      // reasoningu sa immutable — claude-code wiaze bloki thinking ostatniej tury z konfiguracja,
      // ktora je wyprodukowala, wiec ich zmiana na resume = twardy 400. Backstop dla nie-UI
      // konsumentow i wyscigu (zmiana modelu miedzy fetchem a sendem). MUSI byc przed `setupSse`
      // (po flush naglowkow SSE nie ustawimy juz statusu 409).
      if (thread.lastSessionId != null) {
        const snapshot = deps.chatService.getInitialArchitectureConfig(thread.id);
        if (snapshot) {
          const violations = findResumeViolations('claude-code', JSON.parse(snapshot), {
            model,
            architectureConfig,
          });
          if (violations.length > 0) {
            return res.status(409).json({
              error: {
                code: 'RESUME_CONFIG_LOCKED',
                message: 'Model and reasoning settings are locked for the lifetime of a session.',
                violations: violations.map((v) => ({ path: v.path, reason: v.reason })),
              },
            });
          }
        }
      }

      // One-stream-per-thread guard. Klient powinien dolaczyc przez GET /api/chat/stream/:threadId
      // albo abortowac poprzedni stream przez POST /api/chat/abort.
      if (activeAdapters.has(thread.id)) {
        return res.status(409).json({
          error: { code: 'STREAM_IN_PROGRESS', message: 'Thread already streaming' },
        });
      }

      setupSse(res);
      // clientGone flag: po `res.on('close')` (np. switch wątku → disconnect SSE)
      // przestajemy pisać do res, ale `runAgentTurn` leci dalej — adapter dożywa
      // do końca, eventy persystują w DB, a kolejny GET resume po powrocie na
      // wątek znajdzie aktywny `activeAdapters[threadId]`.
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
      const heartbeat = startHeartbeat(res, () => clientGone);
      // `res.on('close')` (NIE req) — canonical pattern z agent-chat/server/handler.ts.
      res.on('close', () => {
        clientGone = true;
        clearInterval(heartbeat);
      });

      const requestId = nanoid(12);
      const turnThread = thread;
      const onUserInput = (uinput: UserInputRequest): Promise<UserInputResponse> => {
        send('user_input_request', { type: 'user_input_request', request: uinput });
        deps.chatService.addMessage(
          turnThread.id,
          'user_input_request',
          JSON.stringify(uinput),
          null,
          uinput.requestId,
        );
        return new Promise<UserInputResponse>((resolve, reject) => {
          pendingInputs.set(uinput.requestId, {
            resolve,
            reject,
            requestIdsForRequest: requestId,
          });
        });
      };

      try {
        await runAgentTurn(deps, {
          thread: turnThread,
          prompt,
          annotations,
          model,
          currentPage,
          architectureConfig,
          requestId,
          consoleObserver,
          // Transport SSE — `runAgentTurn` zasila tez emitter dla GET /stream/:threadId.
          onEvent: (event) => send(event.type, event),
          onUserInput,
        });
      } catch {
        // `runAgentTurn` juz wyemitowalo SSE `event: error` — nie propagujemy
        // dalej (response jest SSE; errorHandler probowalby pisac JSON).
      } finally {
        clearInterval(heartbeat);
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
    let found: ActiveAdapter | null = null;
    for (const entry of activeAdapters.values()) {
      if (entry.requestId === requestId) {
        found = entry;
        break;
      }
    }
    if (!found) return res.json({ data: { aborted: false } });
    cancelPendingForRequest(pendingInputs, requestId);
    found.adapter.abort();
    res.json({ data: { aborted: true } });
  });

  // Abort per threadId — uzywany gdy klient podlaczyl sie tylko przez resume SSE
  // i nie zna requestId. Jest jedna aktywna tura per threadId.
  router.post('/abort/:threadId', (req, res) => {
    const { threadId } = req.params;
    const active = activeAdapters.get(threadId);
    if (!active) return res.json({ data: { aborted: false } });
    cancelPendingForRequest(pendingInputs, active.requestId);
    active.adapter.abort();
    res.json({ data: { aborted: true } });
  });

  // GET /api/chat/stream/:threadId — dolaczenie do zywego streamu po F5 / switch watku.
  // Protokol `useEventStream.joinStream` z @inharness-ai/agent-chat: brak aktywnej tury → 404
  // (klient pokazuje pelna historie z DB). Aktywna tura → `connected` (z `requestId`, zeby
  // `abort()` dzialal tez dla wznawiajacego), potem `turn_start` (reducer re-aktywuje wiadomosc
  // asystenta), replay bufora bieżącej tury, a na koncu nasluch live z emittera.
  router.get('/stream/:threadId', (req, res) => {
    const threadId = req.params.threadId;
    const active = activeAdapters.get(threadId);
    if (!active) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'no active stream for thread' } });
    }

    setupSse(res);
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
    const heartbeat = startHeartbeat(res, () => clientGone);

    // Handler jest w pelni synchroniczny (brak await), wiec snapshot bufora + attach
    // listenera sa atomowe wzgledem petli runu — zaden event nie zginie ani sie nie zdubluje.
    send('connected', { requestId: active.requestId, threadId, live: true });
    send('turn_start', active.replay.turnStart);
    for (const ev of active.replay.events.slice()) {
      send((ev as { type: string }).type, ev);
    }

    let listener: (event: unknown) => void = () => {};
    const cleanup = () => {
      clearInterval(heartbeat);
      active.emitter.off('event', listener);
    };
    listener = (event: unknown) => {
      try {
        const ev = event as { type: string };
        send(ev.type, ev);
        if (ev.type === 'done') {
          cleanup();
          if (!res.writableEnded) {
            try { res.end(); } catch { /* socket gone */ }
          }
        }
      } catch (listenerErr) {
        cleanup();
        clientGone = true;
        console.error('[chat] resume listener error', listenerErr);
      }
    };
    active.emitter.on('event', listener);
    res.on('close', () => {
      clientGone = true;
      cleanup();
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

const SSE_HEARTBEAT_MS = 15_000;

/** Periodyczny komentarz SSE (`:\n\n`) — utrzymuje połączenie podczas długiego
 *  „thinking" bez zdarzeń, żeby proxy/load-balancer nie ubiło bezczynnego socketu.
 *  Zwraca timer; caller MUSI go wyczyścić w `res.on('close')`/`finally`. */
function startHeartbeat(res: Response, isGone: () => boolean): ReturnType<typeof setInterval> {
  return setInterval(() => {
    if (isGone() || res.writableEnded || res.destroyed) return;
    try {
      res.write(':\n\n');
    } catch {
      /* socket gone — close handler wyczyści timer */
    }
  }, SSE_HEARTBEAT_MS);
}
