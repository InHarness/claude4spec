import { Router } from 'express';
import type { SectionsService } from '../services/sections.js';
import type { DiscoveryCore } from '../discovery/types.js';
import { DomainError } from '../services/tags.js';
import { errorHandler } from './errors.js';
import { boolFlag, commaList, nonNegativeInt, positiveInt } from './query-params.js';

export function sectionsRouter(sections: SectionsService, discovery: DiscoveryCore): Router {
  const router = Router();

  /**
   * 0.2.13 (tier C) — the `rest` rendering of `list_sections`.
   *
   * A different question from `GET /` below, not a paged version of it. That one
   * lists the sections of a page path with an optional text filter, for the UI;
   * this is the core operation, which asks EITHER "the sections of this page"
   * (`by=page`, keyed by `(rootId, path)` — a path alone is ambiguous across
   * roots) OR "the subtree below this section" (`by=anchor`).
   *
   * The `by=anchor` arm carries `is_known` from the core, and that is part of the
   * answer: an empty list means "this well-formed anchor is not in the index",
   * which calls for a different next move than "this section has no children".
   *
   * Static segment, ahead of `/:anchor` — otherwise `list` is read as an anchor.
   */
  router.get('/list', async (req, res, next) => {
    try {
      const by = req.query.by === 'anchor' ? 'anchor' : req.query.by === 'page' ? 'page' : null;
      if (!by) {
        throw new DomainError('VALIDATION', "by query param required: 'page' or 'anchor'");
      }
      const paging = {
        ...(positiveInt(req.query.limit) !== undefined ? { limit: positiveInt(req.query.limit) } : {}),
        ...(nonNegativeInt(req.query.offset) !== undefined ? { offset: nonNegativeInt(req.query.offset) } : {}),
      };
      if (by === 'anchor') {
        const anchor = typeof req.query.anchor === 'string' ? req.query.anchor : '';
        if (!anchor) throw new DomainError('VALIDATION', 'anchor query param required for by=anchor');
        return res.json(await discovery.listSections({ by: 'anchor', anchor, ...paging }));
      }
      const rootId = typeof req.query.rootId === 'string' ? req.query.rootId : '';
      const path = typeof req.query.path === 'string' ? req.query.path : '';
      if (!rootId || !path) {
        throw new DomainError('VALIDATION', 'rootId and path query params required for by=page');
      }
      res.json(await discovery.listSections({ by: 'page', rootId, path, ...paging }));
    } catch (err) {
      next(err);
    }
  });

  /**
   * 0.2.13 (tier C) — the `rest` rendering of `get_sections`: the bodies of
   * several sections in ONE call.
   *
   * Fetch by key, so it takes no window — the caller named the rows and the valve
   * is the core's response budget. **An unknown anchor errors inside its own
   * item and the call still succeeds**: the other anchors in the batch are real
   * answers, and a 404 for the whole call would throw them away. That is why the
   * `cli` rendering of this operation keeps exit code 0 on a bad anchor, and the
   * two channels have to agree.
   *
   * Static segment, ahead of `/:anchor`.
   */
  router.get('/get', async (req, res, next) => {
    try {
      const anchors = commaList(req.query.anchors);
      if (!anchors || anchors.length === 0) {
        throw new DomainError('VALIDATION', 'anchors query param required (comma-separated)');
      }
      const includeSubtree = boolFlag(req.query.includeSubtree);
      res.json(await discovery.getSections({ anchors, ...(includeSubtree ? { includeSubtree } : {}) }));
    } catch (err) {
      next(err);
    }
  });

  router.get('/', (req, res, next) => {
    try {
      const pagePath = typeof req.query.pagePath === 'string' ? req.query.pagePath : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const list = sections.list({ pagePath, search });
      res.json({ sections: list });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:anchor', (req, res, next) => {
    try {
      const row = sections.getByAnchor(req.params.anchor);
      if (!row)
        return res
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'section not found' } });
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
