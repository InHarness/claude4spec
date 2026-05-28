import { Router } from 'express';
import { readConfig } from '../config.js';
import {
  RemoteRequestError,
  RemoteUnauthorizedError,
} from '../services/remote-http-client.js';
import type { RemoteAuthService } from '../services/remote-auth.js';
import type { RemoteProjectInfo } from '../../shared/remote-project.js';
import { errorHandler } from './errors.js';

/**
 * M25/M26 — `GET /api/remote-project`. Local proxy over `GET /v1/projects/:id`
 * (M03) used by the M26 Settings "Remote project" section. NOT exposed via MCP
 * or CLI: linkage is a UI concept.
 *
 * Four-state response (brief §5):
 *  - 200 `{ linked: false, ... }`              — no `config.remoteProjectId`.
 *  - 200 `{ linked: true, fetched: false, reason: 'not_connected' }` — no M24 session.
 *  - 200 `{ linked: true, fetched: true, project }`                  — remote 200.
 *  - 200 `{ linked: true, fetched: false, reason: 'not_found' }`     — remote 404.
 *  - 502 SESSION_EXPIRED       — remote 401 (the auth service wipes the row).
 *  - 502 REMOTE_UNAVAILABLE    — transport / 5xx.
 */
export function remoteProjectRouter(remoteAuth: RemoteAuthService, cwd: string): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const config = readConfig(cwd);
      const remoteProjectId = config.remoteProjectId ?? null;
      if (remoteProjectId === null) {
        const body: RemoteProjectInfo = { linked: false, projectId: null, fetched: false };
        return res.json(body);
      }

      const account = remoteAuth.getCurrentAccount();
      if (!account.connected) {
        const body: RemoteProjectInfo = {
          linked: true,
          projectId: remoteProjectId,
          fetched: false,
          reason: 'not_connected',
        };
        return res.json(body);
      }

      try {
        const result = await remoteAuth.getRemoteProject(remoteProjectId);
        if (result.kind === 'not_found') {
          const body: RemoteProjectInfo = {
            linked: true,
            projectId: remoteProjectId,
            fetched: false,
            reason: 'not_found',
          };
          return res.json(body);
        }
        const body: RemoteProjectInfo = {
          linked: true,
          projectId: remoteProjectId,
          fetched: true,
          project: {
            name: result.project.name,
            createdAt: result.project.createdAt,
            ...(result.project.lastReleaseAt !== undefined
              ? { lastReleaseAt: result.project.lastReleaseAt }
              : {}),
            ...(result.project.owner !== undefined ? { owner: result.project.owner } : {}),
          },
        };
        return res.json(body);
      } catch (err) {
        if (err instanceof RemoteUnauthorizedError) {
          return res
            .status(502)
            .json({ error: { code: 'SESSION_EXPIRED', message: 'remote session expired' } });
        }
        if (err instanceof RemoteRequestError) {
          return res
            .status(502)
            .json({ error: { code: 'REMOTE_UNAVAILABLE', message: err.message } });
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
