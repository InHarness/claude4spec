import { Router } from 'express';
import type { AcService } from './services.js';
import type { ReferencesService } from '../../services/references.js';
import { errorHandler } from '../../routes/errors.js';
import type {
  AcCreateInput,
  AcKind,
  AcListQuery,
  AcStatus,
  AcUpdateInput,
} from '../../../shared/entities.js';

export function acsRouter(acs: AcService, references: ReferencesService): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const q = req.query;
      const tags = typeof q.tags === 'string' ? q.tags.split(',').filter(Boolean) : undefined;
      const filter = q.tagFilter === 'and' || q.tagFilter === 'or' ? q.tagFilter : undefined;
      const status = parseStatus(q.status);
      const kind = parseKind(q.kind);
      const query: AcListQuery = {
        ...(status !== undefined ? { status } : {}),
        ...(kind !== undefined ? { kind } : {}),
        tags,
        tagFilter: filter,
        search: typeof q.search === 'string' ? q.search : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      };
      res.json({ acs: acs.list(query) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', (req, res, next) => {
    try {
      const body = req.body as AcCreateInput;
      const ac = acs.create(body, 'user');
      const broken = ac.verifies.length ? acs.classifyVerifies(ac.verifies) : [];
      res.status(201).json({ ...ac, brokenVerifies: broken });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:slug', (req, res, next) => {
    try {
      const ac = acs.getBySlug(req.params.slug);
      if (!ac) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ac not found' } });
      const broken = ac.verifies.length ? acs.classifyVerifies(ac.verifies) : [];
      res.json({ ...ac, brokenVerifies: broken });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:slug', async (req, res, next) => {
    try {
      const body = req.body as AcUpdateInput;
      const { ac, previousSlug } = acs.update(req.params.slug, body, 'user');
      if (ac.slug !== previousSlug) {
        await references.propagateSlugChange('ac', previousSlug, ac.slug);
      }
      const broken = ac.verifies.length ? acs.classifyVerifies(ac.verifies) : [];
      res.json({ ...ac, brokenVerifies: broken });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:slug', async (req, res, next) => {
    try {
      const broken = await references.findReferences('ac', req.params.slug);
      res.json(
        acs.remove(
          req.params.slug,
          'user',
          broken.map((b) => ({
            pagePath: b.pagePath,
            tagType: b.tagType,
            line: b.line,
            slug: req.params.slug,
            type: 'ac' as const,
          })),
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}

function parseStatus(raw: unknown): AcStatus | 'all' | undefined {
  if (raw === 'all' || raw === 'active' || raw === 'deprecated') return raw;
  return undefined;
}

function parseKind(raw: unknown): AcKind | undefined {
  if (raw === 'requirement' || raw === 'edge-case') return raw;
  return undefined;
}
