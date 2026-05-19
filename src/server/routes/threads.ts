import { Router } from 'express';
import { nanoid } from 'nanoid';
import { readConfig } from '../config.js';
import {
  activeAdapters,
  runAgentTurn,
  AgentTurnError,
  type AgentTurnDeps,
} from './agent-turn.js';

export function threadsRouter(deps: AgentTurnDeps): Router {
  const router = Router();
  const chat = deps.chatService;

  router.get('/', (_req, res, next) => {
    try {
      res.json({ data: chat.listThreads() });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', (req, res, next) => {
    try {
      const title = typeof req.body?.title === 'string' ? req.body.title : null;
      res.status(201).json({ data: chat.createThread(title) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', (req, res, next) => {
    try {
      const limit = req.query.limit ? Math.max(1, Number(req.query.limit)) : undefined;
      const offset = req.query.offset ? Math.max(0, Number(req.query.offset)) : undefined;
      const result = chat.getThread(req.params.id, limit, offset);
      if (!result) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'thread not found' } });
      res.json({ data: { ...result.thread, messages: result.messages, subagentTasks: result.subagentTasks } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/system-prompt', (req, res, next) => {
    try {
      const thread = chat.getThreadMeta(req.params.id);
      if (!thread) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'thread not found' } });
      }
      const initialSystemPrompt = chat.getInitialSystemPrompt(req.params.id);
      res.json({ data: { initialSystemPrompt } });
    } catch (err) {
      next(err);
    }
  });

  // M05 `m05ask`: headless synchroniczna tura agenta. W odroznieniu od
  // `POST /api/chat` (SSE) blokuje zadanie do konca tury i zwraca skolapsowany
  // kontrakt `{ threadId, answer }`. Generyczny po `context_type` — runtime
  // budowany tym samym `runAgentTurn`, ktory zasila `POST /api/chat`.
  router.post('/:id/ask', async (req, res, next) => {
    try {
      const message = typeof req.body?.message === 'string' ? req.body.message : '';
      if (!message.trim()) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'message required' } });
      }

      // Endpoint NIE tworzy watku — `:id` musi juz istniec.
      const thread = chat.getThreadMeta(req.params.id);
      if (!thread) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'thread not found' } });
      }

      // Gating one-stream-per-thread — wspoldzielony rejestr z `POST /api/chat`.
      if (activeAdapters.has(thread.id)) {
        return res.status(409).json({
          error: { code: 'STREAM_IN_PROGRESS', message: 'Thread already streaming' },
        });
      }

      const result = await runAgentTurn(deps, {
        thread,
        prompt: message,
        model: 'sonnet-4.6',
        architectureConfig: {
          claude_usePreset: readConfig(deps.cwd).agent?.claudeUsePreset ?? true,
        },
        requestId: nanoid(12),
        consoleObserver: null,
        // Headless: stream kolapsowany serwerowo, brak transportu eventow.
        onEvent: () => {},
        // Brak interaktywnego kanalu — patrz patch `headless-onuserinput`.
      });

      res.json(result);
    } catch (err) {
      if (err instanceof AgentTurnError) {
        // 503 AGENT_UNAVAILABLE — `claude` CLI niedostepne/niezalogowane.
        // 500 — tura zakonczona eventem `error`; `code ∈ AGENT_ERROR|TIMEOUT|ABORTED`.
        const status = err.code === 'AGENT_UNAVAILABLE' ? 503 : 500;
        return res.status(status).json({ error: { code: err.code, message: err.message } });
      }
      next(err);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      res.json({ data: chat.deleteThread(req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', (req, res, next) => {
    try {
      const { title, planMode } = req.body ?? {};
      const hasTitle = typeof title === 'string';
      const hasPlanMode = typeof planMode === 'boolean';
      if (!hasTitle && !hasPlanMode) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'title or planMode required' } });
      }
      if (hasTitle) chat.updateTitle(req.params.id, title);
      if (hasPlanMode) chat.updateThreadSettings(req.params.id, { planMode });
      const thread = chat.getThreadMeta(req.params.id);
      if (!thread) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'thread not found' } });
      res.json({ data: thread });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
