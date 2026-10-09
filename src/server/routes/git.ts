import { Router } from 'express';
import type { GitService } from '../services/git.js';
import type { GitFetchResponse, GitStatusResponse } from '../../shared/git.js';

/**
 * M28 — `/api/git/*`. Own prefix (exception to the L4 convention, analogous to
 * `/api/release-pushes/*` and `/api/remote-project/*`). `GET /status` and
 * `GET /branches` are read-only. `POST /checkout` (working tree) and
 * `POST /fetch` (remote-tracking refs) write to `.git` but — like the
 * others — never surface an HTTP error for a domain outcome
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
      // 2.1.10 (dto git-status-response): ALWAYS ahead/behind + lastFetchedAt.
      // A local read — no repository lock.
      const status = await gitService.detect();
      const [aheadBehind, lastFetchedAt] = await Promise.all([
        gitService.statusAheadBehind(status),
        gitService.lastFetchedAt(status),
      ]);
      const body: GitStatusResponse = {
        ...status,
        ahead: aheadBehind?.ahead ?? null,
        behind: aheadBehind?.behind ?? null,
        lastFetchedAt,
      };
      res.json(body);
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

  // POST /api/git/fetch — 2.1.10 (endpoint post-api-git-fetch, M28 5eyq89gb).
  // No body. Fetches the upstream remote's refs without touching HEAD or the
  // working tree, so — unlike checkout — no project reload. Every outcome
  // (skipped / no-upstream / busy / error / fetched) rides a 200 body; the
  // `git:status-changed` emission after `fetched` happens inside gitService.
  router.post('/fetch', async (_req, res, next) => {
    try {
      const result: GitFetchResponse = await gitService.fetch();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
