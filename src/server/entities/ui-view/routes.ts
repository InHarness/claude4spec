import { Router } from 'express';
import type { UiViewService } from './services.js';
import type { ReferencesService } from '../../services/references.js';
import type { WsGateway } from '../../ws/gateway.js';
import { errorHandler } from '../../routes/errors.js';
import type {
  UiViewCreateInput,
  UiViewListQuery,
  UiViewUpdateInput,
} from '../../../shared/entities.js';

export function uiViewsRouter(
  service: UiViewService,
  references: ReferencesService,
  ws: WsGateway
): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const q = req.query;
      const tags = typeof q.tags === 'string' ? q.tags.split(',').filter(Boolean) : undefined;
      const filter = q.tagFilter === 'and' || q.tagFilter === 'or' ? q.tagFilter : undefined;
      const query: UiViewListQuery = {
        tags,
        tagFilter: filter,
        search: typeof q.search === 'string' ? q.search : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      };
      res.json({ uiViews: service.list(query) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', (req, res, next) => {
    try {
      const body = req.body as UiViewCreateInput;
      const { uiView, warnings } = service.create(body, 'user');
      ws.broadcast({ kind: 'entity:changed', entityType: 'ui-view', slug: uiView.slug });
      res.status(201).json({ ...uiView, warnings });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:slug', (req, res, next) => {
    try {
      const uiView = service.getBySlug(req.params.slug);
      if (!uiView)
        return res
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'ui view not found' } });
      res.json(uiView);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:slug', async (req, res, next) => {
    try {
      const body = req.body as UiViewUpdateInput;
      const { uiView, previousSlug, warnings } = service.update(
        req.params.slug,
        body,
        'user'
      );
      if (uiView.slug !== previousSlug) {
        await references.propagateSlugChange('ui-view', previousSlug, uiView.slug);
      }
      ws.broadcast({ kind: 'entity:changed', entityType: 'ui-view', slug: uiView.slug });
      res.json({ ...uiView, warnings });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:slug', async (req, res, next) => {
    try {
      const slug = req.params.slug;
      const broken = await references.findReferences('ui-view', slug);
      const result = service.remove(
        slug,
        'user',
        broken.map((b) => ({
          pagePath: b.pagePath,
          tagType: b.tagType,
          line: b.line,
          slug,
          type: 'ui-view' as const,
        }))
      );
      ws.broadcast({ kind: 'entity:changed', entityType: 'ui-view', slug });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
