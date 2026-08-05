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
 * They still answer with the whole updated endpoint, unwrapped — the shape
 * `endpointsApi.linkDto`/`unlinkDto` already expects — rather than the generated
 * router's `{ data }` envelope. That is deliberate for now: K3 re-expresses both
 * as generic collection writes when `EndpointService` is deleted, and moving the
 * envelope in the same commit as the service would put two unrelated reasons for
 * the client to change into one diff.
 */

import { Router } from 'express';
import type { EndpointService } from './services.js';
import { errorHandler } from '../../../host-kit/errors.js';

export function endpointsRouter(endpoints: EndpointService): Router {
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
      const updated = endpoints.linkDto(
        req.params.slug,
        body.dtoSlug,
        body.relation as 'request' | 'response' | 'error',
        statusCode
      );
      res.status(201).json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:slug/dtos/:dtoSlug/:relation', (req, res, next) => {
    try {
      const q = req.query.statusCode;
      const statusCode =
        typeof q === 'string' && q !== '' && Number.isInteger(Number(q)) ? Number(q) : null;
      const updated = endpoints.unlinkDto(
        req.params.slug,
        req.params.dtoSlug,
        req.params.relation as 'request' | 'response' | 'error',
        statusCode
      );
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
