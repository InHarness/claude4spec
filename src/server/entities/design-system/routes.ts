import { Router } from 'express';
import type { DesignSystemService } from './services.js';
import type { ReferencesService } from '../../services/references.js';
import type { WsEmitter } from '../../ws/project-emitter.js';
import { errorHandler } from '../../routes/errors.js';
import type {
  DesignSystemCreateInput,
  DesignSystemListQuery,
  DesignSystemUpdateInput,
} from '../../../shared/entities.js';

export function designSystemsRouter(
  service: DesignSystemService,
  references: ReferencesService,
  ws: WsEmitter
): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const q = req.query;
      const tags = typeof q.tags === 'string' ? q.tags.split(',').filter(Boolean) : undefined;
      const filter = q.tagFilter === 'and' || q.tagFilter === 'or' ? q.tagFilter : undefined;
      const query: DesignSystemListQuery = {
        tags,
        tagFilter: filter,
        search: typeof q.search === 'string' ? q.search : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      };
      res.json({ designSystems: service.list(query) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', (req, res, next) => {
    try {
      const body = req.body as DesignSystemCreateInput;
      const { designSystem, warnings } = service.create(body, 'user');
      ws.broadcast({ kind: 'entity:changed', entityType: 'design-system', slug: designSystem.slug });
      res.status(201).json({ ...designSystem, warnings });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:slug', (req, res, next) => {
    try {
      const ds = service.getBySlug(req.params.slug);
      if (!ds)
        return res
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'design system not found' } });
      res.json(ds);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:slug', async (req, res, next) => {
    try {
      const body = req.body as DesignSystemUpdateInput;
      const { designSystem, previousSlug, warnings } = service.update(
        req.params.slug,
        body,
        'user'
      );
      if (designSystem.slug !== previousSlug) {
        await references.propagateSlugChange('design-system', previousSlug, designSystem.slug);
      }
      ws.broadcast({ kind: 'entity:changed', entityType: 'design-system', slug: designSystem.slug });
      res.json({ ...designSystem, warnings });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:slug', async (req, res, next) => {
    try {
      const slug = req.params.slug;
      const broken = await references.findReferences('design-system', slug);
      const result = service.remove(
        slug,
        'user',
        broken.map((b) => ({
          pagePath: b.pagePath,
          tagType: b.tagType,
          line: b.line,
          slug,
          type: 'design-system' as const,
        }))
      );
      ws.broadcast({ kind: 'entity:changed', entityType: 'design-system', slug });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // NOTE: §1.6 lists `POST /:slug/restore`, but in this codebase version/release
  // restore is centralized in the releases router (`/releases/:idOrName/restore`),
  // not per-entity — mirroring every other entity (ui-view, dto, …) which expose
  // no per-slug restore route. See .claude4spec/patches for the recorded drift.

  router.use(errorHandler);
  return router;
}
