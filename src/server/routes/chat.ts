import { Router, type Response } from 'express';
import { restError } from '../operations/envelope.js';
import { httpStatusForCode } from '../operations/error-codes.js';
import { nanoid } from 'nanoid';
import {
  architectureCapabilities,
  createConsoleObserver,
  getModelContextWindow,
  getSessionResumeConstraints,
  type StreamObserver,
  type UserInputRequest,
  type UserInputResponse,
} from '@inharness-ai/agent-adapters';
import { readConfig } from '../config.js';
import type { Annotation } from '../../shared/entities.js';
import { DomainError } from '../services/tags.js';
import { QUEUE_LIMIT } from '../services/chat.js';
import {
  cancelPendingForRequest,
  runAgentTurn,
  ALLOWED_MODELS,
  type Model,
  type ActiveAdapter,
  type AgentTurnDeps,
} from './agent-turn.js';
import { checkResumeConfigLock } from './resume-lock.js';
import { DEFAULT_MODEL } from '../../core/agent/run-agent.js';

export function chatRouter(deps: AgentTurnDeps): Router {
  const router = Router();
  // M31: per-project registries arrive via agentDeps (one pair per context).
  const { activeAdapters, pendingInputs } = deps;

  // Clear a thread's queue and broadcast `queue_cleared` to live-join clients.
  // The aborting client reads `clearedTexts` from the response (its own SSE is
  // closing) and restores the texts into the composer (D4).
  const clearThreadQueue = (active: ActiveAdapter, threadId: string): string[] => {
    const clearedTexts = deps.chatService.clearQueued(threadId);
    if (clearedTexts.length > 0) active.emit({ type: 'queue_cleared', texts: clearedTexts });
    return clearedTexts;
  };

  // 0.1.69 Transagents: a CONSCIOUS abort cascades to children. After aborting a
  // target thread, abort every active turn whose `parentThreadId` is that thread
  // (a banka cannot outlive a deliberate Stop of its parent). The child raises
  // AdapterAbortError → its streaming rows finalize. A plain disconnect (F5 /
  // thread switch) does NOT call this — it goes through res.on('close'), leaving
  // children running so the parent re-attaches via nested live-join.
  const cascadeAbortChildren = (abortedThreadId: string): void => {
    for (const [tid, entry] of activeAdapters.entries()) {
      if (entry.parentThreadId === abortedThreadId) {
        cancelPendingForRequest(pendingInputs, entry.requestId);
        entry.adapter.abort();
        // Children can themselves have children — cascade transitively.
        cascadeAbortChildren(tid);
      }
    }
  };

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
          default: DEFAULT_MODEL,
          /**
           * The context window per model, for `<UsageBadge />`'s denominator.
           *
           * It used to be a hardcoded table in the badge itself, which was
           * defensible while the whole catalog was 200k and Opus was the one
           * exception. It is not defensible now: `fable-5` / `sonnet-5` /
           * `opus-5` carry 1M and `haiku-4.5` carries 200k, so a stale copy
           * would misreport occupancy by 5x on the default model.
           *
           * Served rather than imported, for the same reason as
           * `sessionResumeConstraints` below: the package's main entry pulls
           * `fs/promises` / `os` / `path`, so the client can only import TYPES
           * from it. The value still comes from `getModelContextWindow` — this
           * is where that call can happen.
           */
          contextWindows: Object.fromEntries(
            ALLOWED_MODELS.flatMap((m) => {
              const w = getModelContextWindow('claude-code', m);
              return typeof w === 'number' ? [[m, w] as const] : [];
            }),
          ),
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
      const modelArg = typeof req.body?.model === 'string' ? req.body.model : DEFAULT_MODEL;
      const model: Model = (ALLOWED_MODELS as readonly string[]).includes(modelArg)
        ? (modelArg as Model)
        : DEFAULT_MODEL;
      const currentPage = typeof req.body?.currentPage === 'string' ? req.body.currentPage : null;
      const currentPageRootId =
        typeof req.body?.currentPageRootId === 'string' ? req.body.currentPageRootId : null;
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
        claude_usePreset: readConfig(deps.cwd).agent.claudeUsePreset,
      };
      // M05 0.1.62: own ANTHROPIC API key. When set, decrypt and inject per-turn into
      // `custom_env` — the SDK gives `ANTHROPIC_API_KEY` precedence over the local OAuth,
      // so no toggle is needed. No row ⇒ no injection ⇒ local Claude Code login (unchanged).
      // Per-turn, no `process.env` mutation. `custom_env` is NOT in RESUME_CONFIG_LOCKED,
      // so it also applies on resumed turns.
      const credential = await deps.agentCredentialService.getDecrypted();
      if (credential) {
        const existingEnv =
          clientArchitectureConfig.custom_env && typeof clientArchitectureConfig.custom_env === 'object'
            ? (clientArchitectureConfig.custom_env as Record<string, unknown>)
            : {};
        architectureConfig.custom_env = { ...existingEnv, ANTHROPIC_API_KEY: credential.apiKey };
      }
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

      // M05 session-lock: model, reasoning i (0.2.8) zakres FS sa immutable na turze
      // wznawiajacej. Backstop dla nie-UI konsumentow i wyscigu (zmiana modelu miedzy
      // fetchem a sendem). MUSI byc przed `setupSse` (po flush naglowkow SSE nie
      // ustawimy juz statusu 409). Wspolny helper z `POST /api/threads/:id/ask`.
      const resumeLock = checkResumeConfigLock({
        snapshotJson: deps.chatService.getInitialArchitectureConfig(thread.id),
        lastSessionId: thread.lastSessionId,
        model,
        architectureConfig,
        cwd: deps.cwd,
        roots: deps.roots,
      });
      if (resumeLock) return res.status(409).json(resumeLock);

      // One-stream-per-thread guard. Klient powinien dolaczyc przez GET /api/chat/stream/:threadId
      // albo abortowac poprzedni stream przez POST /api/chat/abort.
      if (activeAdapters.has(thread.id)) {
        // 0.2.15: status and shape from the shared table, not a literal here.
        // `STREAM_IN_PROGRESS` is the turn family's concurrency guard — stateful
        // where page/plan writes are hash-based — and a second turn on a live
        // thread is REJECTED rather than queued.
        return res
          .status(httpStatusForCode('STREAM_IN_PROGRESS'))
          .json(
            restError(
              'STREAM_IN_PROGRESS',
              'Thread already streaming',
              'join the running turn over the resume stream, or abort it first with POST /api/chat/abort/:threadId',
            ),
          );
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
          currentPageRootId,
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
    let foundThreadId: string | null = null;
    for (const [tid, entry] of activeAdapters.entries()) {
      if (entry.requestId === requestId) {
        found = entry;
        foundThreadId = tid;
        break;
      }
    }
    if (!found || !foundThreadId) return res.json({ data: { aborted: false }, clearedTexts: [] });
    cancelPendingForRequest(pendingInputs, requestId);
    found.adapter.abort();
    cascadeAbortChildren(foundThreadId);
    res.json({ data: { aborted: true }, clearedTexts: clearThreadQueue(found, foundThreadId) });
  });

  /**
   * Abort per threadId — used when the client joined only over resume-SSE and
   * has no requestId. There is exactly one active turn per threadId.
   *
   * 0.2.13 — the catalog's `abort_turn` operation, addressed BY THREAD rather
   * than by request. Reachability from outside is REQUIRED rather than a
   * convenience, because `ask` blocks its caller: without it, a caller whose
   * turn overruns its timeout has no way out. A CLI caller, an external
   * orchestrator and a resume-SSE client all hold a `threadId` from the start
   * response and nothing else.
   *
   * Two outcomes that used to be one. Both answered `{ aborted: false }`:
   *
   *   - the thread exists and simply has no turn running — an IDEMPOTENT no-op,
   *     which is the contract (aborting twice must not be an error);
   *   - the thread does not exist at all — a caller bug, and reporting it as a
   *     successful no-op meant a typo'd id looked like a completed abort.
   *
   * Now the second is `404 THREAD_NOT_FOUND` and the first is unchanged.
   *
   * The `requestId`-addressed variant above is deliberately left alone: it
   * searches the live adapter map by a value that only exists WHILE a turn runs,
   * so it has no thread to have found or not found.
   */
  router.post('/abort/:threadId', (req, res, next) => {
    try {
      const { threadId } = req.params;
      /**
       * The live adapter is consulted FIRST, and the thread row only after.
       *
       * Order matters here in a way that is easy to get backwards. `activeAdapters`
       * and `chat_thread` can disagree: `DELETE /api/threads/:id` removes the row
       * without touching the adapter map or aborting anything, so a turn can still
       * be streaming — and still writing to the specification — for a thread that
       * no longer exists. Checking the row first would answer that request
       * `404 THREAD_NOT_FOUND` and leave the orphaned turn running with no kill
       * switch at all, since a resume-SSE or CLI caller holds only a threadId and
       * cannot reach the requestId-addressed variant.
       *
       * So: if something is running under this id, stop it, whatever the database
       * thinks. The row lookup exists only to tell the two NON-aborting outcomes
       * apart.
       */
      const active = activeAdapters.get(threadId);
      if (active) {
        cancelPendingForRequest(pendingInputs, active.requestId);
        active.adapter.abort();
        cascadeAbortChildren(threadId);
        return res.json({ data: { aborted: true }, clearedTexts: clearThreadQueue(active, threadId) });
      }
      // Nothing running. Now the two outcomes that used to be one: a thread that
      // exists and is simply idle (idempotent no-op) versus one that never did
      // (a caller bug, which reporting as success made invisible).
      if (!deps.chatService.getThreadMeta(threadId)) {
        throw new DomainError('THREAD_NOT_FOUND', `thread '${threadId}' not found`);
      }
      res.json({ data: { aborted: false }, clearedTexts: [] });
    } catch (err) {
      next(err);
    }
  });

  // --- M05: message queue (composer stays unlocked during a live turn) -------
  //
  // Mutations broadcast `queue_updated` / `queue_cleared` via `active.emit`,
  // which reaches the original POST client AND live-join clients.

  // Enqueue a message typed during a live turn. Tries a mid-turn push when the
  // architecture supports it; otherwise the row waits for after-turn merged
  // dispatch (no lost-message window).
  router.post('/queue/:threadId', (req, res) => {
    const { threadId } = req.params;
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
    if (!prompt.trim()) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'prompt required' } });
    }
    const annotations = Array.isArray(req.body?.annotations) ? (req.body.annotations as Annotation[]) : null;
    const currentPage = typeof req.body?.currentPage === 'string' ? req.body.currentPage : null;

    const active = activeAdapters.get(threadId);
    if (!active) {
      // Klient użyje wtedy zwykłego POST /api/chat.
      return res.status(409).json({ error: { code: 'NO_ACTIVE_STREAM', message: 'no active stream for thread' } });
    }
    if (deps.chatService.countQueued(threadId) >= QUEUE_LIMIT) {
      return res.status(400).json({ error: { code: 'QUEUE_FULL', message: `queue is full (max ${QUEUE_LIMIT})` } });
    }

    const annotationsJson = annotations && annotations.length > 0 ? JSON.stringify(annotations) : null;
    const row = deps.chatService.enqueueQueued(threadId, prompt, annotationsJson, currentPage);

    // Mid-turn push when supported. On success the adapter emits `user_message`
    // (persisted + forwarded by the turn loop) → drop the row to avoid double
    // delivery. On false, leave the row for after-turn merged dispatch.
    if (architectureCapabilities('claude-code').midTurnPush && active.adapter.pushMessage) {
      let pushed = false;
      try {
        pushed = active.adapter.pushMessage(prompt);
      } catch {
        pushed = false;
      }
      if (pushed) deps.chatService.removeQueued(threadId, row.id);
    }

    const queued = deps.chatService.listQueued(threadId);
    active.emit({ type: 'queue_updated', queued });
    return res.status(202).json({ queued });
  });

  // Clear the whole queue for a thread.
  router.delete('/queue/:threadId', (req, res) => {
    const { threadId } = req.params;
    const clearedTexts = deps.chatService.clearQueued(threadId);
    const active = activeAdapters.get(threadId);
    if (clearedTexts.length > 0 && active) {
      active.emit({ type: 'queue_cleared', texts: clearedTexts });
    }
    return res.json({ clearedTexts });
  });

  // Cancel a single queued message by id. 404 when already delivered (tolerated race).
  router.delete('/queue/:threadId/:messageId', (req, res) => {
    const { threadId, messageId } = req.params;
    const removed = deps.chatService.removeQueued(threadId, messageId);
    if (!removed) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'queued message not found' } });
    }
    const queued = deps.chatService.listQueued(threadId);
    const active = activeAdapters.get(threadId);
    if (active) active.emit({ type: 'queue_updated', queued });
    return res.json({ queued });
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
    // M05: hydrate the joiner's queue chips with the current snapshot.
    send('queue_updated', { type: 'queue_updated', queued: deps.chatService.listQueued(threadId) });

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
