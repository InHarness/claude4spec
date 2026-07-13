import { Router } from 'express';
import type { GitService } from '../services/git.js';

/**
 * M28 — `/api/git/*`. Own prefix (exception to the L4 convention, analogous to
 * `/api/release-pushes/*` and `/api/remote-project/*`). `GET /status` and
 * `GET /branches` are read-only. `POST /checkout` mutates the working tree but
 * — like the others — never surfaces an HTTP error for a domain outcome
 * (dirty tree, unknown branch, busy, git failure): every result rides
 * `status`/`message` in a 200 body. The only non-200 here is a malformed
 * request body.
 */
export function gitRouter(gitService: GitService, opts: { onSwitched?: () => void } = {}): Router {
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

  // GET /api/git/branches — local branches for the interactive git badge
  // dropdown + the release-plan commit-target picker.
  router.get('/branches', async (_req, res, next) => {
    try {
      res.json(await gitService.listBranches());
    } catch (err) {
      next(err);
    }
  });

  // POST /api/git/checkout — switch HEAD to an existing local branch. On
  // `'switched'`, fires the M31 reload (the same `onContextConfigChanged`
  // callback the config-PATCH path already uses to invalidate the cached
  // `ProjectContext`) and returns without a status snapshot — the client
  // reloads the project route and refetches `/status` fresh.
  router.post('/checkout', async (req, res, next) => {
    try {
      const rawBranch = req.body?.branch;
      if (typeof rawBranch !== 'string' || rawBranch.trim() === '') {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'branch must be a non-empty string' } });
      }
      // Trim before comparing — gitService.checkout() matches against branch
      // names from `git branch`, which are already whitespace-free.
      const branch = rawBranch.trim();
      const result = await gitService.checkout(branch);
      if (result.status === 'switched') opts.onSwitched?.();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
