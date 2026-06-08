import { Router } from 'express';
import { StaticHtmlService, StaticPathTraversalError } from '../services/static-html.js';

/**
 * M30 (L4): `GET /api/static/*` — raw static file server rooted at `pagesDir`.
 *
 * Returns the raw bytes of the file (NOT a `{ data }` envelope), with `Content-Type`
 * inferred from the extension by Express's built-in `send`/mime (unknown extension ⇒
 * `application/octet-stream`). Path-traversal ⇒ 403, missing file ⇒ 404. Same origin
 * as the app — iframe isolation is enforced by the `sandbox` attribute, not by origin.
 */
export function staticRouter(staticHtml: StaticHtmlService): Router {
  const router = Router();

  router.get('/*', async (req, res, next) => {
    try {
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
