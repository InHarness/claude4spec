import { Router } from 'express';
import type { TagsService } from '../services/tags.js';
import type { ReferencesService } from '../services/references.js';
import type { DiscoveryCore } from '../discovery/types.js';
import { errorHandler } from './errors.js';

/** `?limit=12` → 12; absent, empty, non-numeric or non-positive → undefined. */
function positiveInt(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function tagsRouter(
  tags: TagsService,
  references: ReferencesService,
  discovery: DiscoveryCore,
): Router {
  const router = Router();

  /**
   * 0.2.13 — the `rest` rendering of `list_tags` gains paging, which the core
   * has had all along (`ListTagsInput.limit/offset`) and this route did not
   * expose. `TagsService.list()` returns the whole array with no `total`, so a
   * REST caller had no way to page and no way to know whether it had everything.
   *
   * Additive on purpose. The `{ tags }` key is unchanged, so
   * `src/client/lib/api.ts` is untouched; `total` appears beside it.
   *
   * A request that names NO window keeps returning every tag. This is the same
   * reasoning written out at `generated-crud-router.ts` for entity lists: the
   * core's page size is right for an agent reading over stdio and wrong for a UI
   * that renders a tag picker and never looks at `total`. Silently truncating
   * that picker at the core's default would drop tags nobody asked to hide.
   */
  router.get('/', (req, res, next) => {
    try {
      const limit = positiveInt(req.query.limit);
      const offset = positiveInt(req.query.offset);
      if (limit === undefined && offset === undefined) {
        const all = tags.list();
        return res.json({ tags: all, total: all.length });
      }
      const page = discovery.listTags({
        ...(limit !== undefined ? { limit } : {}),
        ...(offset !== undefined ? { offset } : {}),
      });
      res.json({ tags: page.items, total: page.total });
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
