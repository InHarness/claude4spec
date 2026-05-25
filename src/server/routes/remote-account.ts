import { Router } from 'express';
import type { RemoteAuthService } from '../services/remote-auth.js';
import { errorHandler } from './errors.js';

/**
 * M24 Remote Account — own prefix `/api/remote-account/*` (deviates from the L4
 * `/api/{type}s/*` convention because M24 is not an M13 entity plugin). Login is
 * a human action; there is no agent/MCP path here. Never exposes `access_token`.
 */
export function remoteAccountRouter(remote: RemoteAuthService): Router {
  const router = Router();

  // GET /api/remote-account — sidebar identity; `{ connected: false }` when empty.
  router.get('/', (_req, res, next) => {
    try {
      res.json(remote.getCurrentAccount());
    } catch (err) {
      next(err);
    }
  });

  // POST /api/remote-account/login/start — initiate device flow (no body).
  router.post('/login/start', async (_req, res, next) => {
    try {
      res.json(await remote.startDeviceFlow());
    } catch (err) {
      next(err);
    }
  });

  // POST /api/remote-account/login/poll — poll status; 400 NO_ACTIVE_FLOW if none.
  router.post('/login/poll', async (_req, res, next) => {
    try {
      res.json(await remote.pollDeviceFlow());
    } catch (err) {
      next(err);
    }
  });

  // POST /api/remote-account/logout — DELETE remote_session (idempotent).
  router.post('/logout', (_req, res, next) => {
    try {
      res.json(remote.logout());
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
