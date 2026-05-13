import { Router } from 'express';
import type { DatabaseTableService } from './services.js';
import type { ReferencesService } from '../../services/references.js';
import type { WsGateway } from '../../ws/gateway.js';
import { errorHandler } from '../../routes/errors.js';
import type {
  DatabaseTableCreateInput,
  DatabaseTableListQuery,
  DatabaseTableUpdateInput,
} from '../../../shared/entities.js';

export function databaseTablesRouter(
  service: DatabaseTableService,
  references: ReferencesService,
  ws: WsGateway
): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const q = req.query;
      const tags = typeof q.tags === 'string' ? q.tags.split(',').filter(Boolean) : undefined;
      const filter = q.tagFilter === 'and' || q.tagFilter === 'or' ? q.tagFilter : undefined;
      const query: DatabaseTableListQuery = {
        tags,
        tagFilter: filter,
        search: typeof q.search === 'string' ? q.search : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      };
      res.json({ databaseTables: service.list(query) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', (req, res, next) => {
    try {
      const body = req.body as DatabaseTableCreateInput;
      const { dbTable, warnings } = service.create(body, 'user');
      ws.broadcast({ kind: 'entity:changed', entityType: 'database-table', slug: dbTable.slug });
      res.status(201).json({ ...dbTable, warnings });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:slug', (req, res, next) => {
    try {
      const dbTable = service.getBySlug(req.params.slug);
      if (!dbTable)
        return res
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'database table not found' } });
      res.json(dbTable);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:slug', async (req, res, next) => {
    try {
      const body = req.body as DatabaseTableUpdateInput;
      const { dbTable, previousSlug, warnings } = service.update(
        req.params.slug,
        body,
        'user'
      );
      if (dbTable.slug !== previousSlug) {
        await references.propagateSlugChange('database-table', previousSlug, dbTable.slug);
        const { changedTables } = service.propagateFkSlugChange(
          previousSlug,
          dbTable.slug,
          'user'
        );
        for (const s of changedTables) {
          ws.broadcast({ kind: 'entity:changed', entityType: 'database-table', slug: s });
        }
      }
      ws.broadcast({ kind: 'entity:changed', entityType: 'database-table', slug: dbTable.slug });
      res.json({ ...dbTable, warnings });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:slug', async (req, res, next) => {
    try {
      const slug = req.params.slug;
      const broken = await references.findReferences('database-table', slug);
      const result = service.remove(
        slug,
        'user',
        broken.map((b) => ({
          pagePath: b.pagePath,
          tagType: b.tagType,
          line: b.line,
          slug,
          type: 'database-table' as const,
        }))
      );
      ws.broadcast({ kind: 'entity:changed', entityType: 'database-table', slug });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
