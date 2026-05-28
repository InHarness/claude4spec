import { Router } from 'express';
import { readConfig } from '../config.js';
import {
  RemoteRequestError,
  RemoteUnauthorizedError,
} from '../services/remote-http-client.js';
import type { RemoteAuthService } from '../services/remote-auth.js';
import type {
  RemoteProjectInfo,
  UpdateRemoteProjectRequest,
} from '../../shared/remote-project.js';
import { errorHandler } from './errors.js';

/**
 * M25/M26 (0.1.32) — `/api/remote-project`.
 *
 * GET: local proxy over `GET /v1/projects/by-id/{uuid}`. Bearer optional. Surfaces
 * one of three scenarios (A linked:false / B owner / C non-owner) plus the 404
 * edge case C' (`reason: 'not_found'` — covers deleted project, foreign draft,
 * invalid UUID). Defense-in-depth: strips owner-only fields when isOwner=false.
 *
 * PATCH: local proxy over `PATCH /v1/projects/by-id/{uuid}`. Bearer required
 * (409 NOT_CONNECTED if missing). Local body validation (1..120 / 0..1000 /
 * at-least-one-field) runs before any peer call. 422 surfaces the offending
 * field when the peer envelope carries class-validator structure.
 */
export function remoteProjectRouter(remoteAuth: RemoteAuthService, cwd: string): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const config = readConfig(cwd);
      const remoteProjectId = config.remoteProjectId ?? null;
      if (remoteProjectId === null) {
        const body: RemoteProjectInfo = {
          linked: false,
          projectId: null,
          fetched: false,
          isOwner: false,
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
            isOwner: false,
            reason: 'not_found',
          };
          return res.json(body);
        }
        const p = result.project;
        const isOwner = p.isOwner === true;
        const body: RemoteProjectInfo = {
          linked: true,
          projectId: remoteProjectId,
          fetched: true,
          isOwner,
          project: {
            name: p.name,
            description: p.description ?? null,
            createdAt: p.createdAt,
            // Owner-only fields — strip locally if the peer accidentally returns
            // them for a non-owner. Forward only when isOwner is true.
            ...(isOwner && p.lastReleaseAt !== undefined ? { lastReleaseAt: p.lastReleaseAt } : {}),
            ...(isOwner && p.owner !== undefined ? { owner: p.owner } : {}),
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

  router.patch('/', async (req, res, next) => {
    try {
      const config = readConfig(cwd);
      const remoteProjectId = config.remoteProjectId ?? null;
      if (remoteProjectId === null) {
        return res
          .status(409)
          .json({ error: { code: 'NOT_CONNECTED', message: 'no remote project linked' } });
      }

      const account = remoteAuth.getCurrentAccount();
      if (!account.connected) {
        return res
          .status(409)
          .json({
            error: { code: 'NOT_CONNECTED', message: 'log in before editing the remote project' },
          });
      }

      const body = (req.body ?? {}) as UpdateRemoteProjectRequest;
      const localError = validatePatchBody(body);
      if (localError) {
        return res.status(422).json({ error: localError });
      }

      try {
        const project = await remoteAuth.updateRemoteProject(remoteProjectId, body);
        const isOwner = project.isOwner === true;
        const dto: RemoteProjectInfo = {
          linked: true,
          projectId: remoteProjectId,
          fetched: true,
          isOwner,
          project: {
            name: project.name,
            description: project.description ?? null,
            createdAt: project.createdAt,
            ...(isOwner && project.lastReleaseAt !== undefined
              ? { lastReleaseAt: project.lastReleaseAt }
              : {}),
            ...(isOwner && project.owner !== undefined ? { owner: project.owner } : {}),
          },
        };
        return res.json(dto);
      } catch (err) {
        if (err instanceof RemoteUnauthorizedError) {
          return res
            .status(502)
            .json({ error: { code: 'SESSION_EXPIRED', message: 'remote session expired' } });
        }
        if (err instanceof RemoteRequestError) {
          if (err.status === 403) {
            return res
              .status(403)
              .json({
                error: {
                  code: 'NOT_OWNER',
                  message: 'you are not the owner of this remote project',
                },
              });
          }
          if (err.status === 404) {
            return res
              .status(404)
              .json({
                error: {
                  code: 'REMOTE_PROJECT_NOT_FOUND',
                  message: 'remote project no longer exists',
                },
              });
          }
          if (err.status === 422) {
            const field = extractFieldFromPeer422(err.details);
            return res
              .status(422)
              .json({
                error: {
                  code: 'INVALID_BODY',
                  message: err.message,
                  ...(field ? { field } : {}),
                },
              });
          }
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

/**
 * Local-only validation — runs before any peer call. Returns the error
 * envelope (without status) when invalid; null when OK. `field` pinpoints the
 * input the UI should highlight inline.
 */
function validatePatchBody(
  body: UpdateRemoteProjectRequest,
): { code: 'INVALID_BODY'; message: string; field?: 'name' | 'description' } | null {
  const hasName = 'name' in body && body.name !== undefined;
  const hasDescription = 'description' in body && body.description !== undefined;
  if (!hasName && !hasDescription) {
    return { code: 'INVALID_BODY', message: 'body must include name or description' };
  }
  if (hasName) {
    if (typeof body.name !== 'string') {
      return { code: 'INVALID_BODY', message: 'name must be a string', field: 'name' };
    }
    if (body.name.length < 1 || body.name.length > 120) {
      return {
        code: 'INVALID_BODY',
        message: 'name must be 1..120 characters',
        field: 'name',
      };
    }
  }
  if (hasDescription) {
    if (body.description !== null && typeof body.description !== 'string') {
      return {
        code: 'INVALID_BODY',
        message: 'description must be a string or null',
        field: 'description',
      };
    }
    if (typeof body.description === 'string' && body.description.length > 1000) {
      return {
        code: 'INVALID_BODY',
        message: 'description must be at most 1000 characters',
        field: 'description',
      };
    }
  }
  return null;
}

/**
 * Best-effort: pull the offending property name out of a peer-spec 422 body.
 * NestJS class-validator emits `{ statusCode: 422, message: string[] | string }`
 * where each entry usually starts with the property name (e.g.
 * "name must be longer than..."). Without that hint we still surface the
 * message at form level; never throw here.
 */
function extractFieldFromPeer422(details: unknown): 'name' | 'description' | null {
  if (!details || typeof details !== 'object') return null;
  const msg = (details as { message?: unknown }).message;
  const candidates = Array.isArray(msg) ? msg : typeof msg === 'string' ? [msg] : [];
  for (const m of candidates) {
    if (typeof m !== 'string') continue;
    const lower = m.toLowerCase();
    if (lower.startsWith('name ') || lower.includes(' name ')) return 'name';
    if (lower.startsWith('description ') || lower.includes(' description ')) {
      return 'description';
    }
  }
  return null;
}
