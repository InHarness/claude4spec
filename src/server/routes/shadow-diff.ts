import { Router } from 'express';
import type { ReleaseService } from '../services/release.js';

/**
 * 2.1.46 (M17 `m17api401`, endpoint `get-api-shadow-diff`) — M17's second own
 * router, `/api/shadow-diff`: the comparison of a shadow with the master
 * (`ShadowDiffResponse`). Its own prefix because a literal under `/api/releases/`
 * would collide with `/api/releases/:name`; singular because it is one computed
 * delta of one shadow.
 *
 * `GET /?ref=<shadow id>` — the id (ref name without `refs/runs/`, e.g.
 * `<runId>/spec`) travels percent-encoded in the query, never in a path segment,
 * because it may contain `/`. The route is the only rendering of the operation
 * `shadow_diff` and adds no semantics of its own: refusals (`VALIDATION`,
 * `GIT_UNAVAILABLE`, `SHADOW_NOT_FOUND`) come from the service and are rendered
 * by the shared error handler. Read-only, no repository lock.
 */
export function shadowDiffRouter(releases: Pick<ReleaseService, 'shadowDiff'>): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      res.json(await releases.shadowDiff(req.query.ref));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
