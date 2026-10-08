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
export function sidebarAccordionsRouter(source: { listAccordions(): SidebarAccordion[] }): Router {
  const router = Router();
  router.get('/', (_req, res, next) => {
    try {
      res.json({ data: source.listAccordions() });
    } catch (err) {
      next(err);
    }
  });
  router.use(errorHandler);
  return router;
}
