import { Router } from 'express';
import type { ReleaseService } from '../services/release.js';
import type { WsEmitter } from '../ws/project-emitter.js';

/**
 * 2.1.47 (M17 `m17api401`, endpoint `post-api-shadow-accept`) — M17's third
 * own router, `/api/shadow-accept`: accepting a shadow as a new release. Its
 * own prefix because a literal under `/api/releases/` would collide with
 * `/api/releases/:name`; singular because it is an action on one shadow.
 *
 * `POST /` with `ShadowAcceptRequest` (the shadow id travels in the body — it
 * may contain `/`). The route is the only rendering of the operation
 * `accept_shadow` and adds no semantics of its own: the refusals (`VALIDATION`,
 * the release-name codes, `GIT_UNAVAILABLE`, `SHADOW_NOT_FOUND`, `ACCEPT_*`)
 * come from the service and are rendered by the shared error handler
 * (`ACCEPT_ABORT_FAILED` with its `recovery`). Success → `201` with the release
 * (`acceptedShadow` set) and `gitSync`, like `POST /api/releases` — and
 * `gitPush: null`: accepting a shadow never pushes (2.1.55).
 */
export function shadowAcceptRouter(releases: Pick<ReleaseService, 'acceptShadow'>, ws?: WsEmitter): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const release = await releases.acceptShadow(req.body);
      ws?.broadcast({ kind: 'release:created', releaseId: release.id, name: release.name });
      res.status(201).json(release);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
