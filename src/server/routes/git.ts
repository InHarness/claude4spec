import { Router } from 'express';
import type { GitService } from '../services/git.js';

/**
 * M28 — `/api/git/*`. Own prefix (exception to the L4 convention, analogous to
 * `/api/release-pushes/*` and `/api/remote-project/*`). Read-only: a single
 * `GET /status` returning `gitService.detect()` merged with
 * `gitService.statusAheadBehind()` (0.1.119, for the sidebar `GitStatusBadge`'s
 * ahead/behind display — passes the already-fetched `detect()` result in so
 * one request doesn't probe the repo twice). Neither call throws on a missing
 * repo / missing git, so this endpoint always answers 200.
 */
export function gitRouter(gitService: GitService): Router {
  const router = Router();

  // GET /api/git/status — repo detection for the Settings Git section + the
  // sidebar git-status badge.
  router.get('/status', async (_req, res, next) => {
    try {
      const status = await gitService.detect();
      const aheadBehind = await gitService.statusAheadBehind(status);
      res.json({ ...status, ahead: aheadBehind?.ahead ?? null, behind: aheadBehind?.behind ?? null });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
