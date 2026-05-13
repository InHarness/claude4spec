import { Router } from 'express';
import type { ChatService } from '../services/chat.js';

export function threadsRouter(chat: ChatService): Router {
  const router = Router();

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
