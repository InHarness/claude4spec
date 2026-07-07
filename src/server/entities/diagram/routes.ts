import { Router } from 'express';
import type { DiagramService } from './service.js';
import { validateDiagramSource } from './validate.js';
import type { ReferencesService } from '../../services/references.js';
import type { WsEmitter } from '../../ws/project-emitter.js';
import { errorHandler } from '../../routes/errors.js';
import type {
  DiagramCreateInput,
  DiagramListQuery,
  DiagramUpdateInput,
} from '../../../shared/entities.js';

export function diagramsRouter(
  service: DiagramService,
  references: ReferencesService,
  ws: WsEmitter
): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const q = req.query;
      const tags = typeof q.tags === 'string' ? q.tags.split(',').filter(Boolean) : undefined;
      const filter = q.tagFilter === 'and' || q.tagFilter === 'or' ? q.tagFilter : undefined;
      const query: DiagramListQuery = {
        tags,
        tagFilter: filter,
        search: typeof q.search === 'string' ? q.search : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      };
      res.json({ diagrams: service.listRaw(query) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const body = req.body as DiagramCreateInput;
      const diagram = service.createRaw(body, 'user');
      const warnings = await validateDiagramSource(diagram.format, diagram.source);
      ws.broadcast({ kind: 'entity:changed', entityType: 'diagram', slug: diagram.slug });
      res.status(201).json({ ...diagram, warnings });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:slug', (req, res, next) => {
    try {
      const diagram = service.getBySlug(req.params.slug);
      if (!diagram)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'diagram not found' } });
      res.json(diagram);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:slug', async (req, res, next) => {
    try {
      const body = req.body as DiagramUpdateInput;
      const { diagram, previousSlug } = service.updateRaw(req.params.slug, body, 'user');
      if (diagram.slug !== previousSlug) {
        await references.propagateSlugChange('diagram', previousSlug, diagram.slug);
      }
      const warnings = await validateDiagramSource(diagram.format, diagram.source);
      ws.broadcast({ kind: 'entity:changed', entityType: 'diagram', slug: diagram.slug });
      res.json({ ...diagram, warnings });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:slug', async (req, res, next) => {
    try {
      const slug = req.params.slug;
      const broken = await references.findReferences('diagram', slug);
      const result = service.remove(
        slug,
        'user',
        broken.map((b) => ({
          pagePath: b.pagePath,
          tagType: b.tagType,
          line: b.line,
          slug,
          type: 'diagram' as const,
        }))
      );
      ws.broadcast({ kind: 'entity:changed', entityType: 'diagram', slug });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
