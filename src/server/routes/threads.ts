import { Router } from 'express';
import { nanoid } from 'nanoid';
import { findResumeViolations } from '@inharness-ai/agent-adapters';
import { readConfig } from '../config.js';
import {
  runAgentTurn,
  AgentTurnError,
  ALLOWED_MODELS,
  type Model,
  type AgentTurnDeps,
} from './agent-turn.js';

export function threadsRouter(deps: AgentTurnDeps): Router {
  const router = Router();
  const chat = deps.chatService;
  // M31: per-project adapter registry via agentDeps.
  const { activeAdapters } = deps;

  router.get('/', (req, res, next) => {
    try {
      // P2: default-limited list (last 20, updated_at DESC). The client paginates
      // via offset and infers "more" from `data.length === limit`. Default limit
      // applies even when the param is omitted, so the endpoint never dumps all rows.
      const limitRaw = Number(req.query.limit);
      const offsetRaw = Number(req.query.offset);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 20;
      const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
      res.json({ data: chat.listThreads(limit, offset) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', (req, res, next) => {
    try {
      const title = typeof req.body?.title === 'string' ? req.body.title : null;
      // 0.1.79: optional context_type. Only 'chat' (default) and 'ask' are
      // accepted on THIS generic path; 'brief'/'patch' have dedicated
      // create-thread endpoints (POST /briefs/:path/threads, /patches/...).
      const rawCt = req.body?.context_type;
      let contextType: 'chat' | 'ask' = 'chat';
      if (rawCt !== undefined) {
        if (rawCt !== 'chat' && rawCt !== 'ask') {
          return res.status(400).json({
            error: {
              code: 'VALIDATION',
              message: `context_type '${rawCt}' requires a dedicated create-thread endpoint`,
            },
          });
        }
        contextType = rawCt;
      }
      res.status(201).json({ data: chat.createThread(title, { contextType }) });
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
      // `isLive`: czy tura serwerowa wciąż trwa — klient decyduje, czy wznawiać przez
      // `joinStream` (zamiast zgadywać po `status` wierszy, który dla czystej tury
      // tekstowej nie istnieje aż do flush na granicy).
      res.json({
        data: {
          ...result.thread,
          messages: result.messages,
          subagentTasks: result.subagentTasks,
          isLive: activeAdapters.has(req.params.id),
          // M05: pending queue (position ASC) — restores chips after F5/restart.
          queuedMessages: chat.listQueued(req.params.id),
        },
      });
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
  // kontrakt `{ threadId, answer, messages }` (0.1.79: `messages` to wszystkie
  // wiadomosci tury w jednym batchu — `runAgent({ output: 'full' })` je czyta,
  // `'final'` ignoruje). Generyczny po `context_type` — runtime budowany tym
  // samym `runAgentTurn`, ktory zasila `POST /api/chat`.
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

      // Opcjonalny `model` z body (domyslnie `sonnet-4.6`); merge `architectureConfig` jak w
      // `POST /api/chat` — serwer wygrywa wylacznie na `claude_usePreset`.
      const modelArg = typeof req.body?.model === 'string' ? req.body.model : 'sonnet-4.6';
      const model: Model = (ALLOWED_MODELS as readonly string[]).includes(modelArg)
        ? (modelArg as Model)
        : 'sonnet-4.6';
      const clientArchitectureConfig =
        req.body?.architectureConfig && typeof req.body.architectureConfig === 'object'
          ? (req.body.architectureConfig as Record<string, unknown>)
          : {};
      const architectureConfig: Record<string, unknown> = {
        ...clientArchitectureConfig,
        claude_usePreset: readConfig(deps.cwd).agent?.claudeUsePreset ?? true,
      };
      // M05 0.1.62: own ANTHROPIC API key — same injection as `POST /api/chat`. When set,
      // decrypt and inject per-turn into `custom_env`; the SDK prefers it over the local
      // OAuth. No row ⇒ local Claude Code login (unchanged). Not in RESUME_CONFIG_LOCKED.
      const credential = await deps.agentCredentialService.getDecrypted();
      if (credential) {
        const existingEnv =
          clientArchitectureConfig.custom_env && typeof clientArchitectureConfig.custom_env === 'object'
            ? (clientArchitectureConfig.custom_env as Record<string, unknown>)
            : {};
        architectureConfig.custom_env = { ...existingEnv, ANTHROPIC_API_KEY: credential.apiKey };
      }

      // M05 session-lock: ten sam invariant co `POST /api/chat`. Defensywny backstop dla
      // nie-UI konsumentow (`c4s ask`, skrypty) — resume z innym modelem/reasoningiem = 409.
      if (thread.lastSessionId != null) {
        const snapshot = chat.getInitialArchitectureConfig(thread.id);
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

      // Gating one-stream-per-thread — wspoldzielony rejestr z `POST /api/chat`.
      if (activeAdapters.has(thread.id)) {
        return res.status(409).json({
          error: { code: 'STREAM_IN_PROGRESS', message: 'Thread already streaming' },
        });
      }

      const result = await runAgentTurn(deps, {
        thread,
        prompt: message,
        model,
        architectureConfig,
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
