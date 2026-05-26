import { Router } from 'express';
import { DomainError } from '../services/tags.js';
import type { ReleasePushService } from '../services/release-push.js';

/**
 * M25 — `/api/release-pushes/*`. Own prefix (exception to the L4 convention,
 * analogous to `/api/remote-account/*`). Error mapping (via the global handler):
 * gate → 409 NOT_CONNECTED / 409 ACCOUNT_NOT_ACTIVE, missing release →
 * 404 RELEASE_NOT_FOUND, remote 401 → 502 SESSION_EXPIRED, other remote/network
 * → 502 PUSH_FAILED, unknown row → 404 RELEASE_PUSH_NOT_FOUND.
 */
export function releasePushesRouter(service: ReleasePushService): Router {
  const router = Router();

  // POST /api/release-pushes — synchronous push.
  router.post('/', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { releaseId?: unknown };
      const releaseId = body.releaseId;
      if (typeof releaseId !== 'number' || !Number.isInteger(releaseId)) {
        return res
          .status(400)
          .json({ error: { code: 'VALIDATION', message: 'releaseId (integer) is required' } });
      }
      const result = await service.push(releaseId);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/release-pushes?releaseId=<n> — audit log, optionally filtered.
  router.get('/', (req, res, next) => {
    try {
      const raw = req.query.releaseId;
      if (raw !== undefined) {
        const releaseId = Number(raw);
        if (!Number.isInteger(releaseId)) {
          return res
            .status(400)
            .json({ error: { code: 'VALIDATION', message: 'releaseId must be an integer' } });
        }
        return res.json({ items: service.listForRelease(releaseId) });
      }
      res.json({ items: service.listAll() });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/release-pushes/:id — single audit row.
  router.get('/:id', (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        return res
          .status(400)
          .json({ error: { code: 'VALIDATION', message: 'id must be an integer' } });
      }
      const row = service.getById(id);
      if (!row) throw new DomainError('RELEASE_PUSH_NOT_FOUND', `release push '${id}' not found`);
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
