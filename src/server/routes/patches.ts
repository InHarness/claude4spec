/**
 * M23 — `POST /api/patches`, the `rest` rendering of the `file_patch` operation.
 *
 * ## Why this is not part of the generic artifact family
 *
 * Reading and updating a patch already generalizes: `GET/PUT/PATCH /api/artifacts/
 * patch/*` handles it alongside briefs and plans. CREATING one does not, because a
 * patch's provenance is DRIFT AGAINST A BRIEF. The route takes an intention —
 * which brief, what class of deviation, what actually drifted — and the server
 * composes the file. A generic "here is a finished artifact, store it" door would
 * have let a caller invent the frontmatter, and the frontmatter is the part that
 * makes a patch findable by the spec author.
 *
 * `POST /api/briefs` is the same shape of exception for the same reason, and is
 * the precedent this route follows.
 *
 * ## Why it matters beyond REST
 *
 * This route is the hard prerequisite for `c4s file-patch` losing its `fs-scoped`
 * execution mode. Until it existed, the CLI wrote the patch file itself, which
 * meant the `c4s` process needed a writable filesystem handle to the
 * specification — the last thing keeping it from being a pure HTTP client.
 *
 * ## Not idempotent, deliberately
 *
 * Two filings of the same drift produce two files: `desc` drives the slug, and a
 * second report of the same drift is a real event the spec author should see,
 * not a duplicate to swallow. There is no dedup key.
 */

import { Router } from 'express';
import type { PatchKind } from '../../core/briefs/types.js';
import { filePatch, type PatchWriteDeps } from '../services/patch-write.js';
import { errorHandler } from './errors.js';

export type PatchesRouterDeps = PatchWriteDeps;

/**
 * The wire shape of `POST /api/patches`.
 *
 * `brief` is a path RELATIVE to `briefsDir`, mirroring how briefs are addressed
 * everywhere else — portable across machines, unlike an absolute path.
 */
export interface PatchCreateRequest {
  /** Brief path relative to `briefsDir`. Must name a real file → else 404 BRIEF_NOT_FOUND. */
  brief: string;
  /** Concise description of the drift. Drives the file slug and the body heading. Empty → 400. */
  desc: string;
  /** Default `drift`. A value outside the dictionary → 400. */
  patchKind?: PatchKind;
  /** The patch body — what drifted, and what the spec author should consider changing. */
  body: string;
  /** Reporter identity. Defaults to the calling channel. */
  createdBy?: string;
}

export function patchesRouter(deps: PatchesRouterDeps): Router {
  const router = Router();

  router.post('/', (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Partial<PatchCreateRequest>;

      /**
       * Validation and the write both live in `services/patch-write.ts`, so this
       * handler is an adapter and nothing more. When the checks lived here, the
       * MCP rendering added below would have had to either copy them or be a
       * laxer door onto the same writer — REST and MCP must not be able to write
       * two different patch files from the same intent.
       *
       * The channel is the identity of last resort: a caller that does not say
       * who it is still leaves a truthful record of HOW it arrived.
       */
      const result = filePatch(deps, body, 'rest');

      /** 201 with the path relative to `patchesDir` — never the patch's own text. */
      res.status(201).json({ data: { path: result.path } });
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
