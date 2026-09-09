import { Router } from 'express';
import { DomainError } from '../services/tags.js';
import { errorHandler } from './errors.js';
import type { ProjectionId, ProjectionStatusRegistry } from '../services/projection-status.js';

/**
 * 0.2.77 (M26) — the settings module's FIRST routes of its own.
 *
 * Until now M26 was a shell over other modules' endpoints, and that worked for
 * everything it displayed. It cannot work here: no single projection owner can
 * answer "how is every projection doing" — M06 holds the section index, M29 holds
 * the entity tables and the release cache, M14 the link map — so the aggregate
 * has to belong to whoever renders it.
 *
 * `_meta` is the reserved prefix for diagnostics, and the per-project variant
 * follows the M33 plugin-pool precedent: the state of a projection belongs to a
 * PROJECT's context, not to the process.
 *
 * This is also the first NAMED route to a manual reindex in the product. Until
 * now a rebuild was triggered de facto by `PATCH /api/config` with no change of
 * content, as a side effect of context invalidation. That side effect STAYS —
 * these routes are an addition, not a replacement.
 */
export function indexStatusRouter(status: ProjectionStatusRegistry): Router {
  const router = Router();

  /**
   * Strictly diagnostic and strictly read-only: it rebuilds nothing and triggers
   * no reaction. A status route that repaired what it looked at could not be used
   * to observe a problem.
   */
  router.get('/', (_req, res) => {
    res.json({ projections: status.snapshot() });
  });

  /**
   * IDEMPOTENT, and explicitly allowed against a projection that is already
   * `fresh` — the button exists so a user who suspects something can check, and
   * one that refused when all looked well could not be used for that.
   *
   * No body (or no `projection`) means rebuild everything.
   */
  router.post('/rebuild', async (req, res, next) => {
    const requested = (req.body ?? {}).projection as string | undefined;
    try {
      if (requested === undefined || requested === null) {
        const results = await status.rebuildAll();
        res.json({ rebuilt: results, projections: status.snapshot() });
        return;
      }
      if (!status.ids().includes(requested as ProjectionId)) {
        throw new DomainError(
          'INVALID_ARGUMENT',
          `unknown projection '${requested}'`,
          `known projections: ${status.ids().join(', ')}`,
        );
      }
      // A request landing on a projection that is ALREADY rebuilding does not
      // start a second pass — it waits for the one in flight and answers with its
      // result. Two concurrent full rebuilds of one projection would race each
      // other's writes for nothing.
      await status.rebuild(requested as ProjectionId);
      res.json({ rebuilt: [{ id: requested }], projections: status.snapshot() });
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
