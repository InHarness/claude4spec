import { Router } from 'express';
import type { ProgressService } from '../services/progress.js';

/**
 * M35 Progress — single read-only endpoint. `ProgressService.getProgress()`
 * is designed to never throw (each source degrades independently), so this
 * try/catch is a pure backstop, not the actual degradation mechanism.
 */
export function progressRouter(progress: ProgressService): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      res.json(await progress.getProgress());
    } catch (err) {
      next(err);
    }
  });

  return router;
}
