import { Router } from 'express';
import type { SidebarAccordion } from '../../shared/types.js';
import { errorHandler } from './errors.js';

/**
 * 2.1.9 — `GET /api/sidebar-accordions` (M02 `jmh3f1fl`, endpoint
 * `get-api-sidebar-accordions`): the ordered accordion array of every root of
 * the project, in `{ data }` (DTO `sidebar-accordion`). Its own router — the
 * array spans all roots at once, so it has no `:rootId` segment. Read-only. The
 * order, the fallback and the result rules belong to the registry implementor
 * (`SidebarAccordionsService.listAccordions`). Lives behind the project prefix:
 * `/api/projects/:id/sidebar-accordions`.
 */
export function sidebarAccordionsRouter(source: {
  listAccordions(): SidebarAccordion[];
  /** Computes the reducer roots not computed yet (`SidebarAccordionsService.settle`). */
  settle?(): Promise<void>;
}): Router {
  const router = Router();
  router.get('/', async (_req, res, next) => {
    try {
      await source.settle?.();
      res.json({ data: source.listAccordions() });
    } catch (err) {
      next(err);
    }
  });
  router.use(errorHandler);
  return router;
}
