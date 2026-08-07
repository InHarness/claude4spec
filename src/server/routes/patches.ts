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
import { writePatchFs } from '../../core/briefs/file-patch.js';
import type { PatchKind } from '../../core/briefs/types.js';
import { DomainError } from '../services/tags.js';
import { errorHandler } from './errors.js';

const PATCH_KINDS: readonly PatchKind[] = ['drift', 'missing', 'incorrect', 'clarification'];

export interface PatchesRouterDeps {
  briefsDirAbs: string;
  patchesDirAbs: string;
}

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

      // Validation is the route's own job — `writePatchFs` assumes a well-formed
      // request and answers only for the filesystem. Everything below is a
      // client bug, reported as such rather than as a write failure.
      if (typeof body.brief !== 'string' || body.brief.trim() === '') {
        throw new DomainError('VALIDATION', 'brief is required (path relative to briefsDir)');
      }
      if (typeof body.desc !== 'string' || body.desc.trim() === '') {
        throw new DomainError('VALIDATION', 'desc is required and must not be empty');
      }
      if (typeof body.body !== 'string' || body.body === '') {
        throw new DomainError('VALIDATION', 'body is required');
      }
      // Validated like every other field rather than trusted because it is
      // optional: `body.createdBy?.trim()` on a non-string threw a TypeError the
      // handler could not attribute, so a client bug surfaced as 500 INTERNAL
      // with a stack in the server log and no indication of which field was wrong.
      if (body.createdBy !== undefined && typeof body.createdBy !== 'string') {
        throw new DomainError('VALIDATION', 'createdBy must be a string when present');
      }
      const kind = body.patchKind ?? 'drift';
      if (!PATCH_KINDS.includes(kind)) {
        throw new DomainError(
          'VALIDATION',
          `patchKind must be one of ${PATCH_KINDS.join(' | ')} — got '${String(body.patchKind)}'`,
        );
      }

      /**
       * The same core writer the CLI has always used, unchanged: it asserts the
       * brief exists (→ BRIEF_NOT_FOUND), slugifies the WHOLE relative brief path
       * so two briefs sharing a filename in different subdirectories cannot
       * collide, creates `patchesDir` lazily, and writes the frontmatter
       * (`type: patch`, `brief`, `patch_kind`, `created_at`, `created_by`,
       * `status: awaiting`) under a `# Patch — <desc>` heading.
       *
       * Calling it rather than reimplementing it is the "one function per
       * operation" rule: REST and CLI must not be able to write two different
       * patch files from the same intent. Its `BriefFsError`s are mapped to HTTP
       * in `routes/errors.ts`.
       */
      const result = writePatchFs({
        briefsDirAbs: deps.briefsDirAbs,
        patchesDirAbs: deps.patchesDirAbs,
        briefRelPath: body.brief,
        desc: body.desc,
        kind,
        body: body.body,
        // The channel is the identity of last resort: a REST caller that does not
        // say who it is still leaves a truthful record of HOW it arrived.
        createdBy: body.createdBy?.trim() || 'rest',
      });

      /**
       * 201 with the path relative to `patchesDir`. No explicit indexing call:
       * `patchesDir` is already mounted as an `artifacts:patch` filesystem
       * source, so the watcher indexes the new file and captures it in
       * `file_version` by the same reaction that handles a hand-written one.
       */
      res.status(201).json({ data: { path: result.path } });
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
