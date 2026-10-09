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
      // 2.1.11: the release is addressed by name; an unknown one is a 404.
      const body = (req.body ?? {}) as { releaseName?: unknown };
      const releaseName = body.releaseName;
      if (typeof releaseName !== 'string' || releaseName === '') {
        return res
          .status(400)
          .json({ error: { code: 'VALIDATION', message: 'releaseName (string) is required' } });
      }
      const result = await service.push(releaseName);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/release-pushes?releaseName=<name> — audit log, optionally filtered;
  // an unknown name answers an empty list.
  router.get('/', (req, res, next) => {
    try {
      const raw = req.query.releaseName;
      if (raw !== undefined) {
        if (typeof raw !== 'string') {
          return res
            .status(400)
            .json({ error: { code: 'VALIDATION', message: 'releaseName must be a single string' } });
        }
        return res.json({ items: service.listForRelease(raw) });
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
