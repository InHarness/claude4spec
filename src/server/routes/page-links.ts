import { Router } from 'express';
import type { PagesLinkIndexerService } from '../services/pages-link-indexer.js';
import { errorHandler } from './errors.js';

export function pageLinksRouter(indexer: PagesLinkIndexerService): Router {
  const router = Router();

  router.get('/', (_req, res, next) => {
    try {
      res.json({
        links: indexer.allLinks(),
        reverseLinks: indexer.allReverseLinks(),
        unresolved: indexer.allUnresolved(),
        counts: indexer.counts(),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/counts', (_req, res, next) => {
    try {
      res.json(indexer.counts());
    } catch (err) {
      next(err);
    }
  });

  router.get('/autocomplete', (req, res, next) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : NaN;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 10;
      res.json({ suggestions: indexer.autocomplete(q, limit) });
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
