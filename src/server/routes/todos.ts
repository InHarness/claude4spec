import { Router } from 'express';
import type { TodosIndexerService } from '../services/todos-indexer.js';
import { errorHandler } from './errors.js';

export function todosRouter(indexer: TodosIndexerService): Router {
  const router = Router();

  router.get('/', (_req, res, next) => {
    try {
      const todos = indexer.listAll();
      res.json({
        todos,
        counts: { byPath: indexer.countByPath(), total: indexer.countTotal() },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/counts', (_req, res, next) => {
    try {
      res.json({ byPath: indexer.countByPath(), total: indexer.countTotal() });
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
