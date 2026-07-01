import { Router } from 'express';
import { StaticHtmlService, StaticPathTraversalError } from '../services/static-html.js';

/**
 * M30 (L4): `GET /api/static/:rootId/*` — raw static file server rooted at a
 * page root's dir (0.1.96: was the single `pagesDir`). Each request resolves the
 * root's `StaticHtmlService` via `resolveStatic(req.params.rootId)`; unknown id →
 * 404 ROOT_NOT_FOUND.
 *
 * Returns the raw bytes of the file (NOT a `{ data }` envelope), with `Content-Type`
 * inferred from the extension by Express's built-in `send`/mime. Path-traversal ⇒ 403,
 * missing file ⇒ 404. Same origin as the app — iframe isolation is enforced by the
 * `sandbox` attribute, not by origin.
 */
export function staticRouter(
  resolveStatic: (rootId: string) => StaticHtmlService | undefined,
): Router {
  const router = Router({ mergeParams: true });

  router.get('/*', async (req, res, next) => {
    try {
      const rootId = (req.params as Record<string, string>).rootId ?? '';
      const staticHtml = resolveStatic(rootId);
      if (!staticHtml) {
        return res.status(404).json({ error: { code: 'ROOT_NOT_FOUND', message: `root '${rootId}' not found` } });
      }
      const relPath = (req.params as Record<string, string>)[0];
      if (!relPath) return res.status(400).json({ error: 'missing path' });

      let abs: string;
      try {
        abs = staticHtml.resolveSafe(relPath);
      } catch (err) {
        if (err instanceof StaticPathTraversalError) {
          return res.status(403).json({ error: 'forbidden' });
        }
        throw err;
      }

      if (!(await staticHtml.existsFile(abs))) {
        return res.status(404).json({ error: 'not found' });
      }

      // Defense-in-depth: stop the browser from MIME-sniffing the response.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.sendFile(abs, (err) => {
        if (err && !res.headersSent) next(err);
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
