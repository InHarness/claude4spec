import { Router } from 'express';
import type { SectionsService } from '../services/sections.js';
import type { DiscoveryCore } from '../discovery/types.js';
import { DomainError } from '../services/tags.js';
import { errorHandler } from './errors.js';
import { boolFlag, commaList } from './query-params.js';
import { updateSections, type SectionEdit, type SectionWriteDeps } from '../services/page-write.js';

export function sectionsRouter(
  sections: SectionsService,
  discovery: DiscoveryCore,
  /**
   * 0.2.13: the write side, absent in the hand-rolled test rigs that mount this
   * router for its read routes alone. Optional rather than required so those
   * rigs keep compiling; a real project always passes it.
   */
  writeDeps?: SectionWriteDeps,
): Router {
  const router = Router();

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
      /**
       * ABSENT is refused here; EMPTY is passed to the core.
       *
       * The distinction matters because the core refuses an empty list with the
       * operative bounds in the message ("1..50"), and the caller who sent an
       * empty list is precisely the one who needs to be told what they are. A
       * transport that refused it first would answer the same mistake with less
       * information — which is why `c4s get-sections` does not refuse it either.
       */
      if (req.query.anchors === undefined) {
        throw new DomainError('VALIDATION', 'anchors query param required (comma-separated)');
      }
      const anchors = commaList(req.query.anchors) ?? [];
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

  /**
   * 0.2.13 (tier C-3) — the `rest` rendering of M06's only write.
   *
   * The one operation of the page-write family that had no REST route at all,
   * because it had no implementation at all: `SectionsService` wrote only to
   * propagate anchor renames. It is an adapter over `services/page-write.ts`,
   * the same function `page-tools` calls, so the two channels cannot disagree
   * about what a section edit is.
   *
   * 0.2.15 — the operation is `update_sections` and takes a BATCH, so its REST
   * rendering can no longer be `PUT /:anchor`: the anchor is inside the payload
   * now, once per edit, and a URL naming one of them would be naming an
   * arbitrary member of the set. `PUT /` addresses "the sections", which is what
   * the batch is.
   *
   * Declared before the `GET /:anchor` below. `PUT` on `/` could not shadow it
   * in any case — Express matches method first — but registration order is a
   * contract in this repo, and a reader checking it should not have to reason
   * about which routes are method-scoped.
   */
  router.put('/', async (req, res, next) => {
    try {
      if (!writeDeps) {
        throw new DomainError('NOT_IMPLEMENTED', 'this project mounts no writable page roots');
      }
      const body = (req.body ?? {}) as {
        expectedHash?: string;
        edits?: SectionEdit[];
        dropAnchors?: string[];
      };
      res.json(
        await updateSections(
          writeDeps,
          {
            expectedHash: body.expectedHash as string,
            edits: (body.edits ?? []) as SectionEdit[],
            ...(Array.isArray(body.dropAnchors) ? { dropAnchors: body.dropAnchors } : {}),
          },
          'user',
        ),
      );
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
