import { Router } from 'express';
import type { TagsService } from '../services/tags.js';
import type { ReferencesService } from '../services/references.js';
import type { DiscoveryCore } from '../discovery/types.js';
import { errorHandler } from './errors.js';
import { boolFlag, nonNegativeInt, positiveInt } from './query-params.js';

export function tagsRouter(
  tags: TagsService,
  references: ReferencesService,
  discovery: DiscoveryCore,
): Router {
  const router = Router();

  /**
   * 0.2.13 (tier C) — the `rest` rendering of `list_tags`, the CORE projection.
   *
   * The route below deliberately does not answer this. Its own comment already
   * settled why: the core's `TagListItem` is narrower (`slug`, `name`, `color`,
   * `description`, OPTIONAL `counts`) than the `Tag` DTO the UI is typed
   * against (`counts` required, plus `createdAt`/`updatedAt`), and the two order
   * differently — by slug here, by name there. Serving both shapes from one path
   * would make `TagsList.tsx` throw the moment anything paged. So the core's
   * projection is a separate segment, exactly as that comment predicted it would
   * have to be.
   *
   * `withCounts` is OPT-IN here, as it is in every other channel: per-type counts
   * are a product over tags × types, and a caller listing tag names should not
   * pay for them.
   *
   * Static segment, ahead of `/:slug` — a tag literally named `list` must not be
   * able to shadow it.
   */
  router.get('/list', (req, res, next) => {
    try {
      const minCount = positiveInt(req.query.minCount);
      const coOccurringWith =
        typeof req.query.coOccurringWith === 'string' && req.query.coOccurringWith !== ''
          ? req.query.coOccurringWith
          : undefined;
      const withCounts = boolFlag(req.query.withCounts);
      res.json(
        discovery.listTags({
          ...(withCounts ? { withCounts } : {}),
          ...(minCount !== undefined ? { minCount } : {}),
          ...(coOccurringWith !== undefined ? { coOccurringWith } : {}),
          ...(positiveInt(req.query.limit) !== undefined ? { limit: positiveInt(req.query.limit) } : {}),
          ...(nonNegativeInt(req.query.offset) !== undefined ? { offset: nonNegativeInt(req.query.offset) } : {}),
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  /**
   * 0.2.13 — the `rest` rendering of `list_tags` gains paging, which the core
   * has had all along (`ListTagsInput.limit/offset`) and this route did not
   * expose. `TagsService.list()` returned the whole array with no `total`, so a
   * REST caller had no way to page and no way to know whether it had everything.
   *
   * Additive on purpose: the `{ tags }` key is unchanged, so
   * `src/client/lib/api.ts` is untouched, and `total` appears beside it.
   *
   * ## Why the window is applied HERE and not by the core
   *
   * The obvious implementation — hand `limit`/`offset` to `discovery.listTags`
   * — quietly changes what a tag IS. The core's `TagListItem` is a narrower
   * projection (`slug`, `name`, `color`, `description`, optional `counts`) than
   * the `Tag` this route has always returned, which additionally carries
   * `counts` as REQUIRED plus `createdAt`/`updatedAt`; and the core orders by
   * slug where the service orders by name. So the paged request and the unpaged
   * one would answer with different item shapes AND different orderings for the
   * same logical query — and since `counts` is required in the published DTO,
   * `TagsList.tsx` (`tag.counts[m.type] ?? 0`) and `useEntityListQuery.ts` would
   * throw a TypeError the moment anything started paging.
   *
   * One shape, one ordering, sliced. If the core's projection is ever what a
   * caller wants, that is a different `view`, not a side effect of asking for a
   * page.
   *
   * A request naming NO window still returns every tag — same reasoning as
   * `generated-crud-router.ts` for entity lists: the core's default page size is
   * right for an agent reading over stdio and wrong for a UI that renders a tag
   * picker and never looks at `total`.
   */
  router.get('/', (req, res, next) => {
    try {
      const limit = positiveInt(req.query.limit);
      const offset = positiveInt(req.query.offset);
      const all = tags.list();
      if (limit === undefined && offset === undefined) {
        return res.json({ tags: all, total: all.length });
      }
      const start = offset ?? 0;
      const window = limit === undefined ? all.slice(start) : all.slice(start, start + limit);
      res.json({ tags: window, total: all.length });
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
