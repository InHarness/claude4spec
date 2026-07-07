import { Router } from 'express';
import type { DtoService } from './service.js';
import type { ReferencesService } from '../../services/references.js';
import { errorHandler } from '../../routes/errors.js';
import type {
  DtoCreateInput,
  DtoListQuery,
  DtoUpdateInput,
} from '../../../shared/entities.js';

export function dtosRouter(dtos: DtoService, references: ReferencesService): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const q = req.query;
      const tags = typeof q.tags === 'string' ? q.tags.split(',').filter(Boolean) : undefined;
      const filter = q.tagFilter === 'and' || q.tagFilter === 'or' ? q.tagFilter : undefined;
      const query: DtoListQuery = {
        tags,
        tagFilter: filter,
        search: typeof q.search === 'string' ? q.search : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      };
      res.json({ dtos: dtos.listRaw(query) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', (req, res, next) => {
    try {
      const body = req.body as DtoCreateInput;
      res.status(201).json(dtos.createRaw(body, 'user'));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:slug', (req, res, next) => {
    try {
      const dto = dtos.getBySlug(req.params.slug);
      if (!dto) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'dto not found' } });
      res.json(dto);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:slug', async (req, res, next) => {
    try {
      const body = req.body as DtoUpdateInput;
      const { dto, previousSlug } = dtos.updateRaw(req.params.slug, body, 'user');
      if (dto.slug !== previousSlug) {
        await references.propagateSlugChange('dto', previousSlug, dto.slug);
      }
      res.json(dto);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:slug', async (req, res, next) => {
    try {
      const broken = await references.findReferences('dto', req.params.slug);
      res.json(dtos.remove(req.params.slug, 'user', broken.map((b) => ({
        pagePath: b.pagePath,
        tagType: b.tagType,
        line: b.line,
        slug: req.params.slug,
        type: 'dto' as const,
      }))));
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
