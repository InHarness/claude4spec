import { Router } from 'express';
import type { GitService } from '../services/git.js';

/**
 * M28 — `/api/git/*`. Own prefix (exception to the L4 convention, analogous to
 * `/api/release-pushes/*` and `/api/remote-project/*`). Read-only: a single
 * `GET /status` returning `gitService.detect()`. `detect()` never throws on a
 * missing repo / missing git, so this endpoint always answers 200.
 */
export function gitRouter(gitService: GitService): Router {
  const router = Router();

  // GET /api/git/status — repo detection for the Settings Git section.
  router.get('/status', async (_req, res, next) => {
    try {
      res.json(await gitService.detect());
    } catch (err) {
      next(err);
    }
  });

  return router;
}
