import { Router } from 'express';
import type { PatchService } from '../services/patch.js';
import type { PatchStatus } from '../../shared/entities.js';
import { DomainError } from '../services/tags.js';

/**
 * M23 REST routes (tag `m23-patches`). Path is splat (`/api/patches/<path>`)
 * so nested filenames are supported, consistent with `/api/pages/*` and
 * `/api/briefs/*`.
 */
export function patchesRouter(patches: PatchService): Router {
  const router = Router();

  // GET /api/patches?brief=<path>&status=awaiting|completed
  router.get('/', (req, res, next) => {
    try {
      const brief = typeof req.query.brief === 'string' ? req.query.brief : undefined;
      const status = parseStatusQuery(req.query.status);
      res.json({ data: patches.listPatches({ brief, status }) });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/patches/<path>/threads — "Change spec according to patch"
  router.post('/*/threads', async (req, res, next) => {
    try {
      const patchPath = extractPath(req.params);
      const body = (req.body ?? {}) as { name?: string };
      const result = await patches.createThreadForPatch(patchPath, body.name ?? null);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/patches/<path>/content — overwrite, optimistic concurrency
  router.put('/*/content', async (req, res, next) => {
    try {
      const patchPath = extractPath(req.params);
      const body = (req.body ?? {}) as { content?: string; expectedHash?: string };
      if (typeof body.content !== 'string') {
        throw new DomainError('VALIDATION', 'content is required');
      }
      if (typeof body.expectedHash !== 'string') {
        throw new DomainError('VALIDATION', 'expectedHash is required for patch content updates');
      }
      const out = await patches.updateContent({
        path: patchPath,
        content: body.content,
        expectedHash: body.expectedHash,
      });
      res.json({ data: out });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/patches/<path>/frontmatter — accepts ONLY `status`.
  router.patch('/*/frontmatter', async (req, res, next) => {
    try {
      const patchPath = extractPath(req.params);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const invalid = Object.keys(body).filter((k) => k !== 'status');
      if (invalid.length > 0) {
        throw new DomainError(
          'PATCH_FRONTMATTER_IMMUTABLE',
          `cannot mutate immutable frontmatter keys: ${invalid.join(', ')} (only 'status' is mutable via this endpoint)`,
        );
      }
      if (body.status !== 'awaiting' && body.status !== 'completed') {
        throw new DomainError('VALIDATION', "status must be 'awaiting' or 'completed'");
      }
      const out = await patches.updateFrontmatter({ path: patchPath, status: body.status });
      res.json({ data: out });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/patches/<path> — detail (must be LAST so the more specific
  // /*/threads, /*/content, /*/frontmatter routes match first).
  router.get('/*', async (req, res, next) => {
    try {
      const patchPath = extractPath(req.params);
      const patch = await patches.getPatch(patchPath);
      const threads = patches.listThreadsForPatch(patchPath);
      res.json({ data: { ...patch, threads } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function parseStatusQuery(raw: unknown): PatchStatus | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'awaiting' || raw === 'completed') return raw;
  throw new DomainError('VALIDATION', `?status must be 'awaiting' or 'completed' (omit for all)`);
}

/**
 * Express splat (`/*`) puts ONLY the matched wildcard portion in
 * `req.params[0]`. Literal segments (`/threads`, `/content`, …) are stripped.
 */
function extractPath(params: unknown): string {
  const splat = (params as Record<string, string>)[0];
  if (!splat) throw new DomainError('VALIDATION', 'missing patch path');
  return splat;
}
