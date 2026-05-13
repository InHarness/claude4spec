import { Router } from 'express';
import type { TagsService } from '../services/tags.js';
import type { ReferencesService } from '../services/references.js';
import { errorHandler } from './errors.js';

export function tagsRouter(tags: TagsService, references: ReferencesService): Router {
  const router = Router();

  router.get('/', (_req, res, next) => {
    try {
      res.json({ tags: tags.list() });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', (req, res, next) => {
    try {
      res.status(201).json(tags.create(req.body));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:slug', (req, res, next) => {
    try {
      const tag = tags.getBySlug(req.params.slug);
      if (!tag) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'tag not found' } });
      res.json(tag);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:slug', async (req, res, next) => {
    try {
      const previousSlug = req.params.slug;
      const updated = tags.update(previousSlug, req.body);
      if (updated.slug !== previousSlug) {
        await references.propagateTagSlugChange(previousSlug, updated.slug);
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:slug', (req, res, next) => {
    try {
      res.json(tags.remove(req.params.slug));
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
