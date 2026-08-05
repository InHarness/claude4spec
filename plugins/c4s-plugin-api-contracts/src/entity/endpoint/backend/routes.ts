/**
 * `endpoint`'s DOMAIN router — what is left after the host generated the rest.
 *
 * 2.0.0 tier K (item 58): list / create / get / patch / delete are gone; the
 * generated `/api/endpoints` router serves them from `endpoint`'s declaration,
 * as it does for every other type. These two routes stay because they are not
 * CRUD in disguise — they are a domain verb over the `linkedDtos` collection
 * ("this endpoint answers 404 with THAT DTO"), addressed by the relation rather
 * than by an index, so a client can add or drop one link without reading and
 * rewriting the whole array.
 *
 * WHAT THEY ANSWER CHANGED, and deliberately. They used to return the whole
 * updated endpoint, which the client seeded straight into its detail cache. That
 * made this file a SECOND spelling of "an endpoint, serialized" — one that had
 * to keep agreeing with `GET /api/endpoints/:slug` forever, in a plugin, with no
 * test comparing the two. It now answers `{ linked }` / `{ unlinked }`, the same
 * shape the equivalent MCP tools answer, and the client invalidates its detail
 * query so the refetch goes through the one canonical read.
 */

import { Router } from 'express';
import { errorHandler } from '../../../host-kit/errors.js';
import { linkDto, unlinkDto, type LinkDtoDeps } from './link-dto.js';

export function endpointsRouter(deps: LinkDtoDeps): Router {
  const router = Router();

  router.post('/:slug/dtos', (req, res, next) => {
    try {
      const body = req.body as { dtoSlug?: string; relation?: string; statusCode?: number | null };
      if (!body.dtoSlug || !body.relation) {
        return res
          .status(400)
          .json({ error: { code: 'VALIDATION', message: 'dtoSlug and relation required' } });
      }
      const statusCode =
        typeof body.statusCode === 'number' && Number.isInteger(body.statusCode)
          ? body.statusCode
          : null;
      linkDto(deps, req.params.slug, body.dtoSlug, body.relation as 'request' | 'response' | 'error', statusCode);
      res.status(201).json({ linked: true });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:slug/dtos/:dtoSlug/:relation', (req, res, next) => {
    try {
      const q = req.query.statusCode;
      const statusCode =
        typeof q === 'string' && q !== '' && Number.isInteger(Number(q)) ? Number(q) : null;
      unlinkDto(
        deps,
        req.params.slug,
        req.params.dtoSlug,
        req.params.relation as 'request' | 'response' | 'error',
        statusCode,
      );
      res.json({ unlinked: true });
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
