import { Router } from 'express';
import type { EndpointService } from './services.js';
import type { ReferencesService } from '../../services/references.js';
import { errorHandler } from '../../routes/errors.js';
import type {
  EndpointCreateInput,
  EndpointListQuery,
  EndpointUpdateInput,
} from '../../../shared/entities.js';

export function endpointsRouter(endpoints: EndpointService, references: ReferencesService): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const q = req.query;
      const tags = typeof q.tags === 'string' ? q.tags.split(',').filter(Boolean) : undefined;
      const filter = q.tagFilter === 'and' || q.tagFilter === 'or' ? q.tagFilter : undefined;
      const query: EndpointListQuery = {
        tags,
        tagFilter: filter,
        search: typeof q.search === 'string' ? q.search : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      };
      res.json({ endpoints: endpoints.list(query) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', (req, res, next) => {
    try {
      const body = req.body as EndpointCreateInput;
      res.status(201).json(endpoints.create(body, 'user'));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:slug', (req, res, next) => {
    try {
      const ep = endpoints.getBySlug(req.params.slug);
      if (!ep) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'endpoint not found' } });
      res.json(ep);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:slug', async (req, res, next) => {
    try {
      const body = req.body as EndpointUpdateInput;
      const previousSlug = req.params.slug;
      const updated = endpoints.update(previousSlug, body, 'user');
      if (updated.slug !== previousSlug) {
        await references.propagateSlugChange('endpoint', previousSlug, updated.slug);
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

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

  router.delete('/:slug', async (req, res, next) => {
    try {
      const slug = req.params.slug;
      const broken = await references.findReferences('endpoint', slug);
      const result = endpoints.remove(slug, 'user');
      result.brokenReferences = broken.map((b) => ({
        pagePath: b.pagePath,
        tagType: b.tagType,
        line: b.line,
        slug,
        type: 'endpoint' as const,
      }));
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
