import { Router } from 'express';
import type { SectionsService } from '../services/sections.js';
import { errorHandler } from './errors.js';

export function sectionsRouter(sections: SectionsService): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const pagePath = typeof req.query.pagePath === 'string' ? req.query.pagePath : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const list = sections.list({ pagePath, search });
      res.json({ sections: list });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:anchor', (req, res, next) => {
    try {
      const row = sections.getByAnchor(req.params.anchor);
      if (!row)
        return res
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'section not found' } });
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
