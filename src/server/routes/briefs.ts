import { Router } from 'express';
import type { BriefService } from '../services/brief.js';
import type { PageVersionService } from '../services/page-version.js';
import { DomainError } from '../services/tags.js';
import { BRIEF_ROOT_MARKER } from '../../shared/types.js';

/**
 * M21 REST routes. Path is splat (`/api/briefs/<path>`) so nested filenames
 * (rare for briefs, but consistent with `/api/pages/*`) are supported.
 */
export function briefsRouter(
  briefs: BriefService,
  pageVersions: PageVersionService,
): Router {
  const router = Router();

  // POST /api/briefs — create
  router.post('/', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as {
        fromReleaseName?: string | null;
        toReleaseName?: string;
        additionalPrompt?: string;
        suffix?: string;
        roots?: string[];
      };
      // `fromReleaseName === null` ⇒ initial brief (no previous release).
      const fromIsValid =
        body.fromReleaseName === null || typeof body.fromReleaseName === 'string';
      if (!fromIsValid || typeof body.toReleaseName !== 'string') {
        throw new DomainError(
          'VALIDATION',
          'toReleaseName is required (string); fromReleaseName must be string or null',
        );
      }
      // 0.1.96 (M21/L13) brief scope: an array of root ids the brief covers.
      // Absent / empty ⇒ whole-release (createBrief omits the `roots` frontmatter
      // + slug segment). A non-array or non-string entry is a client bug → 400.
      let roots: string[] | undefined;
      if (body.roots !== undefined) {
        if (!Array.isArray(body.roots) || body.roots.some((r) => typeof r !== 'string')) {
          throw new DomainError('VALIDATION', 'roots must be an array of root id strings');
        }
        roots = body.roots.length > 0 ? body.roots : undefined;
      }
      // 0.1.69: file-only createBrief + createThreadForBrief — the UI "New brief"
      // action still gets its initial editorial thread. `additionalPrompt` is a
      // client concern (appended to the first user message after redirect), not
      // persisted server-side.
      const { briefPath } = await briefs.createBrief({
        fromReleaseName: body.fromReleaseName ?? null,
        toReleaseName: body.toReleaseName,
        suffix: typeof body.suffix === 'string' ? body.suffix : undefined,
        roots,
      });
      const fromName = body.fromReleaseName ?? null;
      const threadTitle = fromName === null
        ? `Initial brief: ${body.toReleaseName}`
        : `Brief: ${fromName} → ${body.toReleaseName}`;
      const { threadId } = briefs.createThreadForBrief({ path: briefPath, name: threadTitle });
      res.json({ data: { briefPath, initialThreadId: threadId } });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/briefs?implemented=true|false (omit param = all, default)
  router.get('/', (req, res, next) => {
    try {
      const implementedParam = req.query.implemented;
      let implemented: boolean | undefined;
      if (implementedParam === undefined) {
        implemented = undefined;
      } else if (implementedParam === 'true') {
        implemented = true;
      } else if (implementedParam === 'false') {
        implemented = false;
      } else {
        throw new DomainError(
          'VALIDATION',
          `?implemented must be 'true' or 'false' (omit for all)`,
        );
      }
      const list = briefs.listBriefs({ implemented });
      res.json({ data: list });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/briefs/<path>/versions
  router.get('/*/versions', (req, res, next) => {
    try {
      const briefPath = extractPath(req.params);
      const versions = pageVersions.listVersions(briefPath, BRIEF_ROOT_MARKER);
      res.json({ data: versions });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/briefs/<path>/versions/:version
  router.get('/*/versions/:version', (req, res, next) => {
    try {
      const version = Number(req.params.version);
      if (!Number.isInteger(version) || version <= 0) {
        throw new DomainError('VALIDATION', 'version must be a positive integer');
      }
      const briefPath = extractPath(req.params);
      const detail = pageVersions.getVersion(briefPath, version, BRIEF_ROOT_MARKER);
      if (!detail) throw new DomainError('VERSION_NOT_FOUND', `version ${version} not found`);
      res.json({ data: detail });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/briefs/<path>/threads
  router.post('/*/threads', (req, res, next) => {
    try {
      const briefPath = extractPath(req.params);
      const body = (req.body ?? {}) as { name?: string };
      const result = briefs.createThreadForBrief({ path: briefPath, name: body.name ?? null });
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/briefs/<path>/threads
  router.get('/*/threads', (req, res, next) => {
    try {
      const briefPath = extractPath(req.params);
      res.json({ data: briefs.listThreadsForBrief(briefPath) });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/briefs/<path>/frontmatter — accepts ONLY `implemented`. Każdy
  // inny klucz → 400 BRIEF_FRONTMATTER_IMMUTABLE.
  router.patch('/*/frontmatter', async (req, res, next) => {
    try {
      const briefPath = extractPath(req.params);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const allowed = new Set(['implemented']);
      const invalid = Object.keys(body).filter((k) => !allowed.has(k));
      if (invalid.length > 0) {
        throw new DomainError(
          'BRIEF_FRONTMATTER_IMMUTABLE',
          `cannot mutate immutable frontmatter keys: ${invalid.join(', ')} (only 'implemented' is mutable via this endpoint)`,
        );
      }
      const out = await briefs.updateFrontmatter({
        path: briefPath,
        patch: {
          implemented: typeof body.implemented === 'boolean' ? body.implemented : undefined,
        },
        changedBy: 'user',
      });
      res.json({ data: out });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/briefs/<path>/content
  router.put('/*/content', async (req, res, next) => {
    try {
      const briefPath = extractPath(req.params);
      const body = (req.body ?? {}) as { content?: string; expectedHash?: string; changeSummary?: string };
      if (typeof body.content !== 'string') {
        throw new DomainError('VALIDATION', 'content is required');
      }
      if (typeof body.expectedHash !== 'string') {
        throw new DomainError('VALIDATION', 'expectedHash is required for brief content updates');
      }
      const out = await briefs.updateContent({
        path: briefPath,
        content: body.content,
        expectedHash: body.expectedHash,
        changedBy: 'user',
        changeSummary: body.changeSummary,
      });
      res.json({ data: out });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/briefs/<path> — detail (must be LAST so the more specific
  // /:path/versions, /:path/threads, etc. don't accidentally match here)
  router.get('/*', async (req, res, next) => {
    try {
      const briefPath = extractPath(req.params);
      const brief = await briefs.getBrief(briefPath);
      const threads = briefs.listThreadsForBrief(briefPath);
      res.json({ data: { ...brief, threads } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * Express splat (`/*`) puts ONLY the matched wildcard portion in
 * `req.params[0]`. Literal segments (`/versions`, `:version`, etc.) are
 * stripped automatically — splat is already the brief filename alone.
 */
function extractPath(params: unknown): string {
  const splat = (params as Record<string, string>)[0];
  if (!splat) throw new DomainError('VALIDATION', 'missing brief path');
  return splat;
}
